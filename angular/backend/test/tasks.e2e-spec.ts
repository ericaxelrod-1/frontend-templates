import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingModule, setupTestApp } from './test-setup';

describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let taskId: number;

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = await setupTestApp(moduleFixture);

    // Register and login a test user
    await request(app.getHttpServer()).post('/auth/register').send({
      username: 'taskuser',
      email: 'taskuser@example.com',
      password: 'Test123!',
      firstName: 'Task',
      lastName: 'User',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'taskuser',
        password: 'Test123!',
      });

    authToken = loginResponse.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a new task', () => {
    return request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Test Task',
        description: 'This is a test task',
        dueDate: '2024-12-31',
        priority: 'HIGH',
        status: 'TODO',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.title).toBe('Test Task');
        taskId = res.body.id;
      });
  });

  it('should get all tasks', () => {
    return request(app.getHttpServer())
      .get('/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });
  });

  it('should get a specific task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(taskId);
        expect(res.body.title).toBe('Test Task');
      });
  });

  it('should update a task', () => {
    return request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Updated Task',
        status: 'IN_PROGRESS',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('Updated Task');
        expect(res.body.status).toBe('IN_PROGRESS');
      });
  });

  it('should not access tasks without authentication', () => {
    return request(app.getHttpServer()).get('/tasks').expect(401);
  });

  it('should delete a task', () => {
    return request(app.getHttpServer())
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should not find deleted task', () => {
    return request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });
});
