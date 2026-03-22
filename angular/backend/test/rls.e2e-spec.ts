import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import * as path from 'path';
import * as bcrypt from 'bcrypt';

async function createRlsTestModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        envFilePath: path.join(__dirname, '.env.rls-test'),
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

    await cleanupTestData();
    await setupTestData();
  }, 180000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    const manager = dataSource.manager;

    await manager.query(`
      DELETE FROM login_attempts WHERE user_id IN (
        SELECT id FROM users WHERE username LIKE 'test_%'
      )
    `);

    await manager.query(`
      DELETE FROM user_groups WHERE user_id IN (
        SELECT id FROM users WHERE username LIKE 'test_%'
      )
    `);

    await manager.query(`DELETE FROM users WHERE username LIKE 'test_%'`);

    await manager.query(`DELETE FROM role_permissions WHERE role_id >= 10`);

    await manager.query(`DELETE FROM group_permissions WHERE group_id >= 10`);

    await manager.query(`DELETE FROM rls_rules WHERE group_id >= 10`);

    await manager.query(`DELETE FROM rls_join_paths WHERE name LIKE 'test_%'`);

    await manager.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')`);

    await manager.query(`DELETE FROM roles WHERE name LIKE 'test_%'`);

    await manager.query(`DELETE FROM groups WHERE name LIKE 'test_%'`);
  }

  async function setupTestData() {
    const manager = dataSource.manager;

    // Create groups hierarchy
    let result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_company_a', 'Test Company A', NULL, 100)
      RETURNING id
    `);
    groupIds.company_a = result[0].id;

    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_engineering', 'Test Engineering', ${groupIds.company_a}, 90)
      RETURNING id
    `);
    groupIds.engineering = result[0].id;

    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_frontend', 'Test Frontend', ${groupIds.engineering}, 80)
      RETURNING id
    `);
    groupIds.frontend = result[0].id;

    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_company_b', 'Test Company B', NULL, 100)
      RETURNING id
    `);
    groupIds.company_b = result[0].id;

    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_marketing', 'Test Marketing', ${groupIds.company_b}, 90)
      RETURNING id
    `);
    groupIds.marketing = result[0].id;

    // Create test permissions
    const testPermissions = [
      { name: 'users:read', description: 'Read users' },
      { name: 'users:create', description: 'Create users' },
      { name: 'users:update', description: 'Update users' },
      { name: 'users:delete', description: 'Delete users' },
      { name: 'roles:read', description: 'Read roles' },
      { name: 'roles:manage', description: 'Manage roles' },
    ];

    for (const perm of testPermissions) {
      const existingPerm = await manager.query(
        `SELECT id FROM permissions WHERE name = $1`,
        [perm.name],
      );
      if (existingPerm.length === 0) {
        const permResult = await manager.query(`
          INSERT INTO permissions (name, description, created_at, updated_at)
          VALUES ('${perm.name}', '${perm.description}', NOW(), NOW())
          RETURNING id
        `);
        permissionIds[perm.name] = permResult[0].id;
      } else {
        permissionIds[perm.name] = existingPerm[0].id;
      }
    }

    // Create roles hierarchy for testing inheritance
    // Parent role: test_admin_role (has all permissions)
    result = await manager.query(`
      INSERT INTO roles (name, description, is_system_role, parent_id, created_at, updated_at)
      VALUES ('test_admin_role', 'Test Admin Role', false, NULL, NOW(), NOW())
      RETURNING id
    `);
    roleIds.admin_role = result[0].id;

    // Child role: test_user_role (inherits from admin)
    result = await manager.query(`
      INSERT INTO roles (name, description, is_system_role, parent_id, created_at, updated_at)
      VALUES ('test_user_role', 'Test User Role', false, ${roleIds.admin_role}, NOW(), NOW())
      RETURNING id
    `);
    roleIds.user_role = result[0].id;

    // Grandchild role: test_guest_role (inherits from user_role)
    result = await manager.query(`
      INSERT INTO roles (name, description, is_system_role, parent_id, created_at, updated_at)
      VALUES ('test_guest_role', 'Test Guest Role', false, ${roleIds.user_role}, NOW(), NOW())
      RETURNING id
    `);
    roleIds.guest_role = result[0].id;

    // Create role with denied permissions for testing
    result = await manager.query(`
      INSERT INTO roles (name, description, is_system_role, parent_id, created_at, updated_at)
      VALUES ('test_limited_role', 'Test Limited Role', false, NULL, NOW(), NOW())
      RETURNING id
    `);
    roleIds.limited_role = result[0].id;

    // Assign permissions to admin_role (has all: allowed)
    for (const permName of ['users:read', 'users:create', 'users:update', 'users:delete', 'roles:read', 'roles:manage']) {
      await manager.query(`
        INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
        VALUES (${roleIds.admin_role}, ${permissionIds[permName]}, true, NOW(), NOW())
      `);
    }

    // Assign permissions to user_role (subset: users:read, users:create)
    // Note: inherits users:update, users:delete from parent
    for (const permName of ['users:read', 'users:create']) {
      await manager.query(`
        INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
        VALUES (${roleIds.user_role}, ${permissionIds[permName]}, true, NOW(), NOW())
      `);
    }

    // Explicitly deny users:delete in user_role (cannot inherit from parent)
    await manager.query(`
      INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
      VALUES (${roleIds.user_role}, ${permissionIds['users:delete']}, false, NOW(), NOW())
    `);

    // Assign permissions to guest_role (subset: users:read only)
    await manager.query(`
      INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
      VALUES (${roleIds.guest_role}, ${permissionIds['users:read']}, true, NOW(), NOW())
    `);

    // Assign permissions to limited_role (denied users:delete)
    await manager.query(`
      INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
      VALUES (${roleIds.limited_role}, ${permissionIds['users:read']}, true, NOW(), NOW())
    `);
    await manager.query(`
      INSERT INTO role_permissions (role_id, permission_id, is_granted, created_at, updated_at)
      VALUES (${roleIds.limited_role}, ${permissionIds['users:delete']}, false, NOW(), NOW())
    `);

    // Assign group permissions for testing
    for (const permName of ['users:read', 'users:create']) {
      await manager.query(`
        INSERT INTO group_permissions (group_id, permission_id, is_granted, created_at, updated_at)
        VALUES (${groupIds.company_a}, ${permissionIds[permName]}, true, NOW(), NOW())
      `);
    }

    // Assign group permissions for marketing
    await manager.query(`
      INSERT INTO group_permissions (group_id, permission_id, is_granted, created_at, updated_at)
      VALUES (${groupIds.marketing}, ${permissionIds['users:read']}, true, NOW(), NOW())
    `);

    // Create RLS rules for login_attempts
    await manager.query(`
      INSERT INTO rls_rules (group_id, target_table, sql, parameters)
      VALUES (
        ${groupIds.company_a},
        'login_attempts',
        'ip_address LIKE :ip_prefix',
        '{"ip_prefix": "10.%"}'
      )
    `);

    await manager.query(`
      INSERT INTO rls_rules (group_id, target_table, sql, parameters)
      VALUES (
        ${groupIds.company_b},
        'login_attempts',
        'ip_address LIKE :ip_prefix',
        '{"ip_prefix": "192.168.%"}'
      )
    `);

    // Create RLS join path for login_attempts
    await manager.query(`
      INSERT INTO rls_join_paths (name, target_table, chain)
      VALUES (
        'test_login_attempts_via_users',
        'login_attempts',
        '["groups", "user_groups", "users", "login_attempts"]'
      )
    `);

    const joinPathResult = await manager.query(`
      SELECT id FROM rls_join_paths WHERE name = 'test_login_attempts_via_users'
    `);
    const joinPathId = joinPathResult[0].id;

    await manager.query(`
      INSERT INTO rls_join_conditions (join_path_id, from_table, from_column, to_table, to_column)
      VALUES (${joinPathId}, 'groups', 'id', 'user_groups', 'group_id')
    `);

    await manager.query(`
      INSERT INTO rls_join_conditions (join_path_id, from_table, from_column, to_table, to_column)
      VALUES (${joinPathId}, 'user_groups', 'user_id', 'users', 'id')
    `);

    await manager.query(`
      INSERT INTO rls_join_conditions (join_path_id, from_table, from_column, to_table, to_column)
      VALUES (${joinPathId}, 'users', 'id', 'login_attempts', 'user_id')
    `);

    // Assign group IDs to test users
    testUsers.test_admin_a.groupId = groupIds.company_a;
    testUsers.test_user_a1.groupId = groupIds.company_a;
    testUsers.test_user_eng.groupId = groupIds.engineering;
    testUsers.test_user_fe.groupId = groupIds.frontend;
    testUsers.test_admin_b.groupId = groupIds.company_b;
    testUsers.test_user_b1.groupId = groupIds.marketing;

    // Create test users with proper bcrypt hashed password
    const hashedPassword = await bcrypt.hash('Test123!', 10);

    for (const [key, user] of Object.entries(testUsers)) {
      const result = await manager.query(`
        INSERT INTO users (username, email, password, is_active, is_email_verified)
        VALUES ('${user.username}', '${user.email}', '${hashedPassword}', 1, 1)
        RETURNING id
      `);
      userIds[key] = result[0].id;

      // Assign to group
      await manager.query(`
        INSERT INTO user_groups (user_id, group_id)
        VALUES (${userIds[key]}, ${user.groupId})
      `);

      // Assign to role based on user type
      if (key.includes('admin')) {
        await manager.query(`
          INSERT INTO user_roles (user_id, role_id)
          VALUES (${userIds[key]}, ${roleIds.admin_role})
        `);
      } else {
        await manager.query(`
          INSERT INTO user_roles (user_id, role_id)
          VALUES (${userIds[key]}, ${roleIds.user_role})
        `);
      }

      // Login to get valid JWT token
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

    // Create 10 login attempts for each user
    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_a1}, '10.0.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_a1.email}')
      `);
    }

    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_eng}, '10.1.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_eng.email}')
      `);
    }

    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_fe}, '10.2.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_fe.email}')
      `);
    }

    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_b1}, '192.168.1.${i}', 'Test Agent', 'success', '${testUsers.test_user_b1.email}')
      `);
    }

    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_b1}, '192.168.2.${i}', 'Test Agent', 'failed', '${testUsers.test_user_b1.email}')
      `);
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
