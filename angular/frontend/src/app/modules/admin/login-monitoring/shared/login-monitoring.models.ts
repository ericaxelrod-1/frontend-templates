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
  id: number;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  source: string;
  ipAddress?: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'dismissed';
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolutionNotes?: string;
  alertData?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Legacy support for template compatibility
  type?: string; // Maps to alertType
  timestamp?: Date; // Maps to createdAt
  details?: any; // Maps to alertData
}

export interface LoginMonitoringFilters {
  email?: string;
  ipAddress?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SecurityAlertsFilters {
  status?: 'active' | 'acknowledged' | 'resolved' | 'dismissed' | '';
  severity?: 'low' | 'medium' | 'high' | 'critical' | '';
  alertType?: 'pattern_brute_force' | 'pattern_credential_stuffing' | 'auth_login' | 'security_alert' | 'test_alert' | 'system_alert' | '';
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
} 