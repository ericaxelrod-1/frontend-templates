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
{
  provide: EntityManager,
  useFactory: (dataSource: DataSource, cls: ClsService) => {
    // To prevent race conditions, the raw DataSource QueryRunner is patched HERE
    patchDataSourceQueryRunner(dataSource);
    
    const originalManager = dataSource.createEntityManager();
    return new Proxy(originalManager, new EntityManagerProxyHandler(cls));
  }
}
```

### 2.2 The `QueryBuilder` Proxy (Solving Nested Relations)
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

### 3.1 Blocking Raw SQL (`QueryRunner`)
If a developer accesses the `QueryRunner` directly to execute raw SQL, there is no AST for the proxy to intercept. To prevent this, the library overrides the execution methods on the driver.

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