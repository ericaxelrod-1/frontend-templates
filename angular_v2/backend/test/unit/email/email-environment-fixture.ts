import {
  loadEnvironment,
  type EmailConfig,
  type Environment,
} from '../../../src/config/environment.js';

/**
 * A complete, valid environment source. Every test that needs an
 * `Environment` starts here and overrides one key, so a test asserting email
 * behaviour cannot be reading an accidental default in some other namespace.
 *
 * `APP_BASE_URL` is `https://app.example.test` — a reserved TLD, and https even
 * in development, so the "https in production" assertion has to be tested by
 * giving it something to reject rather than by accident passing.
 *
 * `EMAIL_HOST`/`EMAIL_PORT` are present because they are required in **every**
 * mode: there is one transport, so every mode needs a destination. They name the
 * local sink, and a test that means to reach it starts one; a test that means to
 * prove a failure points `EMAIL_PORT` at a dead port instead.
 */
export const BASE_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'app',
  DB_PASSWORD: 'app',
  DB_NAME: 'app_test',
  JWT_SECRET: 'email-spec-signing-secret-key-0123456789',
  AUTHENTICATOR_PASSWORD: 'authenticator-password',
  APP_BASE_URL: 'https://app.example.test',
  EMAIL_HOST: '127.0.0.1',
  EMAIL_PORT: '1025',
  POSTGREST_URL: 'http://127.0.0.1:3001',
});

/** Every SMTP key a production process needs, all present. */
export const PRODUCTION_EMAIL_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'production',
  EMAIL_HOST: 'smtp.example.test',
  EMAIL_PORT: '587',
  EMAIL_USER: 'apikey',
  EMAIL_PASSWORD: 'not-a-real-secret',
  EMAIL_FROM: 'Acme <no-reply@acme.example>',
});

export function sourceWith(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { ...BASE_SOURCE, ...overrides };
}

export function environmentFor(overrides: Readonly<Record<string, string>> = {}): Environment {
  return loadEnvironment(sourceWith(overrides));
}

/** The validated `email` namespace on its own, which is all the provider wants. */
export function emailConfigFor(overrides: Readonly<Record<string, string>> = {}): EmailConfig {
  return environmentFor(overrides).email;
}