import { Module } from '@nestjs/common';
import { Global } from '@nestjs/common';

/**
 * Shared module for Auth-related interfaces and DTOs
 * This module is used to break circular dependencies between modules
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class AuthSharedModule {} 