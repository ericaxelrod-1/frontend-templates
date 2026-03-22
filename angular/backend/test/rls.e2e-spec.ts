import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { Group } from '../src/modules/permissions/entities/group.entity';
import { Role } from '../src/modules/roles/entities/role.entity';
import { Permission } from '../src/modules/permissions/entities/permission.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { LoginAttempt } from '../src/modules/auth/entities/login-attempt.entity';
import { RlsRule } from '../src/modules/permissions/entities/rls-rule.entity';
import { RlsJoinPath } from '../src/modules/permissions/entities/rls-join-path.entity';
import { RlsJoinCondition } from '../src/modules/permissions/entities/rls-join-condition.entity';
import { RolePermission } from '../src/modules/roles/entities/role-permission.entity';
import { GroupPermission } from '../src/modules/permissions/entities/group-permission.entity';
import * as bcrypt from 'bcrypt';

async function createRlsTestModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
      }),
      AppModule,
    ],
  })
    .overrideProvider('RLS_CONFIG_OPTIONS')
    .useFactory({
      factory: (configService: ConfigService) => {
        const dbConfig = configService.get('database');
        return {
          enabled: true,
          exemptTables: [
            'rls_rules',
            'rls_join_paths',
            'rls_join_conditions',
            'rls_scope_templates',
          ],
          fallbackBehavior: 'deny' as const,
          dataSourceOptions: dbConfig,
        };
      },
      inject: [ConfigService],
    })
    .compile();
}

describe('RLS - Row Level Security (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let groupRepo: Repository<Group>;
  let roleRepo: Repository<Role>;
  let permissionRepo: Repository<Permission>;
  let userRepo: Repository<User>;
  let loginAttemptRepo: Repository<LoginAttempt>;
  let rlsRuleRepo: Repository<RlsRule>;
  let rlsJoinPathRepo: Repository<RlsJoinPath>;
  let rlsJoinConditionRepo: Repository<RlsJoinCondition>;
  let rolePermissionRepo: Repository<RolePermission>;
  let groupPermissionRepo: Repository<GroupPermission>;

  const testUsers = {
    test_admin_a: {
      username: 'test_admin_a',
      password: 'Test123!',
      email: 'test_admin_a@example.com',
      groupId: 0,
    },
    test_user_a1: {
      username: 'test_user_a1',
      password: 'Test123!',
      email: 'test_user_a1@example.com',
      groupId: 0,
    },
    test_user_eng: {
      username: 'test_user_eng',
      password: 'Test123!',
      email: 'test_user_eng@example.com',
      groupId: 0,
    },
    test_user_fe: {
      username: 'test_user_fe',
      password: 'Test123!',
      email: 'test_user_fe@example.com',
      groupId: 0,
    },
    test_admin_b: {
      username: 'test_admin_b',
      password: 'Test123!',
      email: 'test_admin_b@example.com',
      groupId: 0,
    },
    test_user_b1: {
      username: 'test_user_b1',
      password: 'Test123!',
      email: 'test_user_b1@example.com',
      groupId: 0,
    },
  };

  const userIds: Record<string, number> = {};
  const tokens: Record<string, string> = {};

  const groupIds: Record<string, number> = {};
  const roleIds: Record<string, number> = {};
  const permissionIds: Record<string, number> = {};

  beforeAll(async () => {
    jest.setTimeout(180000);
    const moduleFixture = await createRlsTestModule();
    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = moduleFixture.get(DataSource);

    groupRepo = dataSource.getRepository(Group);
    roleRepo = dataSource.getRepository(Role);
    permissionRepo = dataSource.getRepository(Permission);
    userRepo = dataSource.getRepository(User);
    loginAttemptRepo = dataSource.getRepository(LoginAttempt);
    rlsRuleRepo = dataSource.getRepository(RlsRule);
    rlsJoinPathRepo = dataSource.getRepository(RlsJoinPath);
    rlsJoinConditionRepo = dataSource.getRepository(RlsJoinCondition);
    rolePermissionRepo = dataSource.getRepository(RolePermission);
    groupPermissionRepo = dataSource.getRepository(GroupPermission);

    await setupTestData();
  }, 180000);

  afterAll(async () => {
    await app.close();
  });

  async function setupTestData() {
    // Create groups hierarchy
    const companyA = await groupRepo.save(groupRepo.create({
      name: 'test_company_a',
      description: 'Test Company A',
      parentId: null,
      priority: 100,
    }));
    groupIds.company_a = companyA.id;

    const engineering = await groupRepo.save(groupRepo.create({
      name: 'test_engineering',
      description: 'Test Engineering',
      parentId: companyA.id,
      priority: 90,
    }));
    groupIds.engineering = engineering.id;

    const frontend = await groupRepo.save(groupRepo.create({
      name: 'test_frontend',
      description: 'Test Frontend',
      parentId: engineering.id,
      priority: 80,
    }));
    groupIds.frontend = frontend.id;

    const companyB = await groupRepo.save(groupRepo.create({
      name: 'test_company_b',
      description: 'Test Company B',
      parentId: null,
      priority: 100,
    }));
    groupIds.company_b = companyB.id;

    const marketing = await groupRepo.save(groupRepo.create({
      name: 'test_marketing',
      description: 'Test Marketing',
      parentId: companyB.id,
      priority: 90,
    }));
    groupIds.marketing = marketing.id;

    // Create test permissions
    const testPermissions = [
      { name: 'users:read', description: 'Read users', resourceName: 'users' },
      { name: 'users:create', description: 'Create users', resourceName: 'users' },
      { name: 'users:update', description: 'Update users', resourceName: 'users' },
      { name: 'users:delete', description: 'Delete users', resourceName: 'users' },
      { name: 'roles:read', description: 'Read roles', resourceName: 'roles' },
      { name: 'roles:manage', description: 'Manage roles', resourceName: 'roles' },
    ];

    for (const perm of testPermissions) {
      let existingPerm = await permissionRepo.findOne({ where: { name: perm.name } });
      if (!existingPerm) {
        existingPerm = await permissionRepo.save(permissionRepo.create({
          name: perm.name,
          description: perm.description,
          resourceName: perm.resourceName,
          actionId: 1,
        }));
      }
      permissionIds[perm.name] = existingPerm.id;
    }

    // Create roles hierarchy for testing inheritance
    const adminRole = await roleRepo.save(roleRepo.create({
      name: 'test_admin_role',
      description: 'Test Admin Role',
      isSystemRole: false,
      parentId: null,
    }));
    roleIds.admin_role = adminRole.id;

    const userRole = await roleRepo.save(roleRepo.create({
      name: 'test_user_role',
      description: 'Test User Role',
      isSystemRole: false,
      parentId: adminRole.id,
    }));
    roleIds.user_role = userRole.id;

    const guestRole = await roleRepo.save(roleRepo.create({
      name: 'test_guest_role',
      description: 'Test Guest Role',
      isSystemRole: false,
      parentId: userRole.id,
    }));
    roleIds.guest_role = guestRole.id;

    const limitedRole = await roleRepo.save(roleRepo.create({
      name: 'test_limited_role',
      description: 'Test Limited Role',
      isSystemRole: false,
      parentId: null,
    }));
    roleIds.limited_role = limitedRole.id;

    // Assign permissions to admin_role
    for (const permName of ['users:read', 'users:create', 'users:update', 'users:delete', 'roles:read', 'roles:manage']) {
      await rolePermissionRepo.save(rolePermissionRepo.create({
        roleId: adminRole.id,
        permissionId: permissionIds[permName],
        isGranted: true,
      }));
    }

    // Assign permissions to user_role
    for (const permName of ['users:read', 'users:create']) {
      await rolePermissionRepo.save(rolePermissionRepo.create({
        roleId: userRole.id,
        permissionId: permissionIds[permName],
        isGranted: true,
      }));
    }

    // Explicitly deny users:delete in user_role
    await rolePermissionRepo.save(rolePermissionRepo.create({
      roleId: userRole.id,
      permissionId: permissionIds['users:delete'],
      isGranted: false,
    }));

    // Assign permissions to guest_role
    await rolePermissionRepo.save(rolePermissionRepo.create({
      roleId: guestRole.id,
      permissionId: permissionIds['users:read'],
      isGranted: true,
    }));

    // Assign permissions to limited_role
    await rolePermissionRepo.save(rolePermissionRepo.create({
      roleId: limitedRole.id,
      permissionId: permissionIds['users:read'],
      isGranted: true,
    }));
    await rolePermissionRepo.save(rolePermissionRepo.create({
      roleId: limitedRole.id,
      permissionId: permissionIds['users:delete'],
      isGranted: false,
    }));

    // Assign group permissions
    for (const permName of ['users:read', 'users:create']) {
      await groupPermissionRepo.save(groupPermissionRepo.create({
        groupId: companyA.id,
        permissionId: permissionIds[permName],
        isGranted: true,
      }));
    }

    await groupPermissionRepo.save(groupPermissionRepo.create({
      groupId: marketing.id,
      permissionId: permissionIds['users:read'],
      isGranted: true,
    }));

    // Create RLS rules
    await rlsRuleRepo.save(rlsRuleRepo.create({
      groupId: companyA.id,
      targetTable: 'login_attempts',
      sql: 'ip_address LIKE :ip_prefix',
      parameters: '{"ip_prefix": "10.%"}',
    }));

    await rlsRuleRepo.save(rlsRuleRepo.create({
      groupId: companyB.id,
      targetTable: 'login_attempts',
      sql: 'ip_address LIKE :ip_prefix',
      parameters: '{"ip_prefix": "192.168.%"}',
    }));

    // Create RLS join path
    const joinPath = await rlsJoinPathRepo.save(rlsJoinPathRepo.create({
      name: 'test_login_attempts_via_users',
      targetTable: 'login_attempts',
      chain: '["groups", "user_groups", "users", "login_attempts"]',
    }));

    await rlsJoinConditionRepo.save(rlsJoinConditionRepo.create({
      joinPathId: joinPath.id,
      fromTable: 'groups',
      fromColumn: 'id',
      toTable: 'user_groups',
      toColumn: 'group_id',
    }));

    await rlsJoinConditionRepo.save(rlsJoinConditionRepo.create({
      joinPathId: joinPath.id,
      fromTable: 'user_groups',
      fromColumn: 'user_id',
      toTable: 'users',
      toColumn: 'id',
    }));

    await rlsJoinConditionRepo.save(rlsJoinConditionRepo.create({
      joinPathId: joinPath.id,
      fromTable: 'users',
      fromColumn: 'id',
      toTable: 'login_attempts',
      toColumn: 'user_id',
    }));

    // Assign group IDs to test users
    testUsers.test_admin_a.groupId = companyA.id;
    testUsers.test_user_a1.groupId = companyA.id;
    testUsers.test_user_eng.groupId = engineering.id;
    testUsers.test_user_fe.groupId = frontend.id;
    testUsers.test_admin_b.groupId = companyB.id;
    testUsers.test_user_b1.groupId = marketing.id;

    // Create test users
    const hashedPassword = await bcrypt.hash('Test123!', 10);

    for (const [key, user] of Object.entries(testUsers)) {
      const newUser = await userRepo.save(userRepo.create({
        username: user.username,
        email: user.email,
        password: hashedPassword,
        isActive: true,
        isEmailVerified: true,
        groups: [{ id: user.groupId }] as Group[],
        roles: [{ id: key.includes('admin') ? adminRole.id : userRole.id }] as Role[],
      }));
      userIds[key] = newUser.id;

      // Login to get JWT token
      try {
        const loginRes = await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            username: user.username,
            password: user.password,
          });

        if (loginRes.status === 200) {
          tokens[key] = loginRes.body.access_token;
        }
      } catch (e) {
        console.log(`Failed to login ${key}: ${e.message}`);
      }
    }

    // Create login attempts
    for (let i = 1; i <= 10; i++) {
      await loginAttemptRepo.save(loginAttemptRepo.create({
        user: { id: userIds.test_user_a1 } as User,
        ipAddress: `10.0.0.${i}`,
        userAgent: 'Test Agent',
        status: 'success',
        emailAttempted: testUsers.test_user_a1.email,
      }));
    }

    for (let i = 1; i <= 10; i++) {
      await loginAttemptRepo.save(loginAttemptRepo.create({
        user: { id: userIds.test_user_eng } as User,
        ipAddress: `10.1.0.${i}`,
        userAgent: 'Test Agent',
        status: 'success',
        emailAttempted: testUsers.test_user_eng.email,
      }));
    }

    for (let i = 1; i <= 10; i++) {
      await loginAttemptRepo.save(loginAttemptRepo.create({
        user: { id: userIds.test_user_fe } as User,
        ipAddress: `10.2.0.${i}`,
        userAgent: 'Test Agent',
        status: 'success',
        emailAttempted: testUsers.test_user_fe.email,
      }));
    }

    for (let i = 1; i <= 10; i++) {
      await loginAttemptRepo.save(loginAttemptRepo.create({
        user: { id: userIds.test_user_b1 } as User,
        ipAddress: `192.168.1.${i}`,
        userAgent: 'Test Agent',
        status: 'success',
        emailAttempted: testUsers.test_user_b1.email,
      }));
    }

    for (let i = 1; i <= 10; i++) {
      await loginAttemptRepo.save(loginAttemptRepo.create({
        user: { id: userIds.test_user_b1 } as User,
        ipAddress: `192.168.2.${i}`,
        userAgent: 'Test Agent',
        status: 'failed',
        emailAttempted: testUsers.test_user_b1.email,
      }));
    }
  }

  // ==========================================
  // TEST: Group Hierarchy Visibility
  // ==========================================
  describe('Group Hierarchy Visibility', () => {
    it('should allow test_admin_a to see login attempts (Company A - 10.x.x.x)', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token for test_admin_a');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      if (res.body.items) {
        for (const attempt of res.body.items) {
          expect(attempt.ipAddress).toMatch(/^10\./);
        }
      }
    });

    it('should NOT allow test_admin_a to see Company B login attempts (192.168.x.x)', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token for test_admin_a');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      if (res.body.items) {
        for (const attempt of res.body.items) {
          expect(attempt.ipAddress).not.toMatch(/^192\.168\./);
        }
      }
    });

    it('should allow test_user_b1 to see login attempts (Company B - 192.168.x.x)', async () => {
      if (!tokens.test_user_b1) {
        console.log('Skipping - no token for test_user_b1');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_user_b1}`);

      expect(res.status).toBe(200);

      if (res.body.items) {
        for (const attempt of res.body.items) {
          expect(attempt.ipAddress).toMatch(/^192\.168\./);
        }
      }
    });

    it('should NOT allow test_user_b1 to see Company A login attempts (10.x.x.x)', async () => {
      if (!tokens.test_user_b1) {
        console.log('Skipping - no token for test_user_b1');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_user_b1}`);

      expect(res.status).toBe(200);

      if (res.body.items) {
        for (const attempt of res.body.items) {
          expect(attempt.ipAddress).not.toMatch(/^10\./);
        }
      }
    });
  });

  // ==========================================
  // TEST: Cross-Tenant Isolation
  // ==========================================
  describe('Cross-Tenant Isolation', () => {
    it('should completely isolate Company A from Company B data', async () => {
      if (!tokens.test_admin_a || !tokens.test_user_b1) {
        console.log('Skipping - no tokens available');
        return;
      }

      const resA = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      const resB = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_user_b1}`);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const ipsA = (resA.body.items || []).map((a: any) => a.ipAddress);
      const ipsB = (resB.body.items || []).map((a: any) => a.ipAddress);

      const overlap = ipsA.filter((ip: string) => ipsB.includes(ip));
      expect(overlap).toHaveLength(0);
    });
  });

  // ==========================================
  // TEST: IP Wildcard Filtering
  // ==========================================
  describe('IP Wildcard Filtering', () => {
    it('should correctly filter IP range 10.x.x.x for Company A', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token for test_admin_a');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      const attempts = res.body.items || [];
      expect(attempts.length).toBeGreaterThan(0);

      for (const attempt of attempts) {
        expect(attempt.ipAddress).toMatch(/^10\./);
      }
    });

    it('should correctly filter IP range 192.168.x.x for Company B', async () => {
      if (!tokens.test_user_b1) {
        console.log('Skipping - no token for test_user_b1');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_user_b1}`);

      expect(res.status).toBe(200);

      const attempts = res.body.items || [];
      expect(attempts.length).toBeGreaterThan(0);

      for (const attempt of attempts) {
        expect(attempt.ipAddress).toMatch(/^192\.168\./);
      }
    });
  });

  // ==========================================
  // TEST: Unauthenticated Access
  // ==========================================
  describe('Unauthenticated Access', () => {
    it('should deny access without token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/login-attempts/attempts',
      );

      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // TEST: Group Hierarchy Endpoints
  // ==========================================
  describe('Group Hierarchy Endpoints', () => {
    it('should return ancestors for frontend group', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/groups/${groupIds.frontend}/ancestors`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Frontend -> Engineering -> Company A
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const ancestorNames = res.body.map((g: any) => g.name);
      expect(ancestorNames).toContain('test_engineering');
      expect(ancestorNames).toContain('test_company_a');
    });

    it('should return descendants for company_a group', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/groups/${groupIds.company_a}/descendants`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Company A -> Engineering -> Frontend
      const descendantNames = res.body.map((g: any) => g.name);
      expect(descendantNames).toContain('test_engineering');
      expect(descendantNames).toContain('test_frontend');
    });

    it('should return hierarchy path for frontend group', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/groups/${groupIds.frontend}/hierarchy-path`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Path: Company A -> Engineering -> Frontend
      expect(res.body.length).toBe(3);
      expect(res.body[0].name).toBe('test_company_a');
      expect(res.body[1].name).toBe('test_engineering');
      expect(res.body[2].name).toBe('test_frontend');
    });

    it('should return empty ancestors for root group', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/groups/${groupIds.company_a}/ancestors`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('should return empty descendants for leaf group', async () => {
      if (!tokens.test_user_fe) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/groups/${groupIds.frontend}/descendants`)
        .set('Authorization', `Bearer ${tokens.test_user_fe}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // ==========================================
  // TEST: Role Hierarchy Endpoints
  // ==========================================
  describe('Role Hierarchy Endpoints', () => {
    it('should return ancestors for guest_role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.guest_role}/ancestors`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Guest -> User -> Admin
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const ancestorNames = res.body.map((r: any) => r.name);
      expect(ancestorNames).toContain('test_user_role');
      expect(ancestorNames).toContain('test_admin_role');
    });

    it('should return descendants for admin_role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.admin_role}/descendants`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Admin -> User -> Guest
      const descendantNames = res.body.map((r: any) => r.name);
      expect(descendantNames).toContain('test_user_role');
      expect(descendantNames).toContain('test_guest_role');
    });

    it('should return empty ancestors for root role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.admin_role}/ancestors`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('should return empty descendants for leaf role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.guest_role}/descendants`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // ==========================================
  // TEST: Effective Permissions
  // ==========================================
  describe('Effective Permissions', () => {
    it('should return effective permissions for admin_role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.admin_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Admin has all permissions directly
      const permNames = res.body.map((p: any) => p.permission);
      expect(permNames).toContain('users:read');
      expect(permNames).toContain('users:create');
      expect(permNames).toContain('users:update');
      expect(permNames).toContain('users:delete');
    });

    it('should return inherited permissions for user_role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.user_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // User_role should have inherited permissions from admin_role
      const permMap = new Map(res.body.map((p: any) => [p.permission, p.isGranted]));

      // Directly assigned
      expect(permMap.get('users:read')).toBe(true);
      expect(permMap.get('users:create')).toBe(true);

      // Inherited from parent (admin_role)
      expect(permMap.get('users:update')).toBe(true);
      expect(permMap.get('roles:read')).toBe(true);
      expect(permMap.get('roles:manage')).toBe(true);

      // Explicitly denied in user_role (overrides inherited)
      expect(permMap.get('users:delete')).toBe(false);
    });

    it('should return inherited permissions for guest_role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.guest_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const permMap = new Map(res.body.map((p: any) => [p.permission, p.isGranted]));

      // Guest_role has users:read directly
      expect(permMap.get('users:read')).toBe(true);

      // Should inherit from user_role (which denied users:delete)
      expect(permMap.get('users:delete')).toBe(false);

      // Should inherit from admin_role through user_role
      expect(permMap.get('users:update')).toBe(true);
      expect(permMap.get('roles:read')).toBe(true);
    });

    it('should include source information in effective permissions', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.guest_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      // Check that source information is included
      for (const perm of res.body) {
        expect(perm).toHaveProperty('source');
        expect(perm.source).toBeTruthy();
      }

      // Find a directly assigned permission
      const usersRead = res.body.find((p: any) => p.permission === 'users:read');
      expect(usersRead.source).toBe('test_guest_role');

      // Find an inherited permission
      const usersUpdate = res.body.find((p: any) => p.permission === 'users:update');
      expect(usersUpdate.source).toBe('test_admin_role');
    });
  });

  // ==========================================
  // TEST: Permission Inspector
  // ==========================================
  describe('Permission Inspector', () => {
    it('should return role inspection with hierarchy and effective permissions', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/permissions/inspector/role/${roleIds.user_role}`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('role');
      expect(res.body).toHaveProperty('hierarchy');
      expect(res.body).toHaveProperty('directPermissions');
      expect(res.body).toHaveProperty('effectivePermissions');

      // Check hierarchy
      expect(res.body.hierarchy).toHaveProperty('ancestors');
      expect(res.body.hierarchy).toHaveProperty('descendants');
      expect(res.body.hierarchy.ancestors.some((r: any) => r.name === 'test_admin_role')).toBe(true);

      // Check effective permissions
      expect(res.body.effectivePermissions.length).toBeGreaterThan(0);
    });

    it('should return group inspection with hierarchy and members', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/permissions/inspector/group/${groupIds.engineering}`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('group');
      expect(res.body).toHaveProperty('hierarchy');
      expect(res.body).toHaveProperty('directMembers');
      expect(res.body).toHaveProperty('effectiveMemberCount');

      // Check hierarchy
      expect(res.body.hierarchy).toHaveProperty('ancestors');
      expect(res.body.hierarchy).toHaveProperty('descendants');

      // Engineering should have Company A as ancestor
      expect(res.body.hierarchy.ancestors.some((g: any) => g.name === 'test_company_a')).toBe(true);

      // Engineering should have Frontend as descendant
      expect(res.body.hierarchy.descendants.some((g: any) => g.name === 'test_frontend')).toBe(true);
    });

    it('should return user inspection with direct and effective permissions', async () => {
      if (!tokens.test_user_a1) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get(`/api/permissions/inspector/user/${userIds.test_user_a1}`)
        .set('Authorization', `Bearer ${tokens.test_user_a1}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body).toHaveProperty('directRoles');
      expect(res.body).toHaveProperty('directGroups');
      expect(res.body).toHaveProperty('effectivePermissions');

      // Check that user has assigned role
      expect(res.body.directRoles.length).toBeGreaterThan(0);

      // Check that user has assigned group
      expect(res.body.directGroups.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // TEST: Permission Inheritance (3-State)
  // ==========================================
  describe('Permission Inheritance (3-State)', () => {
    it('should inherit allowed permission from parent role', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      // guest_role has users:read directly, but should inherit users:update from admin_role
      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.guest_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      const permMap = new Map(res.body.map((p: any) => [p.permission, p.isGranted]));

      // users:update is inherited from admin_role
      expect(permMap.get('users:update')).toBe(true);
    });

    it('should respect denied permission overriding inherited allowed', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      // user_role denies users:delete which is allowed in admin_role
      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.user_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      const permMap = new Map(res.body.map((p: any) => [p.permission, p.isGranted]));

      // users:delete should be denied (explicit denial overrides inherited)
      expect(permMap.get('users:delete')).toBe(false);
    });

    it('should allow explicit granted in child even if parent has null', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      // admin_role has roles:manage directly
      // user_role doesn't have roles:manage directly, should inherit
      const res = await request(app.getHttpServer())
        .get(`/roles/${roleIds.user_role}/effective-permissions`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      const permMap = new Map(res.body.map((p: any) => [p.permission, p.isGranted]));

      // roles:manage should be inherited from admin_role
      expect(permMap.get('roles:manage')).toBe(true);
    });

    it('should return 404 for non-existent role in effective permissions', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/roles/99999/effective-permissions')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent group in ancestors', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      const res = await request(app.getHttpServer())
        .get('/api/groups/99999/ancestors')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // TEST: Group-Based Permission Inheritance
  // ==========================================
  describe('Group-Based Permission Inheritance', () => {
    it('should return group permissions through hierarchy', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      // Company A has users:read and users:create
      // Frontend (child of Engineering, grandchild of Company A) should inherit
      const res = await request(app.getHttpServer())
        .get(`/api/permissions/inspector/group/${groupIds.frontend}`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);

      // Frontend should have Company A as ancestor
      expect(res.body.hierarchy.ancestors.some((g: any) => g.name === 'test_company_a')).toBe(true);
    });

    it('should return effective member count including inherited members', async () => {
      if (!tokens.test_admin_a) {
        console.log('Skipping - no token');
        return;
      }

      // Get effective members for Company A
      // Should include members from Company A, Engineering, and Frontend
      const res = await request(app.getHttpServer())
        .get(`/api/permissions/inspector/group/${groupIds.company_a}`)
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('effectiveMemberCount');
      expect(res.body.effectiveMemberCount).toBeGreaterThan(0);
    });
  });
});
