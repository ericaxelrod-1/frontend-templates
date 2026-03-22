# Custom TypeORM Row-Level Security (RLS) Library Plan

> **Status**: Approved Implementation Strategy
> 
> This document details the creation of a custom Node library (`@our-org/nestjs-typeorm-rls`) to safely enforce Row-Level Security (RLS) in NestJS and TypeORM. 
> 
> For developer usage instructions, see `row-level-security.md`. For deep internal technical specifications on the proxy pattern itself, see `rls-plugin-internals.md`.

---

## 1. Executive Summary

To achieve multi-tenant data isolation (Row-Level Security) without relying on database-specific features (to remain SQLite agnostic), we will build a custom internal library. 

This library will intercept public TypeORM queries via an `EntityManager` / `QueryBuilder` Proxy. It will dynamically apply security constraints based on the active user's context, transparently to the developer.

---

## 2. Core Architecture

### 2.1 The Interception Point: `EntityManager` Proxy (Default-Deny)
Instead of parsing raw SQL strings, the library uses a JavaScript `Proxy` to wrap the `EntityManager` and `SelectQueryBuilder`. It intercepts public TypeORM methods (`leftJoin`, `where`, `getMany`, etc.) and mutates the query parameters before passing them down. This automatically secures nested relations and implicit joins without hacking TypeORM internals.

**Default-Deny Enforcement:** The Proxy validates table access against an allowlist. Queries to tables not in `exemptTables` and without active RLS rules for the user's groups are blocked with `WHERE 1=0` (production) or warned (development).

**Database Portability:** The library uses standard TypeORM repositories for all internal operations (rule loading, cache invalidation). The bootstrap/seeding phase does not execute raw SQL, ensuring compatibility with SQLite, MySQL, and PostgreSQL without modification.

### 2.2 Structured Rule Storage & Scope Compilation
Rules are stored in normalized relational tables, not JSON blobs or raw SQL strings:

```
rls_rules:              { id, group_id, table_name, join_path_id, is_active }
rls_join_paths:        { id, name, target_table, chain (JSON) }
rls_join_conditions:   { id, join_path_id, from_table, from_col, to_table, to_col }
rls_scope_templates:   { id, join_path_id, column_name, operator, value }
```

The `ScopeCompilerService` retrieves rules via TypeORM repositories and compiles structured conditions (column + operator + value) into SQL at query time. This approach:
- Enables admin UI editing without code changes
- Prevents SQL injection (no raw string concatenation)
- Allows reusable join paths across multiple rules
- Supports hot-reload by invalidating specific table caches

### 2.3 Context Propagation: `nestjs-cls`
TypeORM interceptors are singletons and do not have access to the HTTP request. We will use `nestjs-cls` (AsyncLocalStorage) to invisibly pass the active user's Group IDs down to the database layer.

---

## 3. Overcoming "Gotchas" & Edge Cases

### 3.1 The `UPDATE` / `DELETE` vs `save()` Problem
The library explicitly proxies TypeORM's `UpdateQueryBuilder` and `DeleteQueryBuilder`. If a developer writes `repo.update(1, { status: 'paid' })`, the library safely intercepts the `.execute()` call to append `WHERE id = 1 AND (rls_conditions)`.

### 3.2 The Auto-Populate `CREATE` Problem
When a user creates a new record, the system must securely stamp it with their active group ID. The frontend must pass an explicit "active context" (e.g., `X-Active-Group-Id` header). The library will use a TypeORM `beforeInsert` subscriber to read this from `nestjs-cls` and forcefully apply it to the entity payload before insertion. If no header is provided, it falls back to the user's `primaryGroupId`.

### 3.3 Alias Collisions on Dynamic Join Paths
The Proxy analyzes the `QueryBuilder`'s public methods to see if the required table is already joined. If the required table is already joined, the library intelligently reuses the developer's alias. If not, the library generates a guaranteed unique, hashed alias (e.g., `__rls_join_users_a1b2`) to avoid collisions.

### 3.4 Aggregations (`COUNT`, `SUM`)
The library's test suite will strictly enforce that `SelectQueryBuilder` interceptions correctly cascade into cloned builders used for pagination counts (`findAndCount`).

---

## 4. Threat Model & Mitigations

We have identified several critical bypass risks and mitigated them completely through strict compiler and runtime enforcement.

| Threat / Risk | Mitigation Strategy |
| :--- | :--- |
| **Developer forgets to secure table** | **Default Deny / Fail Open:** Configurable via `fallbackBehavior`. Fails closed (`WHERE 1=0`) in production to prevent data leaks. Warns in development for better DX. |
| **Direct `QueryRunner` Usage** | **Hard Block:** The `QueryRunner` bypasses the `EntityManager`. The library patches `dataSource.createQueryRunner` to intercept and hard-crash (`throw Error`) if `.query()` or `.rawQuery()` are called outside a bypass block. |
| **Direct `DataSource` Injection** | **TypeScript Augmentation:** We augment `@nestjs/typeorm` and `typeorm` types to poison `DataSource` injection. Attempting to use `@InjectDataSource()` throws a compile-time error. |
| **Abuse of System Bypass** | **Package Exports:** `runSystemBypass` is physically separated in `package.json` exports. Developers MUST import from `@our-org/nestjs-typeorm-rls/internal`, making bypasses blatantly obvious in Code Review. |

### Final Threat Assessment
What is prevented: Standard queries, nested relations, explicit joins, transactions, direct QueryRunner usage, direct DataSource injection, and accidental bypasses in production.

What remains: Malicious circumvention (e.g., type casting `DataSource as any`, modifying `package.json`). These are deliberate actions caught by standard code review.

---

## 5. Edge Cases & Exclusions

### 5.1 Migrations
Migrations run via the TypeORM CLI (`typeorm migration:run`), which bootstraps its own `DataSource` entirely outside the NestJS lifecycle. Our NestJS-level proxy does not interfere with the CLI. As a safety net, the global patch explicitly checks `process.argv` and fully bypasses RLS if `migration:run` is detected.

### 5.2 Multiple DataSources
If the application uses multiple databases, the `RlsModule.forRootAsync()` accepts a `connectionName` configuration parameter to ensure the Proxy only wraps the intended `EntityManager` token.

### 5.3 WebSockets
WebSocket gateways bypass standard HTTP middleware. To ensure `nestjs-cls` context populates, the global `ClsMiddleware.forRoutes()` must be configured with a WebSocket adapter to capture the initial upgrade connection.

### 5.4 Worker Threads
Node.js worker threads do not inherit `AsyncLocalStorage`. Database operations inside worker threads must explicitly wrap their logic in `runSystemBypass()` or manually serialize and reconstruct the CLS context.

---

## 6. Observability

To monitor the health and activity of the RLS system, the library must emit specific signals:

1. **Logging:** In `warn` fallback mode, the library must log loud, color-coded warnings when unprotected tables are queried. It must also log an audit trail whenever the `/internal` bypass service is invoked.
2. **Metrics:** The library should expose counters for `rls_blocks_total` (queries resulting in 1=0 due to default-deny) and `rls_bypass_usage_total`.
3. **Alerting:** A sudden spike in RLS blocks may indicate a compromised tenant attempting horizontal privilege escalation.

---

## 7. Development Phases

### Phase 0: Build the Library (`packages/nestjs-typeorm-rls`)
1. Setup package structure inside the monorepo with proper `./internal` exports.
2. Implement the `EntityManagerProxyHandler` and `QueryBuilderProxyHandler`.
3. Implement the `QueryRunner` strict blocking patch.
4. Implement TypeScript module augmentations to poison `DataSource`.
5. Write exhaustive unit tests for nested proxy transactions and aggregations.

### Phase 1: Database & Config 
1. Create migrations for the required `rls_rules`, `rls_join_paths`, etc., tables.
2. Integrate `RlsModule.forRootAsync()` into `app.module.ts`.
   > **Important:** RlsModule creates its own DataSource instance because it runs in a separate NestJS DI context from `TypeOrmModule.forRootAsync()`. Pass `dataSourceOptions` from ConfigService:
   > ```typescript
   > RlsModule.forRootAsync({
   >   imports: [ConfigModule],
   >   inject: [ConfigService],
   >   useFactory: (configService: ConfigService) => ({
   >     dataSourceOptions: configService.get('database'),
   >     // ... other options
   >   }),
   > })
   > ```

### Phase 2: Initial Rules Seeding
Create a TypeORM database seeder script (e.g., `seed-rls.ts`) that runs inside a `runSystemBypass()` block. This script will insert the fundamental rules for core tables (e.g., ensuring users can only see their own `groups`) before the application accepts its first login. 

### Phase 3: Refactoring Auth & Groups
1. Update Auth Guards to inject user context and active Group ID into `nestjs-cls`.
2. Audit the database schema and populate the `exemptTables` configuration array in `app.module.ts` for any tables that should be globally accessible (e.g., `roles`, `actions`).