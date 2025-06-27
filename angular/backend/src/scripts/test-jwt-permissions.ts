import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../modules/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

async function testJwtPermissions() {
  const logger = new Logger('TestJwtPermissions');
  logger.log('Testing JWT token permissions...');

  const app = await NestFactory.createApplicationContext(AppModule);
  const authService = app.get(AuthService);
  const jwtService = app.get(JwtService);

  try {
    // Login as admin to get tokens
    logger.log('Logging in as admin...');
    const loginResult = await authService.login(
      'admin@example.com',
      'Admin123!',
      '127.0.0.1',
      'test-user-agent'
    );

    logger.log('Login successful, access token generated');

    // Decode the access token to see what's inside
    logger.log('Decoding access token...');
    const decoded = jwtService.decode(loginResult.accessToken) as any;
    
    logger.log('JWT Token payload:');
    logger.log('Email:', decoded.email);
    logger.log('User ID:', decoded.sub);
    logger.log('Permissions count:', decoded.permissions?.length || 0);
    
    if (decoded.permissions) {
      const loginMonitoringPerms = decoded.permissions.filter((p: string) => p.includes('login-monitoring'));
      logger.log('Login monitoring permissions in JWT:', loginMonitoringPerms);
      
      logger.log('All permissions in JWT:');
      logger.log(decoded.permissions);
    } else {
      logger.error('No permissions found in JWT token!');
    }

  } catch (error) {
    logger.error('Error during JWT test:', error);
  } finally {
    await app.close();
  }
}

testJwtPermissions()
  .then(() => {
    console.log('JWT test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('JWT test failed:', error);
    process.exit(1);
  }); 