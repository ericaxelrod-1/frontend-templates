import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../modules/auth/auth.service';
import { Logger } from '@nestjs/common';

async function testLoginResponse() {
  const logger = new Logger('TestLoginResponse');
  logger.log('Testing login response format...');

  const app = await NestFactory.createApplicationContext(AppModule);
  const authService = app.get(AuthService);

  try {
    // Login as admin to get the response
    logger.log('Logging in as admin...');
    const loginResponse = await authService.login(
      'admin@example.com',
      'Admin123!',
      '127.0.0.1',
      'test-user-agent'
    );

    logger.log('Login response structure:');
    logger.log('User ID:', loginResponse.user.id);
    logger.log('User email:', loginResponse.user.email);
    logger.log('Permissions type:', typeof loginResponse.user.permissions);
    logger.log('Permissions array:', Array.isArray(loginResponse.user.permissions));
    logger.log('Permissions count:', loginResponse.user.permissions?.length || 0);
    
    if (loginResponse.user.permissions && loginResponse.user.permissions.length > 0) {
      logger.log('First permission structure:');
      logger.log('Type:', typeof loginResponse.user.permissions[0]);
      logger.log('Value:', loginResponse.user.permissions[0]);
      
      if (typeof loginResponse.user.permissions[0] === 'string') {
        logger.log('✅ Permissions are returned as STRINGS');
        const loginMonitoringPerms = loginResponse.user.permissions.filter(p => p.includes('login-monitoring'));
        logger.log('Login monitoring permissions:', loginMonitoringPerms);
      } else {
        logger.log('✅ Permissions are returned as OBJECTS');
        logger.log('Structure:', JSON.stringify(loginResponse.user.permissions[0], null, 2));
      }
      
      logger.log('All permissions:');
      loginResponse.user.permissions.forEach((perm, index) => {
        logger.log(`${index + 1}: ${JSON.stringify(perm)}`);
      });
    } else {
      logger.error('❌ No permissions found in response!');
    }

  } catch (error) {
    logger.error('Error during login test:', error);
  } finally {
    await app.close();
  }
}

testLoginResponse().catch(console.error); 