import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Task-Categories (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let taskId: number;
  let categoryId: number;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);

    // Register and login a test user
    await request(app.getHttpServer()).post('/auth/register').send({
      username: 'taskcatuser',
      email: 'taskcatuser@example.com',
      password: 'Test123!',
      firstName: 'TaskCat',
      lastName: 'User',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'taskcatuser',
        password: 'Test123!',
      });

    authToken = loginResponse.body.access_token;

    // Create a test task
    const taskResponse = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Test Task',
        description: 'This is a test task',
        dueDate: '2024-12-31',
        priority: 'HIGH',
        status: 'TODO',
      });
    taskId = taskResponse.body.id;

    // Create a test category
    const categoryResponse = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Category',
        color: '#FF0000',
      });
    categoryId = categoryResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should assign a category to a task', () => {
    return request(app.getHttpServer())
      .post(`/tasks/${taskId}/category/${categoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.category).toEqual(
          expect.objectContaining({ id: categoryId }),
        );
      });
  });

  it('should get category for a task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.category).toEqual(
          expect.objectContaining({ id: categoryId }),
        );
      });
  });

  it('should get all tasks for a category', () => {
    return request(app.getHttpServer())
      .get(`/categories/${categoryId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContainEqual(
          expect.objectContaining({ id: taskId }),
        );
      });
  });

  it('should remove category from a task', () => {
    return request(app.getHttpServer())
      .delete(`/tasks/${taskId}/category`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.category).toBeNull();
      });
  });

  it('should verify category is removed from task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.category).toBeNull();
      });
  });

  it('should not allow unauthorized category operations', () => {
    return request(app.getHttpServer())
      .post(`/tasks/${taskId}/category/${categoryId}`)
      .expect(401);
  });

  it('should not assign non-existent category', () => {
    return request(app.getHttpServer())
      .post(`/tasks/${taskId}/category/999999`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
