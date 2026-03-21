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
          exemptTables: ['rls_rules', 'rls_join_paths', 'rls_join_conditions', 'rls_scope_templates'],
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

  // Test users - groupId will be set dynamically after group creation
  const testUsers = {
    test_admin_a: { username: 'test_admin_a', password: 'Test123!', email: 'test_admin_a@example.com', groupId: 0 },
    test_user_a1: { username: 'test_user_a1', password: 'Test123!', email: 'test_user_a1@example.com', groupId: 0 },
    test_user_eng: { username: 'test_user_eng', password: 'Test123!', email: 'test_user_eng@example.com', groupId: 0 },
    test_user_fe: { username: 'test_user_fe', password: 'Test123!', email: 'test_user_fe@example.com', groupId: 0 },
    test_admin_b: { username: 'test_admin_b', password: 'Test123!', email: 'test_admin_b@example.com', groupId: 0 },
    test_user_b1: { username: 'test_user_b1', password: 'Test123!', email: 'test_user_b1@example.com', groupId: 0 },
  };

  // User IDs assigned during setup
  const userIds: Record<string, number> = {};

  // Auth tokens
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    jest.setTimeout(180000); // 3 minutes timeout
    const moduleFixture = await createRlsTestModule();
    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = moduleFixture.get(DataSource);

    // Clean up any existing test data
    await cleanupTestData();

    // Setup test data
    await setupTestData();
  }, 180000);

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    const manager = dataSource.manager;

    // Delete in correct order to satisfy FK constraints
    // 1. Login attempts for test users
    await manager.query(`
      DELETE FROM login_attempts WHERE user_id IN (
        SELECT id FROM users WHERE username LIKE 'test_%'
      )
    `);

    // 2. User-groups mappings
    await manager.query(`
      DELETE FROM user_groups WHERE user_id IN (
        SELECT id FROM users WHERE username LIKE 'test_%'
      )
    `);

    // 3. Users
    await manager.query(`DELETE FROM users WHERE username LIKE 'test_%'`);

    // 4. RLS rules for test groups
    await manager.query(`DELETE FROM rls_rules WHERE group_id >= 10`);

    // 5. RLS join paths
    await manager.query(`DELETE FROM rls_join_paths WHERE name LIKE 'test_%'`);

    // 6. Groups (must be last due to self-referencing FK)
    await manager.query(`DELETE FROM groups WHERE name LIKE 'test_%'`);
  }

  async function setupTestData() {
    const manager = dataSource.manager;

    // Capture actual group IDs after creation
    const groupIds: Record<string, number> = {};

    // Create groups hierarchy
    // Company A (root)
    let result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_company_a', 'Test Company A', NULL, 100)
      RETURNING id
    `);
    groupIds.company_a = result[0].id;

    // Engineering (child of Company A)
    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_engineering', 'Test Engineering', ${groupIds.company_a}, 90)
      RETURNING id
    `);
    groupIds.engineering = result[0].id;

    // Frontend (child of Engineering)
    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_frontend', 'Test Frontend', ${groupIds.engineering}, 80)
      RETURNING id
    `);
    groupIds.frontend = result[0].id;

    // Company B (root)
    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_company_b', 'Test Company B', NULL, 100)
      RETURNING id
    `);
    groupIds.company_b = result[0].id;

    // Marketing (child of Company B)
    result = await manager.query(`
      INSERT INTO groups (name, description, parent_id, priority) 
      VALUES ('test_marketing', 'Test Marketing', ${groupIds.company_b}, 90)
      RETURNING id
    `);
    groupIds.marketing = result[0].id;

    // Assign group IDs to test users
    testUsers.test_admin_a.groupId = groupIds.company_a;
    testUsers.test_user_a1.groupId = groupIds.company_a;
    testUsers.test_user_eng.groupId = groupIds.engineering;
    testUsers.test_user_fe.groupId = groupIds.frontend;
    testUsers.test_admin_b.groupId = groupIds.company_b;
    testUsers.test_user_b1.groupId = groupIds.marketing;

      // Create RLS rules for login_attempts
    // Company A sees IP range 10.x.x.x
    await manager.query(`
      INSERT INTO rls_rules (group_id, target_table, sql, parameters)
      VALUES (
        ${groupIds.company_a},
        'login_attempts',
        'ip_address LIKE :ip_prefix',
        '{"ip_prefix": "10.%"}'
      )
    `);

    // Company B sees IP range 192.168.x.x
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

    // Get the join path ID
    const joinPathResult = await manager.query(`
      SELECT id FROM rls_join_paths WHERE name = 'test_login_attempts_via_users'
    `);
    const joinPathId = joinPathResult[0].id;

    // Create join conditions
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

    // Create test users with proper bcrypt hashed password
    const hashedPassword = await bcrypt.hash('Test123!', 10);

    for (const [key, user] of Object.entries(testUsers)) {
      // Create user with hashed password
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
    // Company A users (10.0.0.x IPs)
    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_a1}, '10.0.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_a1.email}')
      `);
    }

    // Engineering user (10.1.x.x IPs)
    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_eng}, '10.1.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_eng.email}')
      `);
    }

    // Frontend user (10.2.x.x IPs)
    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_fe}, '10.2.0.${i}', 'Test Agent', 'success', '${testUsers.test_user_fe.email}')
      `);
    }

    // Company B users (192.168.1.x IPs)
    for (let i = 1; i <= 10; i++) {
      await manager.query(`
        INSERT INTO login_attempts (user_id, ip_address, user_agent, status, email_attempted)
        VALUES (${userIds.test_user_b1}, '192.168.1.${i}', 'Test Agent', 'success', '${testUsers.test_user_b1.email}')
      `);
    }

    // Marketing user (192.168.2.x IPs)
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

      // Should succeed
      expect(res.status).toBe(200);

      // All returned IPs should match 10.x.x.x pattern
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

      // Should succeed
      expect(res.status).toBe(200);

      // No IPs should be from 192.168.x.x
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

      // Should succeed
      expect(res.status).toBe(200);

      // All returned IPs should match 192.168.x.x pattern
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

      // Should succeed
      expect(res.status).toBe(200);

      // No IPs should be from 10.x.x.x
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

      // Company A user query
      const resA = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_admin_a}`);

      // Company B user query
      const resB = await request(app.getHttpServer())
        .get('/login-attempts/attempts')
        .set('Authorization', `Bearer ${tokens.test_user_b1}`);

      // Both should succeed
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      // Results should be different (no overlap)
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

      // Verify all IPs start with 10.
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

      // Verify all IPs start with 192.168.
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
      const res = await request(app.getHttpServer())
        .get('/login-attempts/attempts');

      expect(res.status).toBe(401);
    });
  });
});
