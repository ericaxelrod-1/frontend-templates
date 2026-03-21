import 'typeorm';
import '@nestjs/typeorm';

declare module 'nestjs-cls' {
  interface ClsStore {
    __rlsBypass?: boolean;
    activeGroupIds?: number[];
    primaryGroupId?: number;
  }
}

declare module '@nestjs/typeorm' {
  /**
   * @deprecated CRITICAL SECURITY: Injecting DataSource directly bypasses Row-Level Security.
   * You MUST inject EntityManager or Repository instead.
   * If you absolutely need a raw connection for system tasks, inject RlsSystemBypassService.
   */
  export function InjectDataSource(
    dataSource?: string,
  ): (target: any, key: string, index?: number) => never;
}

declare module 'typeorm' {
  export interface DataSource {
    /**
     * @deprecated CRITICAL SECURITY: Injecting DataSource directly bypasses Row-Level Security.
     * You MUST inject EntityManager or Repository instead. 
     */
    __SECURITY_VIOLATION_DO_NOT_USE__: never;
  }
}
