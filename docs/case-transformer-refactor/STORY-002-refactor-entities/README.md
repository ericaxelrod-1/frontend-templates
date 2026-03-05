# STORY-002: Refactor All Entity Files

## Overview

With the `SnakeNamingStrategy` active (from STORY-001), all entities can be simplified. For each entity file:

1. **Remove** explicit `{ name: 'snake_case' }` parameters from `@Column()`, `@CreateDateColumn()`, and `@UpdateDateColumn()` decorators — the naming strategy now handles this automatically
2. **Remove** backward-compatibility getter/setter pairs — they are no longer needed
3. **Keep** explicit `name:` parameters on `@JoinColumn()`, `@JoinTable()`, `@PrimaryColumn()`, and `@Entity()` decorators — the naming strategy does NOT affect these

> [!CAUTION]
> ## NEVER DO
> - **NEVER** remove `name:` from `@JoinColumn()`, `@JoinTable()`, `@PrimaryColumn()`, or `@Entity()` decorators. The naming strategy only affects `@Column` property-to-column mappings, NOT join metadata, primary columns with explicit names, or table names.
> - **NEVER** rename any TypeScript property. All property names stay exactly as they are (camelCase). You are only removing the `name:` parameter from decorators and removing getter/setter pairs.
> - **NEVER** skip the verification task (TASK-022) or proceed to the next STORY before TASK-022 passes with zero errors.
> - **NEVER** skip repair tasks (TASK-023 through TASK-035). Removing a getter/setter alias from an entity **WILL** break any service code that references the old alias. You MUST fix all references.

> [!IMPORTANT]
> ## ALWAYS DO
> - **ALWAYS** run `npx tsc --noEmit` after completing entity edits, before moving on.
> - **ALWAYS** complete TASK-022 through TASK-035 (repair tasks) before proceeding to STORY-003.
> - **ALWAYS** check that the old alias you are removing is not used anywhere in service code. If it is, there will be an explicit repair task for it — complete that task.

## Important Rules

> **CRITICAL**: Do NOT remove `name:` from `@JoinColumn()`, `@JoinTable()`, `@PrimaryColumn()`, or `@Entity()` decorators. The naming strategy only affects `@Column` property-to-column mappings, NOT join metadata, primary columns with explicit names, or table names.

> **CRITICAL**: Do NOT rename any TypeScript property. All property names stay exactly as they are (camelCase). You are only removing the `name:` parameter from decorators and removing getter/setter pairs.

## Tasks

Each task covers one entity file. Tasks within this story can be executed in any order (they are independent), **EXCEPT** TASK-022 through TASK-035 which MUST be completed after TASK-001 through TASK-021.

### Phase 1: Entity Edits (TASK-001 to TASK-021)

| # | Task | Entity File | Status |
|---|------|-------------|--------|
| 1 | [TASK-001](./TASK-001-user-entity.md) | `users/entities/user.entity.ts` | Completed |
| 2 | [TASK-002](./TASK-002-captcha-entity.md) | `auth/entities/captcha.entity.ts` | Completed |
| 3 | [TASK-003](./TASK-003-login-attempt-entity.md) | `auth/entities/login-attempt.entity.ts` | Completed |
| 4 | [TASK-004](./TASK-004-ip-reputation-entity.md) | `auth/entities/ip-reputation.entity.ts` | Completed |
| 5 | [TASK-005](./TASK-005-security-alert-entity.md) | `auth/entities/security-alert.entity.ts` | Completed |
| 6 | [TASK-006](./TASK-006-security-detected-pattern-entity.md) | `auth/entities/security-detected-pattern.entity.ts` | Completed |
| 7 | [TASK-007](./TASK-007-pattern-login-attempt-entity.md) | `auth/entities/pattern-login-attempt.entity.ts` | Completed |
| 8 | [TASK-008](./TASK-008-permission-entity.md) | `permissions/entities/permission.entity.ts` | Completed |
| 9-21 | [TASK-009 to TASK-021](./TASK-009-to-021-remaining-entities.md) | Remaining entities | Completed |

### Phase 2: Verification (TASK-022)

| # | Task | Description | Status |
|---|------|-------------|--------|
| 22 | [TASK-022](./TASK-022-verify-compilation.md) | Verify compilation (DO NOT FIX — just verify) | Completed |

### Phase 3: Repair Broken References (TASK-023 to TASK-035)

> [!WARNING]
> These tasks exist because removing getter/setter aliases from entities breaks all service code that used the old alias names. Each task below provides **exact line-by-line edits** for the consuming code. **DO NOT SKIP THESE.**

| # | Task | File to Repair | Status |
|---|------|---------------|--------|
| 23 | [TASK-023](./TASK-023-fix-captcha-service.md) | `auth/services/captcha.service.ts` | Completed |
| 24 | [TASK-024](./TASK-024-fix-ip-reputation-controller.md) | `auth/controllers/ip-reputation.controller.ts` | Completed |
| 25 | [TASK-025](./TASK-025-fix-login-monitoring-controller.md) | `auth/controllers/login-monitoring.controller.ts` | Completed |
| 26 | [TASK-026](./TASK-026-fix-actions-controller.md) | `permissions/actions.controller.ts` | Completed |
| 27 | [TASK-027](./TASK-027-fix-route-scanner.md) | `permissions/scanners/route-scanner.service.ts` | Completed |
| 28 | [TASK-028](./TASK-028-fix-component-scanner.md) | `permissions/scanners/component-scanner.service.ts` | Completed |
| 29 | [TASK-029](./TASK-029-fix-endpoint-scanner.md) | `permissions/scanners/endpoint-scanner.service.ts` | Completed |
| 30 | [TASK-030](./TASK-030-fix-manifest-service.md) | `permissions/scanners/manifest.service.ts` | Completed |
| 31 | [TASK-031](./TASK-031-fix-permissions-service.md) | `permissions/services/permissions.service.ts` | Completed |
| 32 | [TASK-032](./TASK-032-fix-permission-checker-service.md) | `permissions/services/permission-checker.service.ts` | Completed |
| 33 | [TASK-033](./TASK-033-fix-roles-service.md) | `roles/roles.service.ts` | Completed |
| 34 | [TASK-034](./TASK-034-fix-test-scripts.md) | Test scripts | Completed |
| 35 | [TASK-035](./TASK-035-final-verification.md) | Final verification | Completed |

## Files NOT modified (and why)

| File | Reason |
|------|--------|
| `permissions/entities/role.entity.ts` | Re-export file only — no entity definition |
| `permissions/entities/route.entity.ts` | Already uses no explicit `name:` params (already compatible) |
| `permissions/cache-entities/cache-entry.entity.ts` | Base class with no explicit `name:` params (already compatible) |
| `user/entities/user.entity.ts` | Re-export file only — no entity definition |
| `users/entities/group.entity.ts` | Re-export file only — no entity definition |
| `users/entities/role.entity.ts` | Re-export file only — no entity definition |
