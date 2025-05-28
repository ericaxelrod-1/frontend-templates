import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PermissionSeedsService } from './permission-seeds.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seeder = app.get(PermissionSeedsService);
  await seeder.seed();
  await app.close();
  console.log('Permission seeding complete.');
}

if (require.main === module) {
  run();
} 