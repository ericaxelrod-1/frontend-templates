# Row-Level Security (RLS) Developer Guide

This document explains how to use and configure the Row-Level Security (RLS) system in our NestJS/TypeORM backend. 

If you are looking for the technical details on *how* the underlying library intercepts TypeORM, please see the [RLS Plugin Internals](./rls-plugin-internals.md).

---

## 1. Overview & Developer Experience

The RLS system ensures that a user belonging to "Tenant A" cannot view, modify, or delete data belonging to "Tenant B". 

**For feature developers, this system is 100% transparent and automatic.**

You do not need to use special decorators or custom repository methods. You write standard TypeORM code, and the security layer handles the rest automatically based on the user's JWT.

```typescript
@Injectable()
export class OrdersService {
  constructor(@InjectRepository(Order) private ordersRepo: Repository<Order>) {}

  async getMyOrders() {
    // The RLS interceptor invisibly applies the current user's scopes.
    // If the user belongs to Group 1, this automatically becomes:
    // SELECT * FROM orders WHERE status = 'active' AND group_id = 1
    return this.ordersRepo.find({ where: { status: 'active' } }); 
  }
}
```

---

## 2. Configuration & The "Empty Array" Problem

The RLS library operates on a **Default-Deny** security posture in production. If a table is not explicitly exempted, and no RLS rules exist for it in the database, the library will block access to it.

### Development vs Production Behavior

The system behaves differently depending on your environment to balance developer velocity with strict security:

*   **Development (`NODE_ENV=development`):** Fails Open. If you query a new table that has no security rules, the query succeeds, but a loud warning is logged: `[RLS WARNING] Table 'new_feature' is unprotected!`
*   **Production (`NODE_ENV=production`):** Fails Closed. If you query a new table that has no rules, the system silently appends `WHERE 1=0`, returning `[]` (zero rows) to prevent accidental data leaks.

### Global Exemptions (`app.module.ts`)

System tables (like roles, permissions, cache tables, and migrations) do not belong to specific tenants and must be globally readable by the system. You configure these exemptions in your root module.

```typescript
// app.module.ts
RlsModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('RLS_ENABLED', true),
    
    // System tables that bypass RLS entirely.
    exemptTables: [
      'roles',
      'permissions',
      'role_permissions',
      'actions',
      'resources',
      'cache_components',
      'cache_routes',
      'cache_endpoints',
      'cache_sync_status',
      'migrations',
      'rls_rules',       
      'rls_join_paths'
    ],
    
    fallbackBehavior: config.get('NODE_ENV') === 'production' ? 'deny' : 'warn'
  })
})
```

**Important Notes on Exemptions:**
 1. **The `groups` table is NOT exempt:** When a user queries the `groups` table, they do not see all tenants. The RLS system ensures they only see:
    - Groups they are DIRECTLY assigned to.
    - All CHILD groups (because children inherit visibility).
    - They CANNOT see PARENT or sibling groups.
 2. **Securing `rls_rules`:** The `rls_rules` and `rls_join_paths` tables are exempt so the system can bootstrap itself without circular dependencies. Because these tables bypass RLS, they must be strictly protected by standard **Role-Based Access Control (RBAC)**. Only users with the `SUPERADMIN` role (or the `rls_rules:manage` permission) are allowed to access the Admin API endpoints that create or modify rules. **RLS secures tenant data; RBAC secures system configuration.**

### DataSource Configuration Requirement

The RlsModule creates its own TypeORM `DataSource` instance because it runs in a separate NestJS dependency injection context from `TypeOrmModule.forRootAsync()`. You must pass the database configuration via `dataSourceOptions`:

```typescript
// app.module.ts
RlsModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const dbConfig = configService.get('database');
    return {
      enabled: process.env.NODE_ENV !== 'test',
      exemptTables: ['rls_rules', 'rls_join_paths', 'rls_join_conditions', 'rls_scope_templates'],
      fallbackBehavior: 'deny',
      dataSourceOptions: dbConfig, // Required: pass the same DB config used by TypeOrmModule
    };
  },
}),
```

---

## 3. Background Tasks & Cron Jobs

The NestJS `@nestjs/schedule` module (Cron, Timeout, Interval) executes *outside* the standard HTTP request lifecycle. Because there is no HTTP request, there is no active user context. 

If your cron job attempts to read/modify a non-exempt table, the RLS system will block it. You **must** explicitly bypass the RLS system using the internal bypass service.

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';
import { RlsSystemBypassService } from '@our-org/nestjs-typeorm-rls/internal'; // Note the /internal path

@Injectable()
export class AuthCleanupTask {
  constructor(
    private bypassService: RlsSystemBypassService,
    private usersRepository: Repository<User>
  ) {}
  
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMidnightCleanup() {
    // CRITICAL: Bypasses the RLS interceptor for this specific execution block
    await this.bypassService.runSystemBypass(async () => {
      await this.usersRepository.delete({ status: 'expired' });
    });
  }
}
```
*Note: Use of `/internal` imports requires strict code review. Do not use this in standard user-facing controllers.*

---

## 4. Bootstrapping Initial Rules (Seeding)

Because `users` and `groups` are subject to RLS, the application cannot function until the initial RLS rules are populated in the database. 

During your deployment/seeding phase, you must use the `RlsSystemBypassService` to programmatically insert the foundational rules (e.g., ensuring users can see their own groups) before allowing the first login. The bootstrap phase uses standard TypeORM repositories for database portability across SQLite, MySQL, and PostgreSQL—no raw SQL required.

Once the initial seed rules are created, system administrators can manage subsequent rules using the Admin UI or REST API.

## 4.1 Scope Builder UI — No Raw SQL Required

RLS rules are defined through the Admin UI's **Scope Builder**, which provides a structured interface:

```
┌─────────────────────────────────────────────────────────────────┐
│  SCOPE BUILDER                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Target Table: [ orders ▼ ]                                     │
│                                                                  │
│  Join Path: [ Orders via Users → Groups ▼ ]                     │
│                                                                  │
│  Conditions:                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [customer_id ▼] [= ▼] [{{ customerId }}]            [✕]   ││
│  │ [status ▼]       [in ▼] [shipped, processing]       [✕]   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  [+ Add Condition]                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**How it works:**
- **Column:** Dropdown of available columns from the target table (via join path)
- **Operator:** Dropdown of valid operators (eq, ne, gt, lt, in, like, between)
- **Value:** Text input or dynamic placeholder (e.g., `{{ customerId }}` from user context)

Conditions are stored relationally in normalized tables (`rls_rules`, `rls_scope_templates`, `rls_join_conditions`). The `ScopeCompilerService` compiles these structured conditions into SQL at query time—no SQL strings are ever entered by administrators.

---

## 5. Writing Tests

### Unit Tests (`*.spec.ts`)
Existing unit tests mock the TypeORM `Repository` directly using `jest.fn()`. Because unit tests do not spin up an actual TypeORM `EntityManager`, the RLS interceptor is never invoked. **Unit tests require zero modifications.**

If your specific unit test tests logic that reads the CLS context directly, you can mock it using `cls.runWith()`:
```typescript
beforeEach(() => {
  cls.runWith({ activeGroupIds: [1, 2] }, () => {
    // Call your service logic here
  });
});
```

### E2E Tests (`*.e2e-spec.ts`)
End-to-End tests hit the real database and *will* trigger the RLS interceptor. **RLS must remain ENABLED during E2E tests** to prove your multi-tenant security works.

Because the library reads the active user context automatically, you simply write E2E tests exactly as a real client would behave:

1. Seed the DB with mock Groups and RLS Rules in your `beforeAll` block.
2. Hit the `/auth/login` endpoint to get a real JWT for a mock user.
3. Pass the JWT in the `Authorization` header to your endpoints.

```typescript
// Example: RLS is automatically applied because of the valid JWT
const res = await request(app.getHttpServer())
  .get('/orders')
  .set('Authorization', `Bearer ${tenantAToken}`); 
  
expect(res.body.every(order => order.groupId === 'A')).toBe(true); 
```

### Bypassing RLS in Specific Test Suites
If you are writing an E2E test for a complex internal calculation and do not want the overhead of setting up mock Auth and RLS rules, you can disable the RLS library **for that specific test file** using NestJS Dependency Injection overrides:

```typescript
// Inside calculation.e2e-spec.ts
const moduleFixture: TestingModule = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider('RLS_CONFIG_OPTIONS') 
  .useValue({ enabled: false, exemptTables: [], fallbackBehavior: 'warn' })
  .compile();
```

---

## 6. Emergency Operations

In the event of a catastrophic RLS configuration failure blocking critical production workflows, the system can be globally disabled by setting the environment variable:

```bash
RLS_ENABLED=false
```
*Warning: This instantly disables all multi-tenant data isolation. Use only as an absolute last resort. The application will log a massive CRITICAL startup banner if this is set to false in a production environment.*