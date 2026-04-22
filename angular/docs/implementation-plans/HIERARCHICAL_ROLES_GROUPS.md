# Hierarchical Role & Group Structures Implementation Plan

> **Last Updated**: Based on architectural review and custom RLS library decision.
> 
> This document describes the implementation of hierarchical RBAC/GBAC with Row-Level Security (RLS). For detailed specifications on the RLS interception mechanism, see `TYPEORM_RLS_LIBRARY.md`.

---

## Executive Summary

This plan implements:
1. **Hierarchical Roles & Groups** with permission inheritance
2. **Row-Level Security (RLS)** for multi-tenant data isolation via a custom TypeORM library
3. **3-State Permissions** (allowed, denied, null/inherit)
4. **Admin UI** for managing all of the above

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Permission Inheritance | **Backend only** | Security - never trust frontend |
| RLS Injection | **Custom TypeORM Library (EntityManager Proxy)** | Safe, avoids SQL string manipulation, transparent to developers |
| Context Propagation | **AsyncLocalStorage (`nestjs-cls`)** | Allows singletons to access request-scoped user contexts |
| Overlapping Scopes | **UNION** | Intended behavior for multi-group membership |
| Conflict Detection | **Save-time warning only** | Runtime complexity not worth it |
| Join Paths | **Stored centrally, reusable** | DRY, consistent |

---

## Part 1: Core Model

### 1.1 Roles vs Groups - The Distinction

```
┌─────────────────────────────────────────────────────────────────┐
│  ROLES                                                           │
├─────────────────────────────────────────────────────────────────┤
│  • Global permissions (NOT row-scoped)                          │
│  • 3-state: allowed, denied, null (inherit)                    │
│  • Can be assigned to Groups                                    │
│  • Example: "Superuser" can delete users (any customer)        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  GROUPS                                                          │
├─────────────────────────────────────────────────────────────────┤
│  • Row-Level Security (RLS) - scope to specific rows           │
│  • Define WHERE conditions (customer_id = 1)                   │
│  • Can have assigned Roles                                     │
│  • Can have child Groups (inherit parent scope)                │
│  • Example: "Engineering Dept" sees only their customer data    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 How They Combine

```
User belongs to Group "Engineering" (customer_id = 1, department = 'Engineering')
Group "Engineering" assigns Role "User" (has users:read permission)

Effective:
- Permission: users:read = allowed (from Role "User")
- Row Scope: customer_id = 1 AND department = 'Engineering' (from Group)
- User can read users from customer 1, department Engineering only
```

---

## Part 2: 3-State Permissions (Roles)

### 2.1 Permission States

| State | Meaning |
|-------|---------|
| `allowed` | Permission is granted |
| `denied` | Permission is explicitly blocked |
| `null` | Inherits from parent |

### 2.2 Inheritance Rules

```
┌─────────────────────────────────────────────────────────────────┐
│  PARENT: users:delete = allowed                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Child sets:                                                     │
│  • allowed  → allowed  ✓ (keep parent's grant)                 │
│  • denied   → denied   ✓ (explicit restriction)                 │
│  • null     → allowed  ✓ (inherits parent's allowed)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  PARENT: users:delete = denied                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Child sets:                                                     │
│  • allowed  → ✗ INVALID (cannot expand beyond parent)          │
│  • denied   → denied   ✓ (keep parent's deny)                  │
│  • null     → denied   ✓ (inherits parent's deny)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  VALIDATION RULE                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Child permissions MUST be subset of parent permissions.        │
│  - Child can restrict more (set denied or null)                │
│  - Child CANNOT expand beyond parent                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Why 3 States?

- **denied**: Explicit block that cascades to all descendants
- **null**: Break inheritance - child can set own value later
- **allowed**: Explicit grant

---

## Part 3: Row-Level Security (RLS)

### 3.1 Overview

RLS restricts which **rows** a user can access, not which **actions** they can perform.

```
┌─────────────────────────────────────────────────────────────────┐
│  WITHOUT RLS                                                      │
├─────────────────────────────────────────────────────────────────┤
│  SELECT * FROM orders  →  Returns ALL orders                   │
│  (any user can see any customer's data)                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  WITH RLS                                                        │
├─────────────────────────────────────────────────────────────────┤
│  User in Group A (customer_id = 1):                            │
│  SELECT * FROM orders                                           │
│  → Returns only orders where customer_id = 1                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Why RLS?

1. **Multi-tenant isolation**: Users only see their own organization's data
2. **Defense in depth**: Even if authorization fails, RLS prevents access
3. **Malicious actor prevention**: Query manipulation doesn't bypass RLS

### 3.3 Defense in Depth

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: UI (UX only)                                          │
├─────────────────────────────────────────────────────────────────┤
│  • Hide/disable buttons user can't access                      │
│  • Prevent honest mistakes                                      │
│  ⚠️ CAN BE BYPASSED - don't rely on this                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Authorization Guard (primary defense)                 │
├─────────────────────────────────────────────────────────────────┤
│  • Check: Does user have permission X?                         │
│  • 403 Forbidden if not authorized                             │
│  ✓ CAN'T BE BYPASSED by query manipulation                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: RLS Interceptor (row filtering)                       │
├─────────────────────────────────────────────────────────────────┤
│  • Filter rows based on user's groups                           │
│  • Applied to ALL queries automatically                         │
│  ✓ CAN'T BE BYPASSED by payload manipulation                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 RLS vs Authorization

| Operation | Permission Check | RLS Applied |
|-----------|-----------------|-------------|
| READ | Optional | Yes (WHERE clause) |
| CREATE | Yes | Require explicit `groupId` context from frontend |
| UPDATE | Yes | Yes (WHERE + match check) |
| DELETE | Yes | Yes (WHERE + match check) |

**Note**: `CREATE` does not block but requires the frontend to pass an explicit active context (e.g. `X-Active-Group-Id`) to ensure data is attributed to the correct group if the user belongs to multiple.

---

## Part 4: TypeORM RLS Library Implementation

*(See `TYPEORM_RLS_LIBRARY.md` for full technical specifications)*

### 4.1 Why a Custom Library?

```
┌─────────────────────────────────────────────────────────────────┐
│  ALTERNATIVES CONSIDERED                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TypeORM beforeQuery Subscriber (String Manipulation):          │
│  ❌ High risk of SQL injection and alias collisions            │
│  ❌ Fails on complex nested joins                              │
│                                                                  │
│  Service Decorators / Explicit Repositories (@RlsAware):        │
│  ❌ Relies on developers never forgetting to use them          │
│  ❌ Fails to secure implicitly joined relations                │
│                                                                  │
│  Custom EntityManager Proxy Library:                            │
│  ✅ Transparent to developers (just use standard .find())      │
│  ✅ Intercepts AST before SQL compilation (safe from injection)│
│  ✅ Handles nested relations natively                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 How Context Flows (`nestjs-cls`)

TypeORM interceptors are singletons and cannot natively access the HTTP request. We use `nestjs-cls` (AsyncLocalStorage) to safely propagate state.

1. **Auth Guard:** Validates user, extracts their Group IDs, and stores them via `cls.set('activeGroupIds', [...])`.
2. **Service:** Developer calls `this.ordersRepo.find()`.
3. **Library:** Intercepts `EntityManager`, reads `cls.get('activeGroupIds')`, and dynamically appends `.andWhere()` using cached database rules.

### 4.3 Bypass Mechanism & Exemptions

System tables and operations that do not require RLS are exempted natively:

1. **Config Exemption:** Tables like `roles`, `permissions`, `groups`, `migrations`, and the internal `rls_` tables are explicitly declared in the application's root config (`exemptTables`). The library completely ignores queries against these tables.
2. **System Bypass:** Background tasks, seeders, or webhooks can execute queries ignoring RLS by using `rlsService.runBypassed(async () => { ... })`.

---

## Part 5: Scope Resolution

### 5.1 AND/OR Nesting

```
┌─────────────────────────────────────────────────────────────────┐
│  CORRECT NESTING PATTERN                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User belongs to:                                               │
│  • Group A: customer_id = 1, region = 'US'                    │
│  • Group B: customer_id = 2, region = 'EU'                    │
│                                                                  │
│  SQL:                                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  WHERE                                                      │  │
│  │    (customer_id = 1 AND region = 'US')                    │  │
│  │    OR                                                       │  │
│  │    (customer_id = 2 AND region = 'EU')                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  • Groups are separated by OR (user has access to ANY group)   │
│  • Conditions within group are AND (all must be true)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Why UNION, Not Intersection?

```
┌─────────────────────────────────────────────────────────────────┐
│  QUESTION: Why OR between groups?                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User is in Group A AND Group B.                                │
│  Why should they see data from BOTH groups?                    │
│                                                                  │
│  ANSWER: That's WHY they're in both groups.                     │
│                                                                  │
│  • User in "Engineering" + "Frontend Team"                     │
│  • Should see ALL engineering data AND ALL frontend data       │
│  • UNION is the intended behavior                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Overlapping Scopes Are NOT a Problem

```
┌─────────────────────────────────────────────────────────────────┐
│  SCENARIO: Overlapping conditions                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Group A: region = 'US'                                        │
│  Group B: region = 'California'                                │
│                                                                  │
│  SQL:                                                            │
│  WHERE region = 'US' OR region = 'California'                  │
│                                                                  │
│  Result: User sees all US rows (California is in US anyway)     │
│                                                                  │
│  Is this a problem? NO.                                        │
│  This is intended behavior.                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Explicit Contradictions Are Admin Errors

```
┌─────────────────────────────────────────────────────────────────┐
│  SCENARIO: Contradictory conditions                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Group A: country = 'US'                                       │
│  Group B: country <> 'US'                                      │
│                                                                  │
│  SQL:                                                            │
│  WHERE country = 'US' AND country <> 'US'                      │
│  Result: 0 rows                                                 │
│                                                                  │
│  This is an ADMIN CONFIGURATION ERROR.                          │
│                                                                  │
│  ACTION: Warn admin at SAVE TIME.                               │
│  Do NOT try to detect at runtime - just return 0 rows.          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 Inheritance & Visibility

```
┌─────────────────────────────────────────────────────────────────┐
│  GROUP INHERITANCE (Data Scope)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Company A (parent):                                            │
│  Scope: customer_id = 1                                        │
│                                                                  │
│  Engineering (child of Company A):                             │
│  Scope: department = 'Engineering'                             │
│  Inherits from: Company A                                       │
│                                                                  │
│  Effective scope for Engineering:                               │
│  WHERE customer_id = 1 AND department = 'Engineering'           │
│                                                                  │
│  Child CAN add more restrictive conditions.                     │
│  Child CANNOT remove parent's conditions.                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  GROUP HIERARCHY VISIBILITY                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Because the `groups` table itself is subject to RLS, a user    │
│  querying the API for groups will ONLY see:                     │
│                                                                  │
│  1. Groups they are DIRECTLY assigned to.                       │
│  2. All CHILD groups (because children inherit visibility).     │
│  3. They CANNOT see PARENT or sibling groups.                   │
│                                                                  │
│  Example: A user in "Engineering" can see "Engineering" and     │
│  its sub-departments. They cannot see "Company A" (parent)      │
│  or "HR" (sibling).                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.6 CREATE Operations and Multiple Groups

When a user belonging to multiple groups creates a new record, the system must know which group owns the record.

**Decision:** The frontend MUST pass an explicit "active context" (e.g., via `X-Active-Group-Id` header). The RLS library will intercept `beforeInsert` and automatically stamp the record with this Group ID. If the context is missing, the request is rejected (400 Bad Request) to prevent data being assigned to the wrong tenant.

---

## Part 6: Join Paths (Spanning Tables)

### 6.1 The Problem

```
┌─────────────────────────────────────────────────────────────────┐
│  ORDERS TABLE DOESN'T HAVE customer_id DIRECTLY                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Schema:                                                        │
│  orders ──user_id──► users ──customer_id──► groups             │
│                                                                  │
│  To filter orders by customer, must join through users.        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Join Path Storage

```
┌─────────────────────────────────────────────────────────────────┐
│  rls_join_paths table                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  id | name              | target_table | chain                  │
│  ---|--------------------|--------------|----------------------│
│  1  | Orders via Users   | orders       | [groups, users, orders] │
│  2  | Products via Items | products     | [groups, users, orders, order_items, products] │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  rls_join_conditions table                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  id | join_path_id | from_table | from_col | to_table | to_col │
│  ---|-------------|-----------|----------|-----------|---------│
│  1  | 1           | groups    | customer_id | users   | customer_id │
│  2  | 1           | users     | id         | orders  | user_id    │
│  3  | 2           | orders    | id         | items   | order_id   │
│  4  | 2           | items     | product_id | products| id        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Smart Injection

```
┌─────────────────────────────────────────────────────────────────┐
│  ORIGINAL QUERY:                                                 │
│  SELECT * FROM orders WHERE status = 'shipped'                  │
│                                                                  │
│  Already has 'users' joined? YES                                │
│  Need to add: 'groups' table only                              │
│                                                                  │
│  RESULT:                                                         │
│  SELECT * FROM orders                                           │
│  JOIN users ON orders.user_id = users.id                        │
│  JOIN groups ON users.customer_id = groups.customer_id          │
│  WHERE groups.id IN (1, 2)                                     │
│    AND status = 'shipped'                                       │
│                                                                  │
│  Reuse existing joins, add only what's missing.                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Why Store Join Paths Centrally?

```
┌─────────────────────────────────────────────────────────────────┐
│  BENEFITS OF CENTRALIZED JOIN PATHS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. DRY: Define once, use many times                           │
│     • Multiple groups can reference same join path             │
│                                                                  │
│  2. Consistency: Same join logic everywhere                    │
│     • No different implementations per group                    │
│                                                                  │
│  3. Testability: Test join once, verified everywhere           │
│     • Reduces bugs                                             │
│                                                                  │
│  4. Maintainability: Change once, update everywhere            │
│     • Schema changes are easier                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 7: Scope Templates

### 7.1 Why Templates?

```
┌─────────────────────────────────────────────────────────────────┐
│  REUSABLE SCOPE TEMPLATES                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Template: "Department Filter"                                  │
│  - Applies to: users table                                      │
│  - Join path: groups → users                                    │
│  - Columns: department (dropdown values)                        │
│                                                                  │
│  Multiple groups can reference this template.                  │
│  Admin selects template, provides values.                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Template References Join Path

```
┌─────────────────────────────────────────────────────────────────┐
│  RELATIONSHIP: Template → Join Path                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Scope Template:                                                │
│  - References: rls_join_path (which tables to join)            │
│  - Defines: Which columns from target table are available        │
│  - Admin provides: Values for conditions                        │
│                                                                  │
│  Join Path:                                                     │
│  - Defines: Table chain and join conditions                    │
│  - Reusable by: Multiple templates                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 8: Conflict Detection

### 8.1 What We DO Check

```
┌─────────────────────────────────────────────────────────────────┐
│  SAVE-TIME CONFLICT CHECK (Structured Conditions)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  When admin saves a rule, check (via structured conditions):   │
│                                                                  │
│  • Does new rule contradict itself?                           │
│    Example: { column: 'country', op: '=', value: 'US' }        │
│           AND { column: 'country', op: '<>', value: 'US' }    │
│                                                                  │
│  • Does new rule contradict parent group?                       │
│    Example: Parent: { col: 'country', op: '=', val: 'US' }    │
│             Child: { col: 'country', op: '<>', val: 'US' }    │
│                                                                  │
│  Conflict Detection Logic:                                     │
│  • Compare (column + operator + value) tuples across rules    │
│  • Detect logical inversions (eq vs ne, gt vs lt)              │
│  • Flag contradictions at save-time, not runtime               │
│                                                                  │
│  ACTION: Show warning, allow save anyway                       │
│  Result: 0 rows - honest answer                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why Structured Conditions Enable Better Conflict Detection:**
Since conditions are stored as discrete (column, operator, value) tuples rather than embedded in SQL or JSON, the system can compare them programmatically. This allows precise identification of conflicting column values and operators without parsing raw strings.

### 8.2 What We DON'T Check

```
┌─────────────────────────────────────────────────────────────────┐
│  RUNTIME CONFLICT DETECTION - NOT IMPLEMENTED                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  We do NOT detect at runtime:                                  │
│                                                                  │
│  • Cross-group overlapping conditions                           │
│    Example: Group A region='US', Group B region='California'   │
│    Result: UNION - this is INTENDED BEHAVIOR                   │
│                                                                  │
│  • Same column, different values across groups                 │
│    Example: Group A customer=1, Group B customer=2              │
│    Result: user sees BOTH - this is WHY they're in both       │
│                                                                  │
│  These are NOT problems. Overlapping = more access, not less.  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Parent Scope Changes

If a parent group's scope is modified (e.g., changed from `region = 'US'` to `region = 'EU'`), existing child scopes might become contradictory or invalid.

**Action:** When a parent scope is updated, the system will perform a dry-run validation against all child scopes. If contradictions are detected, the admin will be presented with a warning and must explicitly confirm the change, knowing that it may cut off access for child groups.

---

## Part 9: Hot-Reload Rules

### 9.1 How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  RULE CHANGE → IMMEDIATE EFFECT                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Admin saves new rule via UI                                │
│                                                                  │
│  2. API: PUT /rls-rules/:id                                    │
│                                                                  │
│  3. Service: Update DB, then:                                 │
│     • Invalidate cache for target table                        │
│     • Pre-warm cache (optional)                                │
│                                                                  │
│  4. Next query: Cache miss → reload from DB                    │
│                                                                  │
│  5. New rules apply immediately (no restart)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│  NO SEPARATE CACHE TABLES                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Rules stored in: rls_rules (SQLite)                           │
│                                                                  │
│  Caching handled by: Node in-memory                            │
│                                                                  │
│  • Load from DB at startup                                     │
│  • Keep in Node Map during runtime                             │
│  • Invalidate on admin save → reload from DB                   │
│                                                                  │
│  Why? Simpler, faster, no sync issues.                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

*(Note: In-memory cache is sufficient for single-instance boilerplate deployments. For horizontal scaling, a Redis provider should be added here later.)*

---

## Part 10: Admin UI

### 10.1 Standalone Page

```
┌─────────────────────────────────────────────────────────────────┐
│  WHY STANDALONE PAGE?                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  • Too heavy for existing pages (sidebar)                       │
│  • Complex interactions (tree, diagram, inspector)              │
│  • Links from users/groups/roles pages                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Permission Inspector

```
┌─────────────────────────────────────────────────────────────────┐
│  PERMISSION INSPECTOR (Debugging Tool)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Works for: Users, Roles, Groups                               │
│                                                                  │
│  Shows:                                                         │
│  • Direct role/group assignments                                │
│  • Inherited assignments (from parent groups)                   │
│  • Permission inheritance chain                                  │
│  • Effective permissions after resolution                       │
│  • Where each permission came from                             │
│                                                                  │
│  Purpose: Debug why user has/doesn't have permission           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 ng-diagram for Join Paths

```
┌─────────────────────────────────────────────────────────────────┐
│  JOIN PATH BUILDER                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Package: ng-diagram (120KB gzipped, lazy-loaded)             │
│                                                                  │
│  Features:                                                       │
│  • Drag-drop tables from palette                               │
│  • Connect tables with edges                                    │
│  • Configure join conditions in sidebar                         │
│  • Visual representation of table chain                        │
│                                                                  │
│  Why ng-diagram?                                                 │
│  • Angular-native, zero external deps                          │
│  • Signal-based for performance                                │
│  • Customizable for our use case                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 Scope Builder

```
┌─────────────────────────────────────────────────────────────────┐
│  SCOPE BUILDER                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NOT a SQL builder (security risk)                             │
│  NOT JSON storage (hard to query/edit)                          │
│                                                                  │
│  Relational Storage:                                           │
│  • Each condition = row in rls_scope_templates                 │
│  • { column, operator, value } as structured columns           │
│  • Joined to rls_join_paths for table traversal                │
│                                                                  │
│  UI Interface:                                                  │
│  • Drag column to condition zone                               │
│  • Select operator from dropdown                               │
│  • Enter/select value                                          │
│  • Add multiple conditions                                     │
│                                                                  │
│  Test button: Returns sample rows + count                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Storage vs. Display:**
- Admin UI shows drag-drop builder (no SQL exposure)
- Underlying storage is relational (queryable, editable by services)
- `ScopeCompilerService` compiles relational conditions to SQL at query time

### 10.5 Performance Considerations

```
┌─────────────────────────────────────────────────────────────────┐
│  PERFORMANCE STRATEGY                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  • Lazy-load tree nodes (expand to load children)              │
│  • Server-side search/filter (no 10k objects in UI)            │
│  • Default max depth: 1                                        │
│  • Collapse non-matching branches in search                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 11: Current State vs Required Changes

### 11.1 Entity Locations

| Entity | Correct File Path |
|--------|-------------------|
| Group | `backend/src/modules/permissions/entities/group.entity.ts` |
| Group (compat) | `backend/src/modules/users/entities/group.entity.ts` (re-exports) |
| Role | `backend/src/modules/roles/entities/role.entity.ts` |
| Permission | `backend/src/modules/permissions/entities/permission.entity.ts` |

### 11.2 Service Locations

| Service | Correct File Path |
|---------|-------------------|
| GroupsService | `backend/src/modules/users/groups.service.ts` |
| RolesService | `backend/src/modules/roles/roles.service.ts` |
| PermissionsService | `backend/src/modules/permissions/services/permissions.service.ts` |
| CacheService | `backend/src/modules/cache/cache.service.ts` (in-memory Map) |

### 11.3 Roles - ALREADY Has Hierarchy

**Role Entity** (`backend/src/modules/roles/entities/role.entity.ts`):
```
✅ EXISTING:
- parentId (line 52-53)
- parent (line 56-58) 
- children (line 60-61)
- priority (line 63-64)
```

**RolesService** (`backend/src/modules/roles/roles.service.ts`):
```
✅ EXISTING:
- findAll() loads parent/children relations
- findOne() loads parent/children relations
- getUserPermissions() - permission aggregation

❌ MISSING:
- getAncestors()
- getDescendants()
- getEffectivePermissions() with inheritance
- validateNoCircularReference()
- Constraint validation (child ≤ parent)
```

**RolePermission entity** (`backend/src/modules/roles/entities/role-permission.entity.ts`):
```
✅ ALREADY HAS:
- isGranted field (for 3-state: true, false, null)
```

### 11.4 Groups - Needs Significant Work

**Group Entity** (`backend/src/modules/permissions/entities/group.entity.ts`):
```
✅ EXISTING:
- Basic entity structure (id, name, description)
- settings column (TEXT, stored as JSON)
- isSystemGroup flag
- ownerId, owner
- groupPermissions (relation)
- users (ManyToMany)

❌ MISSING (MUST ADD via migration):
- parentId
- parent (ManyToOne)
- children (OneToMany)
- priority
```

**GroupsService** (`backend/src/modules/users/groups.service.ts`):
```
✅ EXISTING METHODS:
- findAll() with pagination
- findOne()
- create()
- update()
- delete()
- getMembers()
- addMember()
- removeMember()
- updateSettings()

❌ MISSING (to add):
- getAncestors()
- getDescendants()
- getHierarchyPath()
- validateNoCircularReference()
- setParent()
```

### 11.5 Permission Format

```
CORRECT FORMAT: resource:action
Examples:
- users:create
- users:read
- users:update
- users:delete
- roles:read

NOT: permissions:create (incorrect)
```

### 11.6 Existing Caching

```
ALREADY EXISTS: CacheService (modules/cache/cache.service.ts)
- In-memory Map storage
- TTL-based expiry
- Methods: get(), set(), delete(), clear()
- Permission-specific: cacheUserPermissions(), getUserPermissions()

This aligns with our decision - no separate cache tables needed.
We will extend this service for RLS rules caching.
```

### 11.7 New Components Needed

```
1. Database Migration: Add Group hierarchy columns & Join Path indices
2. Custom RLS Library (`@our-org/nestjs-typeorm-rls`) utilizing `nestjs-cls`
3. RLS Rule tables (rules, join_paths, conditions, templates)
4. Admin UI (standalone page with tree, inspector, scope builder)
5. Join Path Builder (ng-diagram based)
```

---

## Part 12: Implementation Phases

### Phase 1: Database Schema

1. **Migration: Add Group Hierarchy Columns & Indices**
   - File: `backend/src/database/migrations/`
   - Add to `groups` table:
     - `parent_id` (integer, nullable, FK to groups.id)
     - `priority` (integer, nullable)
   - Add critical indices for RLS Join Paths to ensure performance:
     - `CREATE INDEX idx_users_customer ON users(customer_id);`
     - `CREATE INDEX idx_orders_user ON orders(user_id);`

2. **RLS Tables** (new):
   ```sql
   rls_join_paths:    -- Define reusable join chains
   rls_join_conditions: -- Define join conditions
   rls_rules:         -- Define scopes per group/table
   rls_scope_templates: -- Define reusable templates
   ```

### Phase 2: RLS Library & Backend Services

1. **Core RLS Library** (new package `packages/typeorm-rls`):
   - EntityManager Proxy Interceptor
   - Alias collision detection logic
   - `nestjs-cls` integration for context propagation
   - Config-driven automatic enforcement

2. **GroupsService** (`backend/src/modules/users/groups.service.ts`):
   ```
   METHODS TO ADD:
   - getAncestors(groupId)
   - getDescendants(groupId)
   - getHierarchyPath(groupId)
   - validateNoCircularReference(groupId, newParentId)
   - setParent(groupId, parentId)
   - getEffectiveMembers(groupId) - includes inherited
   ```

3. **RolesService** (`backend/src/modules/roles/roles.service.ts`):
   ```
   METHODS TO ADD:
   - getAncestors(roleId)
   - getDescendants(roleId)
   - getEffectivePermissions(roleId) - with inheritance
   - validateNoCircularReference(roleId, newParentId)
   - validatePermissionConstraints() - child ≤ parent
   ```

4. **RLS Service** (new in `backend/src/modules/permissions/services/`):
   ```
   - getScopesForTable(tableName, groupIds)
   - buildWhereClause(scopes)
   - buildJoinChain(joinPath, existingTables)
   - loadRules() / invalidateCache()
   ```

5. **Extend CacheService** (`backend/src/modules/cache/cache.service.ts`):
   ```
   METHODS TO ADD:
   - cacheRlsRules(tableName, rules)
   - getRlsRules(tableName)
   - invalidateRlsCache(tableName)
   ```

### Phase 3: API Endpoints

1. **GroupsController** (`backend/src/modules/users/groups.controller.ts`):
   - Add hierarchy endpoints (ancestors, descendants, setParent)
   - Already has: findAll, findOne, create, update, delete, addMember, removeMember

2. **RolesController** (`backend/src/modules/roles/roles.controller.ts`):
   - Add effective permissions endpoint
   - Add hierarchy endpoints

3. **RLS Controller** (new):
   - CRUD for RLS rules
   - CRUD for join paths
   - CRUD for scope templates

4. **Permission Inspector** (new or extend):
   - Get effective permissions for user/role/group
   - Show inheritance chain

### Phase 4: Frontend Components

1. Standalone admin page
2. Hierarchy tree component
3. Permission inspector
4. Scope builder (drag-drop)
5. Join path builder (ng-diagram)

---

## Appendix A: Complete Decision Summary

### Architecture

| Decision | Choice | Why |
|----------|--------|-----|
| RLS Injection | Custom Library (Proxy) | Native, safe from injection, transparent |
| No DB RLS | Application-level | Database-independent |
| Bypass mechanism | Config-driven Exemptions | Solves circular dependencies and legacy overlaps |
| Hot-reload | Cache invalidation | No restart needed |
| Context Provider | `nestjs-cls` | Safely access HTTP context in DB layer |

### Security

| Decision | Choice | Why |
|----------|--------|-----|
| Defense in depth | UI + Auth + RLS | Malicious actor prevention |
| RLS on READ | Yes | Filter visible rows |
| RLS on CREATE | Explicit Context req. | Prevents implicit tenant assignment leaks |
| RLS on UPDATE/DELETE | Yes | Block unauthorized access |

### Scope Resolution

| Decision | Choice | Why |
|----------|--------|-----|
| Multiple groups | OR between groups | UNION is intended behavior |
| Multiple conditions | AND within group | All must be true |
| Inheritance | Child adds to parent | Can restrict, not expand |
| Overlaps | No detection | Not a problem |
| Contradictions | Warn at save | Config error, not runtime |
| Parent Changes | Cascade Warning | Prevent silent invalidation of child scopes |

### Storage

| Decision | Choice | Why |
|----------|--------|-----|
| Rules in DB | Yes | Editable, dynamic |
| Cache in DB | No | Node memory is sufficient |
| Join paths central | Yes | DRY, consistent |

### UI

| Decision | Choice | Why |
|----------|--------|-----|
| Standalone page | Yes | Too heavy for sidebar |
| Permission inspector | Separate tab | Debugging tool |
| ng-diagram | Yes | Angular-native, performant |
| Drag-drop scope | Yes | No SQL injection risk |

---

## Appendix B: Not Implementing

| Item | Reason |
|------|--------|
| Cross-group conflict detection | Overlaps are intended |
| Stored procedures | Declarative rules only |
| PostgreSQL RLS | Database-independent |
| Materialized views | Skip initially |
| Subqueries in scopes | Create views instead |
| Implicit `CREATE` Tenant | Prevents data being saved to wrong tenant if multi-grouped |

---

## Appendix C: SQL Injection Examples

### Example 1: Single Group

```sql
-- User belongs to: Group A (customer_id = 1)
-- Group A scope: WHERE customer_id = 1

SELECT * FROM orders WHERE status = 'shipped';

-- After RLS:
SELECT * FROM orders 
WHERE customer_id = 1
  AND status = 'shipped';
```

### Example 2: Multiple Groups

```sql
-- User belongs to: Group A (customer=1), Group B (customer=2)

SELECT * FROM orders;

-- After RLS:
SELECT * FROM orders 
WHERE (customer_id = 1)
   OR (customer_id = 2);
```

### Example 3: Multiple Conditions

```sql
-- User belongs to: 
--   Group A: customer=1, region='US'
--   Group B: customer=2, region='EU'

SELECT * FROM orders;

-- After RLS:
SELECT * FROM orders 
WHERE (customer_id = 1 AND region = 'US')
   OR (customer_id = 2 AND region = 'EU');
```

### Example 4: Join Path Required

```sql
-- Orders table has no customer_id directly
-- Must join through users → groups

SELECT * FROM orders WHERE status = 'shipped';

-- After RLS:
SELECT * FROM orders
JOIN users ON orders.user_id = users.id
JOIN groups ON users.customer_id = groups.customer_id
WHERE groups.id IN (1, 2)
  AND status = 'shipped';
```

### Example 5: Inheritance

```sql
-- Company A (parent): customer_id = 1
-- Engineering (child of Company A): department = 'Engineering'

SELECT * FROM users;

-- After RLS:
SELECT * FROM users 
WHERE customer_id = 1
  AND department = 'Engineering';
```