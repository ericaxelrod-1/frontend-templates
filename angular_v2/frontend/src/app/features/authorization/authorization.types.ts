import type { components } from '../../api/schema';

/**
 * The row shapes the administration surfaces read, taken from the generated
 * contract.
 *
 * `AGENTS.md` §B4: the client is generated from `openapi.json`, and a hand-written
 * response interface is a copy of the contract that can drift from it. Every shape
 * here is a `Pick` of — or the whole of — a generated schema, so a column that is
 * renamed in the database fails `npm run generate:client` plus typecheck here
 * rather than arriving as `undefined` in a table cell.
 */

/** A row of `groups` — the scope axis's hierarchy. */
export type GroupRow = components['schemas']['groups'];

/** A row of `user_groups` — who is in which group. */
export type MembershipRow = components['schemas']['user_groups'];

/** A row of `roles` — the capability axis's hierarchy. */
export type RoleRow = components['schemas']['roles'];

/** A row of `role_permissions` — what a role carries, directly. */
export type RolePermissionRow = components['schemas']['role_permissions'];

/** A row of `permissions` — a capability: a resource and an action. */
export type PermissionRow = components['schemas']['permissions'];

/** A row of `user_roles` — what capabilities a person has. */
export type UserRoleRow = components['schemas']['user_roles'];

/**
 * A `users` row, reduced to the three columns a name is made of.
 *
 * `password_hash` is absent from the `Pick` and cannot be added to it by
 * accident: the member column grant does not include it, and naming a column the
 * role does not hold fails the WHOLE read with `403` rather than omitting that one
 * key.
 */
export type UserRow = Pick<components['schemas']['users'], 'id' | 'username' | 'email'>;

/**
 * The body of a group CREATE, taken from the generated schema rather than
 * written out.
 *
 * `parent_id` is OPTIONAL in the generated type, and that is the wire's way of
 * saying "the column may be absent": a create without it leaves the column at its
 * default, and a move always names one. A `null` is never sent, because
 * `PostgREST` would have to be told to write a NULL rather than to omit the
 * column, and the two are different requests.
 */
export type GroupCreate = Pick<GroupRow, 'name' | 'parent_id'>;

/**
 * The body of a group MOVE: the parent the group is moved under.
 *
 * A separate type from the create because the two statements name different
 * columns, and a body type that permitted both would let a rename carry a parent
 * it never meant to change.
 */
export type GroupMove = Pick<GroupRow, 'parent_id'>;

/**
 * Everything the SCOPE axis is made of, read in one go.
 *
 * The three reads are one snapshot because they answer one question — "what is the
 * hierarchy and who is in it" — and because a `403` on any of them means the same
 * thing: this session may not read the scope axis.
 */
export interface ScopeSnapshot {
  readonly groups: readonly GroupRow[];
  readonly memberships: readonly MembershipRow[];
  readonly users: readonly UserRow[];
}

/**
 * Everything the CAPABILITY axis is made of, read in one go.
 *
 * These four tables are admin-only at the table level (`0001_rls_foundation.sql`:
 * "THE CAPABILITY AXIS IS ADMIN-ONLY AT THE TABLE LEVEL"), so a member's read of
 * this snapshot is refused outright. That refusal is why it is a separate snapshot
 * from the scope one: a `403` on the capability axis must not take the scope axis
 * down with it, and the two are read separately so that it does not.
 */
export interface CapabilitySnapshot {
  readonly roles: readonly RoleRow[];
  readonly userRoles: readonly UserRoleRow[];
  readonly rolePermissions: readonly RolePermissionRow[];
  readonly permissions: readonly PermissionRow[];
}
