import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface RlsMetricEvent {
  type: 'block' | 'bypass';
  tableName?: string;
  timestamp: number;
}

@Injectable()
export class RlsMetricsService {
  private readonly events$ = new Subject<RlsMetricEvent>();

  // Expose observable for apps to hook into (e.g., Prometheus exporter)
  get events() {
    return this.events$.asObservable();
  }

  recordBlock(tableName: string) {
    this.events$.next({
      type: 'block',
      tableName,
      timestamp: Date.now(),
    });
  }

  recordBypass() {
    this.events$.next({
      type: 'bypass',
      timestamp: Date.now(),
    });
  }
}
