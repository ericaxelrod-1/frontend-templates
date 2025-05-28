import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Categories (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let categoryId: number;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);

    // Register and login a test user
    await request(app.getHttpServer()).post('/auth/register').send({
      username: 'categoryuser',
      email: 'categoryuser@example.com',
      password: 'Test123!',
      firstName: 'Category',
      lastName: 'User',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'categoryuser',
        password: 'Test123!',
      });

    authToken = loginResponse.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a new category', () => {
    return request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Category',
        color: '#FF0000',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.name).toBe('Test Category');
        categoryId = res.body.id;
      });
  });

  it('should get all categories', () => {
    return request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });
  });

  it('should get a specific category', () => {
    return request(app.getHttpServer())
      .get(`/categories/${categoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(categoryId);
        expect(res.body.name).toBe('Test Category');
      });
  });

  it('should update a category', () => {
    return request(app.getHttpServer())
      .patch(`/categories/${categoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Updated Category',
        color: '#00FF00',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.name).toBe('Updated Category');
        expect(res.body.color).toBe('#00FF00');
      });
  });

  it('should not access categories without authentication', () => {
    return request(app.getHttpServer()).get('/categories').expect(401);
  });

  it('should delete a category', () => {
    return request(app.getHttpServer())
      .delete(`/categories/${categoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should not find deleted category', () => {
    return request(app.getHttpServer())
      .get(`/categories/${categoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
