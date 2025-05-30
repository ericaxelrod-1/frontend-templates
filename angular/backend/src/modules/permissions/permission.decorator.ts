import { SetMetadata } from '@nestjs/common';

// Define the key that will be used in the metadata store
export const PERMISSIONS_KEY = 'require_permission';

export interface Permission {
  resource: string;
  action: string;
}

/**
 * Decorator that requires specific permissions to access a route or resource
 * @param permissions The required permissions (string or array of strings in format 'resource:action')
 */
export const RequirePermission = (permissions: string | string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
