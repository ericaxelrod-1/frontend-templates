import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class RlsSystemBypassService {
  constructor(private readonly cls: ClsService) {}

  /**
   * EXTREME CAUTION: This method completely disables Row-Level Security for any database
   * operations executed within the callback.
   * 
   * @param callback The function to execute with RLS disabled.
   * @returns The result of the callback.
   */
  async runSystemBypass<T>(callback: () => Promise<T>): Promise<T> {
    return this.cls.runWith({ __rlsBypass: true } as any, callback);
  }
}
