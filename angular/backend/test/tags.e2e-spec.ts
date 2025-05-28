import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Tags (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let tagId: number;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);

    // Register and login a test user
    await request(app.getHttpServer()).post('/auth/register').send({
      username: 'taguser',
      email: 'taguser@example.com',
      password: 'Test123!',
      firstName: 'Tag',
      lastName: 'User',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'taguser',
        password: 'Test123!',
      });

    authToken = loginResponse.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a new tag', () => {
    return request(app.getHttpServer())
      .post('/tags')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Tag',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.name).toBe('Test Tag');
        tagId = res.body.id;
      });
  });

  it('should get all tags', () => {
    return request(app.getHttpServer())
      .get('/tags')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });
  });

  it('should get a specific tag', () => {
    return request(app.getHttpServer())
      .get(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(tagId);
        expect(res.body.name).toBe('Test Tag');
      });
  });

  it('should update a tag', () => {
    return request(app.getHttpServer())
      .patch(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Updated Tag',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.name).toBe('Updated Tag');
      });
  });

  it('should not access tags without authentication', () => {
    return request(app.getHttpServer()).get('/tags').expect(401);
  });

  it('should delete a tag', () => {
    return request(app.getHttpServer())
      .delete(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should not find deleted tag', () => {
    return request(app.getHttpServer())
      .get(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
