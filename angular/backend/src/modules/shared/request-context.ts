import { User } from '../users/entities/user.entity';

/**
 * Context object for API requests
 * Contains information about the current request and user
 */
export class RequestContext {
  /**
   * The user making the request
   */
  user: User;

  /**
   * Request headers
   */
  headers: Record<string, string>;

  /**
   * Request IP address
   */
  ip?: string;

  /**
   * Request path
   */
  path?: string;

  /**
   * Request method
   */
  method?: string;

  /**
   * Additional context data
   */
  data?: Record<string, any>;

  constructor(data: Partial<RequestContext>) {
    Object.assign(this, data);
  }

  /**
   * Check if the user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.user;
  }

  /**
   * Get a value from the context data
   * @param key The key to get
   * @param defaultValue The default value to return if the key is not found
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data?.[key] as T ?? defaultValue;
  }
} 