import { describe, expect, it } from 'vitest';
import {
  descendantGroupIds,
  effectivePermissions,
  groupCapabilities,
  groupTree,
  memberCapabilities,
  memberScope,
  roleViews,
  rolesHeldByGroup,
  rolesHeldByUser,
} from './authorization-model';
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
 * The derivations, asserted on their own.
 *
 * These are pure functions of the loaded snapshot, so they can be tested without a
 * component, a template or an HTTP client — and the properties that matter here
 * are properties of the DERIVATION, not of the page that renders it.
 */

const ROOT = 'g-root';
const EU = 'g-eu';
const FR = 'g-fr';
const HQ = 'g-hq';

const ALICE = 'u-alice';
const BOB = 'u-bob';

function group(id: string, name: string, parentId: string | null): GroupRow {
  return {
    id,
    name,
    parent_id: parentId ?? undefined,
    is_system_group: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function membership(userId: string, groupId: string): MembershipRow {
  return { user_id: userId, group_id: groupId };
}

/** root → EU → FR, and a standalone HQ. */
const GROUPS: readonly GroupRow[] = [
  group(ROOT, 'root', null),
  group(EU, 'EU', ROOT),
  group(FR, 'FR', EU),
  group(HQ, 'HQ', null),
];

const ADMIN_ROLE = 'r-admin';
const MANAGER_ROLE = 'r-manager';

function role(id: string, name: string, parentId: string | null): RoleRow {
  return {
    id,
    name,
    parent_id: parentId ?? undefined,
    is_system_role: false,
  };
}

function permission(id: string, resource: string, action: string): PermissionRow {
  return { id, resource, action_id: action };
}

const PROJECT_READ = permission('p-project-read', 'project', 'read');
const CUSTOMER_READ = permission('p-customer-read', 'customer', 'read');

const ROLES: readonly RoleRow[] = [
  role(ADMIN_ROLE, 'admin', null),
  role(MANAGER_ROLE, 'manager', ADMIN_ROLE),
];

const ROLE_PERMISSIONS: readonly RolePermissionRow[] = [
  { role_id: ADMIN_ROLE, permission_id: PROJECT_READ.id },
  { role_id: ADMIN_ROLE, permission_id: CUSTOMER_READ.id },
  { role_id: MANAGER_ROLE, permission_id: PROJECT_READ.id },
];

const PERMISSIONS: readonly PermissionRow[] = [PROJECT_READ, CUSTOMER_READ];

const USER_ROLES: readonly UserRoleRow[] = [
  { user_id: ALICE, role_id: MANAGER_ROLE },
  { user_id: BOB, role_id: ADMIN_ROLE },
];

describe('the group tree', () => {
  it('renders the hierarchy, and a nested group is nested', () => {
    const tree = groupTree(GROUPS, []);

    // The roots first, in name order, each with its subtree under it: HQ and root
    // are roots, and FR hangs two levels below root.
    expect(tree.map((row) => row.name)).toEqual(['HQ', 'root', 'EU', 'FR']);
    // The depth is the nesting: FR is two levels below root, and the flat list is
    // how the page indents it.
    expect(tree.find((row) => row.name === 'FR')?.depth).toBe(2);
    expect(tree.find((row) => row.name === 'EU')?.depth).toBe(1);
  });

  it('calls a group with no parent a root group, and names a readable parent', () => {
    const tree = groupTree(GROUPS, []);

    expect(tree.find((row) => row.name === 'root')?.parentLabel).toBe('root group');
    expect(tree.find((row) => row.name === 'FR')?.parentLabel).toBe('EU');
  });

  /**
   * A member's read of `groups` returns their own subtree, so a visible group can
   * have a parent this session may not see. Calling that group a root would be a
   * claim the database does not make.
   */
  it('says so when the parent is not readable for this role', () => {
    const tree = groupTree([group(EU, 'EU', ROOT)], []);

    expect(tree[0]?.parentLabel).toBe('not readable for this role');
  });

  it('counts the members of each group', () => {
    const tree = groupTree(GROUPS, [membership(ALICE, EU), membership(BOB, EU), membership(ALICE, FR)]);

    expect(tree.find((row) => row.name === 'EU')?.memberCount).toBe(2);
    expect(tree.find((row) => row.name === 'FR')?.memberCount).toBe(1);
    expect(tree.find((row) => row.name === 'root')?.memberCount).toBe(0);
  });
});

describe('the scope closure', () => {
  it('reaches a group and its descendants, and not its ancestors', () => {
    const reached = descendantGroupIds(GROUPS, [EU]);

    // A membership in EU carries EU and everything below it. The scope policy
    // joins the closure on the DESCENDANT side, so an ancestor is not reached.
    expect([...reached].sort()).toEqual([EU, FR].sort());
  });

  it('names the groups a person is in and the groups whose rows they may read', () => {
    const scope = memberScope(ALICE, [membership(ALICE, EU)], GROUPS);

    expect(scope.groups).toEqual(['EU']);
    expect(scope.reachable).toEqual(['EU', 'FR']);
  });

  it('says nothing for a person with no membership', () => {
    const scope = memberScope(ALICE, [], GROUPS);

    expect(scope.groups).toEqual([]);
    expect(scope.reachable).toEqual([]);
  });
});

describe('the capability axis', () => {
  it('inherits up the role hierarchy', () => {
    const capabilities = effectivePermissions(MANAGER_ROLE, ROLES, ROLE_PERMISSIONS, PERMISSIONS);

    // The manager holds `project:read` directly and inherits `customer:read` from
    // the admin role above it.
    expect(capabilities).toEqual(['customer:read', 'project:read']);
  });

  it('unions the capabilities of every role a person holds', () => {
    const capabilities = memberCapabilities(
      BOB,
      USER_ROLES,
      ROLES,
      ROLE_PERMISSIONS,
      PERMISSIONS,
    );

    expect(capabilities).toEqual(['customer:read', 'project:read']);
  });

  it('is empty for a person who holds no role, and never says "no" for a person it cannot see', () => {
    const capabilities = memberCapabilities(
      'u-nobody',
      USER_ROLES,
      ROLES,
      ROLE_PERMISSIONS,
      PERMISSIONS,
    );

    expect(capabilities).toEqual([]);
  });
});

describe("the roles a group holds", () => {
  const MEMBERSHIPS: readonly MembershipRow[] = [
    membership(ALICE, EU),
    membership(BOB, EU),
    membership(ALICE, FR),
  ];

  it('is DERIVED from the members, not a property of the group', () => {
    const held = rolesHeldByGroup(EU, MEMBERSHIPS, USER_ROLES, ROLES);

    // Alice holds the manager role and Bob the admin role; the group holds both
    // because its members hold them.
    expect(held.map((row) => row.name)).toEqual(['admin', 'manager']);
  });

  it('is empty for a group with no members', () => {
    expect(rolesHeldByGroup(HQ, MEMBERSHIPS, USER_ROLES, ROLES)).toEqual([]);
  });

  it('changes when a role is revoked from one of the members', () => {
    // FR has one member: Alice. Her capability IS the group's derived capability,
    // so revoking her role has to change the group's set — and the membership is
    // untouched, because the SCOPE half of the answer does not move.
    const before = groupCapabilities(FR, MEMBERSHIPS, USER_ROLES, ROLES, ROLE_PERMISSIONS, PERMISSIONS);
    expect(before).toEqual(['customer:read', 'project:read']);

    const afterRevocation = USER_ROLES.filter(
      (row) => !(row.user_id === ALICE && row.role_id === MANAGER_ROLE),
    );
    const after = groupCapabilities(FR, MEMBERSHIPS, afterRevocation, ROLES, ROLE_PERMISSIONS, PERMISSIONS);

    expect(after).toEqual([]);
    // The scope did not move: Alice is still in the group.
    expect(memberScope(ALICE, MEMBERSHIPS, GROUPS).groups).toEqual(['EU', 'FR']);
  });

  it('lists the roles a person holds', () => {
    const held = rolesHeldByUser(ALICE, USER_ROLES, ROLES);

    expect(held.map((row) => row.name)).toEqual(['manager']);
  });
});

describe('the role table', () => {
  const snapshot: CapabilitySnapshot = {
    roles: ROLES,
    userRoles: USER_ROLES,
    rolePermissions: ROLE_PERMISSIONS,
    permissions: PERMISSIONS,
  };

  it('separates what a role carries directly from what it may do', () => {
    const views = roleViews(snapshot);
    const manager = views.find((view) => view.role.name === 'manager');

    expect(manager?.own).toEqual(['project:read']);
    expect(manager?.effective).toEqual(['customer:read', 'project:read']);
  });

  it('names the role a role inherits from', () => {
    const views = roleViews(snapshot);

    expect(views.find((view) => view.role.name === 'manager')?.parentLabel).toBe('admin');
    expect(views.find((view) => view.role.name === 'admin')?.parentLabel).toBe('—');
  });
});
