import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register a new user', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'Test123!',
        firstName: 'Test',
        lastName: 'User',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.username).toBe('testuser');
        expect(res.body.email).toBe('test@example.com');
        expect(res.body).not.toHaveProperty('password');
      });
  });

  it('should not register a user with existing username', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'testuser',
        email: 'another@example.com',
        password: 'Test123!',
      })
      .expect(400);
  });

  it('should login with valid credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'testuser',
        password: 'Test123!',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('access_token');
        authToken = res.body.access_token;
      });
  });

  it('should not login with invalid credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'testuser',
        password: 'wrongpassword',
      })
      .expect(401);
  });

  it('should get user profile with valid token', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.username).toBe('testuser');
        expect(res.body.email).toBe('test@example.com');
        expect(res.body).not.toHaveProperty('password');
      });
  });

  it('should not get user profile without token', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });
});
