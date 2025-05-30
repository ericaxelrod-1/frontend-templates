import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppModule } from '../src/app.module';
import * as path from 'path';

export async function createTestingModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        envFilePath: path.join(__dirname, '.env.test'),
        isGlobal: true,
      }),
      AppModule,
    ],
  }).compile();
}

export async function setupTestApp(
  module: TestingModule,
): Promise<INestApplication> {
  const app = module.createNestApplication();
  await app.init();
  return app;
}
