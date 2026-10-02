import { ConfigService } from '@nestjs/config';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ENVIRONMENT, AppModule } from '../../src/app.module.js';
import { loadTestEnvironment } from '../support/database.js';

const TIMEOUT = 30_000;
const SECRET_KEY = 'JWT_SECRET';
const originalSecret = process.env[SECRET_KEY];

loadTestEnvironment();

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env[SECRET_KEY];
  } else {
    process.env[SECRET_KEY] = originalSecret;
  }
  vi.resetModules();
});

describe('application bootstrap', () => {
  it(
    'exposes the validated environment through the config service',
    async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

      expect(moduleRef.get(ConfigService).getOrThrow('environment')).toEqual(APP_ENVIRONMENT);
      expect(APP_ENVIRONMENT).toEqual(loadTestEnvironment());
      expect(APP_ENVIRONMENT.jwt.secret.length).toBeGreaterThanOrEqual(32);

      await moduleRef.close();
    },
    TIMEOUT,
  );

  it(
    'refuses to evaluate without a signing secret',
    async () => {
      // An empty value overrides the one in .env, which is how the
      // missing-secret path is reached without a second configuration file.
      process.env[SECRET_KEY] = '';
      vi.resetModules();

      await expect(import('../../src/app.module.js')).rejects.toThrow(
        /JWT_SECRET is required but was not set/,
      );
    },
    TIMEOUT,
  );

  it(
    'initialises a Fastify application, not an Express one',
    async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      expect(app.getHttpAdapter().getType()).toBe('fastify');

      await app.close();
      await moduleRef.close();
    },
    TIMEOUT,
  );
});
