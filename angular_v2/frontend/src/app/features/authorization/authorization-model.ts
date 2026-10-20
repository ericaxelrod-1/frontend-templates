import type {
  CapabilitySnapshot,
  GroupRow,
  MembershipRow,
  PermissionRow,
  RolePermissionRow,
  RoleRow,
  UserRoleRow,
} from './authorization.types';

/**
 * The derivations the two administration surfaces are made of.
 *
 * ## WHY THESE ARE FUNCTIONS AND NOT TEMPLATE EXPRESSIONS
 *
 * `AGENTS.md` §F5: a method call in a template binding re-evaluates on every
 * change-detection pass, and a pure transformation belongs in a pure pipe or in a
 * `computed()`. Every derivation here is a `computed()` over the loaded snapshot,
 * and every derivation is a FUNCTION of its arguments — which is what makes it
 * testable without a component, a template or an HTTP client.
 *
 * ## WHAT IS DERIVED AND WHAT IS STORED, AND WHY THE DIFFERENCE IS THE POINT
 *
 * The database stores two independent things:
 *
 *   * the hierarchy — `groups.parent_id`, materialised into `authz.org_closure` —
 *     and the membership rows in `user_groups`;
 *   * the capability — `user_roles` → `roles` → `role_permissions` →
 *     `permissions`, resolved by walking UP the role hierarchy.
 *
 * Nothing in the schema joins them, and nothing here joins them into a stored
 * answer either. The two derivations below are kept apart on purpose, and the UI
 * shows them apart, because **a role grants capability and never scope**
 * (`AGENTS.md` §B2, ADR-0023).
 *
 * ## THE CLOSURE, AND WHY IT IS NOT READ
 *
 * `authz.org_closure` is a MATERIALIZED VIEW in the `authz` schema, which is
 * deliberately outside `db-schemas` so that PostgREST cannot address it — a
 * relation in `public` with a `SELECT` grant is one `GET` away from every
 * tenant's org chart. So the tree below is built from `groups.parent_id`, which is
 * the same ancestor/descendant relation the closure materialises: the closure is a
 * denormalised copy of the parent links, computed by the database so that the
 * SCOPE POLICY can join it once per statement instead of walking the tree per
 * candidate row. The shape rendered here is that shape.
 */

/** One group as the administration surfaces render it. */
export interface GroupTreeRow {
  readonly id: string;
  readonly name: string;
  /** The parent group's id, or `null` for a root. */
  readonly parentId: string | null;
  /**
   * The parent, in words.
   *
   * Three cases, and they are different claims: a group's NAME when the parent is
   * readable, "root group" when the group really has no parent, and "not readable
   * for this role" when the parent exists but this session may not see it. A
   * member's read of `groups` returns their own subtree, so a visible group can
   * have an invisible parent — and calling that group a root would be a claim the
   * database does not make.
   */
  readonly parentLabel: string;
  /** Whether the row is part of the administrative floor. */
  readonly isSystem: boolean;
  /** How deep in the tree the row sits. Zero for a root. */
  readonly depth: number;
  /**
   * The indentation the row is rendered with, in rem.
   *
   * Computed here rather than in the template, because `AGENTS.md` §F5 forbids
   * arithmetic in a template expression: the number the page indents by is a fact
   * about the tree, and the page should not be doing arithmetic on it.
   */
  readonly indentRem: number;
  /** How many membership rows name this group. */
  readonly memberCount: number;
}

/** What a person can SEE, derived from their memberships. */
export interface MemberScope {
  /** The groups the person is in, by name. */
  readonly groups: readonly string[];
  /**
   * Every group whose rows the person can read, by name.
   *
   * The scope policy is `group_id IN (SELECT descendant …)`, so a membership in a
   * group carries the group AND its descendants. That is the closure, and it is
   * why the panel names groups the person is not a member of.
   */
  readonly reachable: readonly string[];
}

/**
 * The group tree, flattened depth-first.
 *
 * ## WHY A FLAT LIST AND NOT A RECURSIVE TEMPLATE
 *
 * A flat list with a depth is what a tree IS in this model: the hierarchy is one
 * `parent_id` column and a forest of roots, and every consumer of the tree wants
 * to walk it in order — the rows, the members, the parent picker. A recursive
 * `ng-template` would render the same shape and cost a template that re-enters
 * itself, which Angular's template type checker cannot check as thoroughly.
 *
 * ## THE GROUPS THE CALLER CANNOT SEE
 *
 * A member's read of `groups` returns their own subtree and nothing else
 * (`0001_rls_foundation.sql`: `row_scope ON groups`), so a visible group's parent
 * may be INVISIBLE. Such a group is rendered as a root of the visible forest:
 * its parent is not "none", it is "not readable for this role", and showing it as
 * a root is the honest rendering of what the database returned. The administration
 * surfaces are administrator surfaces, so this only happens to a member who typed
 * the URL.
 */
export function groupTree(
  groups: readonly GroupRow[],
  memberships: readonly MembershipRow[],
): readonly GroupTreeRow[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const nameById = new Map(groups.map((group) => [group.id, group.name]));
  const memberCounts = new Map<string, number>();
  for (const membership of memberships) {
    memberCounts.set(membership.group_id, (memberCounts.get(membership.group_id) ?? 0) + 1);
  }

  const childrenOf = new Map<string, GroupRow[]>();
  const roots: GroupRow[] = [];
  for (const group of groups) {
    const parentId = group.parent_id ?? null;
    if (parentId !== null && byId.has(parentId)) {
      const bucket = childrenOf.get(parentId);
      if (bucket === undefined) {
        childrenOf.set(parentId, [group]);
      } else {
        bucket.push(group);
      }
    } else {
      roots.push(group);
    }
  }

  const byName = (left: GroupRow, right: GroupRow): number => left.name.localeCompare(right.name);
  roots.sort(byName);
  for (const bucket of childrenOf.values()) {
    bucket.sort(byName);
  }

  const rows: GroupTreeRow[] = [];
  const visited = new Set<string>();
  const walk = (group: GroupRow, depth: number): void => {
    // The database refuses a cycle, so the visited set never fires on a healthy
    // tree. It is here because a tree builder that can loop forever on bad data is
    // a hang in the browser, and the browser is where a bad tree would be read.
    if (visited.has(group.id)) {
      return;
    }
    visited.add(group.id);
    const parentId = group.parent_id ?? null;
    const parentName = parentId === null ? undefined : nameById.get(parentId);
    rows.push({
      id: group.id,
      name: group.name,
      parentId,
      parentLabel:
        parentId === null
          ? 'root group'
          : parentName === undefined
            ? 'not readable for this role'
            : parentName,
      isSystem: group.is_system_group,
      depth,
      indentRem: depth * 1.25,
      memberCount: memberCounts.get(group.id) ?? 0,
    });
    for (const child of childrenOf.get(group.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) {
    walk(root, 0);
  }
  return rows;
}

/**
 * The descendants of a set of groups, the groups themselves included.
 *
 * This is the scope closure, computed from the parent links rather than read from
 * `authz.org_closure` — see the file header for why that view is not reachable
 * over HTTP.
 */
export function descendantGroupIds(
  groups: readonly GroupRow[],
  roots: readonly string[],
): ReadonlySet<string> {
  const childrenOf = new Map<string, string[]>();
  for (const group of groups) {
    const parentId = group.parent_id ?? null;
    if (parentId === null) {
      continue;
    }
    const bucket = childrenOf.get(parentId);
    if (bucket === undefined) {
      childrenOf.set(parentId, [group.id]);
    } else {
      bucket.push(group.id);
    }
  }

  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || reached.has(id)) {
      continue;
    }
    reached.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      queue.push(child);
    }
  }
  return reached;
}

/**
 * What a person can SEE: the groups they are in, and the groups whose rows those
 * memberships carry.
 */
export function memberScope(
  userId: string,
  memberships: readonly MembershipRow[],
  groups: readonly GroupRow[],
): MemberScope {
  const direct = memberships
    .filter((membership) => membership.user_id === userId)
    .map((membership) => membership.group_id);
  const names = new Map(groups.map((group) => [group.id, group.name]));
  const reachable = descendantGroupIds(groups, direct);

  const groupNames = direct
    .map((id) => names.get(id))
    .filter((name): name is string => name !== undefined)
    .sort();
  const reachableNames = [...reachable]
    .map((id) => names.get(id))
    .filter((name): name is string => name !== undefined)
    .sort();

  return { groups: groupNames, reachable: reachableNames };
}

/**
 * The capabilities a role carries DIRECTLY — the rows in `role_permissions` that
 * name it, with no inheritance applied.
 */
export function directPermissions(
  roleId: string,
  rolePermissions: readonly RolePermissionRow[],
  permissions: readonly PermissionRow[],
): readonly string[] {
  const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
  const granted = new Set<string>();
  for (const rolePermission of rolePermissions) {
    if (rolePermission.role_id !== roleId) {
      continue;
    }
    const permission = permissionById.get(rolePermission.permission_id);
    if (permission !== undefined) {
      granted.add(`${permission.resource}:${permission.action_id}`);
    }
  }
  return [...granted].sort();
}

/**
 * The capabilities a role carries, INCLUDING everything it inherits.
 *
 * The walk goes UP: a child role holds everything its ancestors hold
 * (`0001_rls_foundation.sql`, `has_permission()`). The ancestor set is seeded in
 * the walk and the walk is guarded against a cycle, because a cyclic role graph
 * makes each role in it inherit the whole cycle — the database refuses one
 * (`assert_role_acyclic()`), and this is the second layer.
 */
export function effectivePermissions(
  roleId: string,
  roles: readonly RoleRow[],
  rolePermissions: readonly RolePermissionRow[],
  permissions: readonly PermissionRow[],
): readonly string[] {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const granted = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    for (const capability of directPermissions(id, rolePermissions, permissions)) {
      granted.add(capability);
    }
    const parentId = roleById.get(id)?.parent_id ?? null;
    if (parentId !== null) {
      walk(parentId);
    }
  };
  walk(roleId);
  return [...granted].sort();
}

/**
 * The capabilities a PERSON holds: the union over the roles they hold, each
 * resolved up its own hierarchy.
 *
 * The union is over CAPABILITIES and never over scopes: a role held by a person
 * says what that person may do, and says nothing about which rows they may see.
 */
export function memberCapabilities(
  userId: string,
  userRoles: readonly UserRoleRow[],
  roles: readonly RoleRow[],
  rolePermissions: readonly RolePermissionRow[],
  permissions: readonly PermissionRow[],
): readonly string[] {
  const held = new Set<string>();
  for (const assignment of userRoles) {
    if (assignment.user_id !== userId) {
      continue;
    }
    for (const capability of effectivePermissions(
      assignment.role_id,
      roles,
      rolePermissions,
      permissions,
    )) {
      held.add(capability);
    }
  }
  return [...held].sort();
}

/**
 * The capabilities held by the MEMBERS of a group.
 *
 * **This is a derivation and not a property of the group.** Nothing in the schema
 * associates a role with a group, and nothing may: a role is capability and a
 * group is scope, and a table in which the two appear on one row is the
 * arrangement ADR-0023 records as the one that fails silently. What this function
 * answers is therefore "what can the people in this group do", which is a fact
 * about the MEMBERSHIP and changes the moment a membership or a role assignment
 * changes.
 */
export function groupCapabilities(
  groupId: string,
  memberships: readonly MembershipRow[],
  userRoles: readonly UserRoleRow[],
  roles: readonly RoleRow[],
  rolePermissions: readonly RolePermissionRow[],
  permissions: readonly PermissionRow[],
): readonly string[] {
  const held = new Set<string>();
  for (const membership of memberships) {
    if (membership.group_id !== groupId) {
      continue;
    }
    for (const capability of memberCapabilities(
      membership.user_id,
      userRoles,
      roles,
      rolePermissions,
      permissions,
    )) {
      held.add(capability);
    }
  }
  return [...held].sort();
}

/** The roles a person holds. */
export function rolesHeldByUser(
  userId: string,
  userRoles: readonly UserRoleRow[],
  roles: readonly RoleRow[],
): readonly RoleRow[] {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const held = new Set<string>();
  for (const assignment of userRoles) {
    if (assignment.user_id === userId) {
      held.add(assignment.role_id);
    }
  }
  return [...held]
    .map((id) => roleById.get(id))
    .filter((role): role is RoleRow => role !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The roles held by the MEMBERS of a group — the derived answer to "what roles
 * does this group hold", which is a question about the group's MEMBERS and not
 * about the group.
 */
export function rolesHeldByGroup(
  groupId: string,
  memberships: readonly MembershipRow[],
  userRoles: readonly UserRoleRow[],
  roles: readonly RoleRow[],
): readonly RoleRow[] {
  const held = new Set<string>();
  for (const membership of memberships) {
    if (membership.group_id !== groupId) {
      continue;
    }
    for (const role of rolesHeldByUser(membership.user_id, userRoles, roles)) {
      held.add(role.id);
    }
  }
  return [...held]
    .map((id) => roles.find((role) => role.id === id))
    .filter((role): role is RoleRow => role !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** A role and its effective capabilities, for the roles table. */
export interface RoleView {
  readonly role: RoleRow;
  /**
   * The parent role, in words: its name, or a dash for a role that inherits from
   * nothing.
   *
   * A word rather than a nullable name, because `AGENTS.md` §F5 forbids a
   * fallback expression in a template: the table renders one value.
   */
  readonly parentLabel: string;
  /** The capabilities the role carries DIRECTLY. */
  readonly own: readonly string[];
  /** The capabilities the role carries, inherited ones included. */
  readonly effective: readonly string[];
}

/** The role table, with each role's own and effective capabilities. */
export function roleViews(snapshot: CapabilitySnapshot): readonly RoleView[] {
  const nameById = new Map(snapshot.roles.map((role) => [role.id, role.name]));
  return [...snapshot.roles]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((role) => {
      const parentId = role.parent_id ?? null;
      const parentName = parentId === null ? undefined : nameById.get(parentId);
      return {
        role,
        parentLabel: parentName ?? '—',
        own: directPermissions(role.id, snapshot.rolePermissions, snapshot.permissions),
        effective: effectivePermissions(
          role.id,
          snapshot.roles,
          snapshot.rolePermissions,
          snapshot.permissions,
        ),
      };
    });
}
