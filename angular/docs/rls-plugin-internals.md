# RLS Plugin Internals

> **Target Audience:** Platform Engineers, Security Auditors, and System Architects.
> 
> This document explains *why* the custom `@our-org/nestjs-typeorm-rls` library was built and exactly *how* the underlying JavaScript Proxy mechanics function to enforce Row-Level Security (RLS) across the application.

---

## 1. The "Why": SQLite and Database Independence

Row-Level Security (RLS) is typically handled natively at the database engine level (e.g., PostgreSQL RLS) using session variables (`SET LOCAL rls.tenant_id = 1`). 

However, this application is designed as a portable boilerplate that must support lightweight, single-database **SQLite** deployments as a first-class citizen, alongside larger databases like MySQL or SQL Server. 

Because SQLite has no native concept of roles, users, or session-scoped connection variables, we cannot rely on the database engine. We are forced to implement RLS at the **Application Layer (ORM)**.

### Why a Proxy instead of standard TypeORM features?
TypeORM has built-in `beforeQuery` subscribers, but they expose raw SQL strings. Parsing and manipulating raw SQL strings to dynamically inject complex nested `JOIN` and `WHERE` clauses is brittle and highly vulnerable to SQL injection and alias collisions.

Instead, we built a **JavaScript Proxy** that intercepts the public, object-oriented API of the `QueryBuilder`. This ensures we inject conditions securely into the Abstract Syntax Tree (AST) before it is compiled into SQL.

---

## 2. Technical Architecture

### 2.1 The Proxy Injection Point
TypeORM manages queries through the `EntityManager`. Every `Repository` requests the `EntityManager` from the Dependency Injection container. We use a NestJS Custom Provider to replace the standard `EntityManager` with a wrapped Proxy version:

```typescript
// Simplified instantiation logic
// Note: RlsModule creates its own DataSource from dataSourceOptions to avoid
// DI context issues with TypeOrmModule.forRootAsync()
{
  provide: EntityManager,
  useFactory: async (cls: ClsService, config: RlsModuleOptions) => {
    // Create DataSource from config.dataSourceOptions (passed from ConfigService)
    const dataSource = new DataSource(config.dataSourceOptions);
    await dataSource.initialize();
    
    // To prevent race conditions, the raw DataSource QueryRunner is patched HERE
    patchDataSourceQueryRunner(dataSource);
    
    const originalManager = dataSource.createEntityManager();
    // Default-Deny Proxy: EntityManagerProxyHandler validates table access
    // against whitelist (exemptTables) and activeGroupIds before allowing queries.
    return new Proxy(originalManager, new EntityManagerProxyHandler(cls));
  }
}
```

**Default-Deny Whitelist Approach:**
The Proxy enforces a two-layer model for every `EntityManager` method call:

1. **Explicitly proxied write methods** — fully overridden with RLS enforcement:
   - `save`, `remove`, `update`, `delete` — check entity ownership / tenant ID before delegating
   - `softRemove`, `recover` — same ownership check as `remove`/`save`
   - `softDelete`, `restore` — routed through the proxied `QueryBuilder` for automatic WHERE injection
   - `increment`, `decrement` — routed through proxied `QueryBuilder`
   - `insert`, `upsert` — check tenant stamping before delegating
   - `clear` — hard-blocked unless inside `runSystemBypass()`
   - `query` — hard-blocked unless inside `runSystemBypass()`
   - `transaction` — callback receives a freshly proxied `EntityManager`
   - `createQueryBuilder`, `getRepository`, `getTreeRepository`, `withRepository` — return proxied builders/repos

2. **Explicitly allowed read methods** (delegated to original `EntityManager`, RLS applied at query-builder level):
   - `find`, `findOne`, `findOneBy`, `findBy`, `findAndCount`, `findAndCountBy`
   - `findOneOrFail`, `findOneByOrFail`
   - `count`, `countBy`, `sum`, `average`, `minimum`, `maximum`
   - `exists`, `existsBy`, `getId`, `create`, `merge`, `preload`, `hasId`

3. **Unknown methods (default-deny)** — any method not in either list above returns a **wrapper function** that throws `RlsSecurityViolationError` if actually *called* outside a bypass. The wrapper does **not** throw on property *access*, because NestJS framework code (e.g. `@nestjs/schedule`'s `ScheduleExplorer`) enumerates every property of every injected service at startup to discover decorator metadata — throwing on access would crash module initialisation.

```typescript
// Default-deny gate — throw on CALL, not on property access:
if (typeof value === 'function' && !PROXIED_METHODS.has(prop) && !SAFE_READ_METHODS.has(prop)) {
  return function (...args) {
    if (cls.get('__rlsBypass')) return value.apply(target, args);
    throw new RlsSecurityViolationError(`Unrecognized EntityManager method: ${String(prop)}`);
  };
}
```

This means tables must either:
1. Be listed in `exemptTables` (bypass RLS entirely), OR
2. Have at least one RLS rule defined for the user's groups

If neither condition is met, queries are blocked (`WHERE 1=0` in production, warning in development). This prevents accidental exposure of unsecured tables.

**Why does RlsModule create its own DataSource?**
Because `TypeOrmModule.forRootAsync()` creates the DataSource in a separate NestJS DI context, injecting `DataSource` directly into `RlsModule` fails at runtime. The solution is to pass `dataSourceOptions` (the raw configuration object) from `ConfigService` and let RlsModule instantiate its own DataSource.

### 2.2 ScopeCompilerService — Relational Conditions to SQL Compilation

RLS rules are stored relationally across normalized tables (`rls_rules`, `rls_join_paths`, `rls_join_conditions`). At query time, the `ScopeCompilerService` retrieves rules for the target table and user's groups, then compiles them into SQL conditions.

**Storage Model (Relational — actual schema):**
```
rls_rules:              { id, group_id, target_table, root_group_id, is_active, priority, description }
rls_condition_groups:   { id, rule_id, parent_group_id, logical_operator, sort_order }
rls_rule_conditions:    { id, condition_group_id, column_name, operator, value, sort_order }
rls_join_paths:         { id, name, target_table, chain (JSON) }
rls_join_conditions:    { id, join_path_id, from_table, from_col, to_table, to_col }
rls_scope_templates:    { id, join_path_id, target_table, name, available_columns (JSON) }
```

Conditions are stored as a tree of `rls_condition_groups` (each with an `AND`/`OR` operator) containing `rls_rule_conditions` leaves. The root group is linked from `rls_rules.root_group_id`. This replaces the legacy `sql` and `parameters` columns that previously stored raw SQL strings.

**Compilation Flow:**
1. `ScopeCompilerService.getCompiledScope(tableName, groupIds)` is called by the QueryBuilder Proxy
2. Rules are fetched via TypeORM repositories (enabling hot-reload)
3. Join chains are resolved from `rls_join_paths`
4. Conditions are assembled based on operator (eq, ne, gt, in, etc.)
5. SQL is injected via QueryBuilder's AST methods (`.andWhere()`, `.leftJoin()`)

**Benefits of Relational Storage:**
- Admin UI can edit rules without code changes
- Join paths are reusable across multiple groups/tables
- Conditions are parameterized (no raw SQL injection risk)
- Rules can be cached and hot-reloaded independently

### 2.3 The `QueryBuilder` Proxy (Solving Nested Relations)
TypeORM processes nested relations (e.g., `find({ relations: ['orders'] })`) by silently calling `qb.leftJoin()` under the hood. Our `QueryBuilderProxy` intercepts these public method calls across the entire API surface:

*   **Joins:** `leftJoin`, `innerJoin`, `leftJoinAndSelect`, `innerJoinAndSelect`, `rightJoin`, `fullJoin`.
*   **Execution:** `getOne`, `getMany`, `getManyAndCount`, `getRawOne`, `getRawMany`, `stream`, `execute`.
*   **Subqueries:** Intercepts `subQuery()` to return a newly proxied builder.

```typescript
// Inside the QueryBuilderProxyHandler
get(target: SelectQueryBuilder<any>, prop: string) {
  if (prop === 'leftJoin' || prop === 'innerJoin') {
    return function(entity: string, alias: string, condition?: string) {
      const rules = fetchRules(entity); 
      const securedCondition = condition ? `(${condition}) AND (${rules.sql})` : rules.sql;
      return target[prop](entity, alias, securedCondition);
    };
  }
  return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
}
```

---

## 3. Hardening the Perimeter

Because application-level security relies on the developer actually using the proxied objects, we must explicitly block all avenues where a developer could bypass the `EntityManager`.

### 3.1 Blocking Raw SQL (`QueryRunner`) and Bootstrap via Repositories
If a developer accesses the `QueryRunner` directly to execute raw SQL, there is no AST for the proxy to intercept. To prevent this, the library overrides the execution methods on the driver.

**Bootstrap uses TypeORM Repositories:**
Initial RLS rule seeding must occur before normal application queries can succeed. The `RlsSystemBypassService.runSystemBypass()` executes within a modified context where the EntityManager Proxy is temporarily disabled, allowing direct database access. This bootstrap phase uses standard TypeORM repositories (not raw SQL) for portability across SQLite, MySQL, and PostgreSQL.

```typescript
const originalCreateRunner = dataSource.createQueryRunner.bind(dataSource);

dataSource.createQueryRunner = (mode) => {
  const qr = originalCreateRunner(mode);
  
  // Remove the ability to execute raw queries outside a system bypass
  const crashIfNoBypass = () => { 
    if (!cls.get('__rlsBypass')) {
      throw new RlsSecurityViolationError('Raw QueryRunner queries are strictly forbidden. Use QueryBuilder.'); 
    }
  };

  const origQuery = qr.query.bind(qr);
  qr.query = (...args) => { crashIfNoBypass(); return origQuery(...args); };
  
  if (qr.rawQuery) {
    const origRawQuery = qr.rawQuery.bind(qr);
    qr.rawQuery = (...args) => { crashIfNoBypass(); return origRawQuery(...args); };
  }
  
  return qr;
};
```

### 3.2 Poisoning `DataSource` Injection (TypeScript Augmentation)
The library ships with a TypeScript augmentation file (`rls-globals.d.ts`) that mutates the TypeORM type definitions globally. To activate this, the consuming application must include it in their `tsconfig.json`.

```json
// Application tsconfig.json
{
  "compilerOptions": {
    "typeRoots": ["./node_modules/@our-org/nestjs-typeorm-rls/types", "./node_modules/@types"]
  }
}
```

```typescript
// The augmentation inside the library
declare module '@nestjs/typeorm' {
  export function InjectDataSource(): never; 
}
```

### 3.3 The `/internal` Bypass Export
To prevent developers from abusing the bypass mechanism out of convenience, the bypass service is physically isolated in the Node package structure.

```json
// package.json of the library
"exports": {
  ".": "./dist/index.js",           // Safe public API
  "./internal": "./dist/internal/index.js"  // Dangerous bypass API
}
```
If a Pull Request contains `import { ... } from '@our-org/nestjs-typeorm-rls/internal'`, security auditors can instantly flag it for strict review.

### 3.4 NestJS Module Registration

The new relational condition entities (`RlsConditionGroup`, `RlsRuleCondition`) and the `ScopeCompilerService` must be explicitly registered in the consuming application module. Forgetting either will cause a NestJS DI error at startup (`Nest can't resolve dependencies of RlsRulesController`).

```typescript
// permissions.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // ... other entities ...
      RlsRule,
      RlsConditionGroup,   // ← required
      RlsRuleCondition,    // ← required
      RlsJoinPath,
      RlsJoinCondition,
      RlsScopeTemplate,
    ]),
  ],
  providers: [
    // ... other providers ...
    ScopeCompilerService,  // ← required
  ],
  exports: [
    // ... other exports ...
    ScopeCompilerService,  // ← export if other modules need it
  ],
})
export class PermissionsModule {}
```