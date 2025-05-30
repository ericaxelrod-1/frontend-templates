import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Task-Tags (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let taskId: number;
  let tagId: number;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);

    // Register and login a test user
    await request(app.getHttpServer()).post('/auth/register').send({
      username: 'tasktaguser',
      email: 'tasktaguser@example.com',
      password: 'Test123!',
      firstName: 'TaskTag',
      lastName: 'User',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'tasktaguser',
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

    // Create a test tag
    const tagResponse = await request(app.getHttpServer())
      .post('/tags')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Tag',
      });
    tagId = tagResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should add a tag to a task', () => {
    return request(app.getHttpServer())
      .post(`/tasks/${taskId}/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.tags).toContainEqual(
          expect.objectContaining({ id: tagId }),
        );
      });
  });

  it('should get all tags for a task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}/tags`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContainEqual(expect.objectContaining({ id: tagId }));
      });
  });

  it('should get all tasks for a tag', () => {
    return request(app.getHttpServer())
      .get(`/tags/${tagId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContainEqual(
          expect.objectContaining({ id: taskId }),
        );
      });
  });

  it('should remove a tag from a task', () => {
    return request(app.getHttpServer())
      .delete(`/tasks/${taskId}/tags/${tagId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.tags).not.toContainEqual(
          expect.objectContaining({ id: tagId }),
        );
      });
  });

  it('should verify tag is removed from task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}/tags`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).not.toContainEqual(
          expect.objectContaining({ id: tagId }),
        );
      });
  });

  it('should not allow unauthorized tag operations', () => {
    return request(app.getHttpServer())
      .post(`/tasks/${taskId}/tags/${tagId}`)
      .expect(401);
  });
});
