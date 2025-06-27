export interface LoginAttempt {
  id: number;
  ipAddress: string;
  userAgent: string;
  email: string;
  status: string;
  failureReason?: string;
  metadata?: string;
  createdAt: Date;
}

export interface Statistics {
  total: number;
  successful: number;
  failed: number;
  blocked: number;
  captchaRequired: number;
  timeframe: {
    startDate: Date;
    endDate: Date;
  };
}

export interface Pattern {
  id: string;
  type: string;
  severity: string;
  details: string;
  timestamp: Date;
  ipAddresses: string[];
  email?: string;
  expanded?: boolean;
}

export interface IPReputation {
  ipAddress: string;
  failedAttempts: number;
  isBlocked: boolean;
  blockedUntil?: Date;
  lastFailedAttempt?: Date;
  reputation: number;
}

export interface SecurityAlert {
  id: string;
  type: string;
  severity: string;
  message: string;
  timestamp: Date;
  status: 'new' | 'acknowledged' | 'resolved' | 'dismissed';
  details?: any;
}

export interface LoginMonitoringFilters {
  email?: string;
  ipAddress?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
} 