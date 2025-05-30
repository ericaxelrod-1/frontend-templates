import { Module } from '@nestjs/common';
import { Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';

/**
 * Token for the User repository provider
 * This is used to inject the user repository into other modules
 */
export const USER_REPOSITORY = 'USER_REPOSITORY';

/**
 * Shared module for User-related interfaces and DTOs
 * This module is used to break circular dependencies between modules
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [],
  exports: [TypeOrmModule],
})
export class UsersSharedModule {} 