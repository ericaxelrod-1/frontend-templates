import { SystemHealth } from '../../core/services/system-health.service';

export namespace SystemHealthActions {
  export class FetchHealth {
    static readonly type = '[System Health] Fetch Health';
  }

  export class SetHealth {
    static readonly type = '[System Health] Set Health';
    constructor(public health: SystemHealth) {}
  }

  export class ClearTempFiles {
    static readonly type = '[System Health] Clear Temp Files';
  }
}
