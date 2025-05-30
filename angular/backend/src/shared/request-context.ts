import { Injectable } from '@nestjs/common';

@Injectable()
export class RequestContext {
  private static currentUserId: number;

  static setCurrentUserId(userId: number): void {
    RequestContext.currentUserId = userId;
  }

  static getCurrentUserId(): number {
    if (typeof RequestContext.currentUserId === 'undefined') {
      throw new Error('Current user ID not set in RequestContext');
    }
    return RequestContext.currentUserId;
  }
}
