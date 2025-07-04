export interface PatternSummary {
  patternType: string;
  displayName: string;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  lastDetected: Date;
  percentage?: number;
}

export interface TimeFilter {
  dateFrom?: Date;
  dateTo?: Date;
  timeRange?: '24h' | '7d' | '30d' | '90d' | 'all';
}

export interface PatternSummaryResponse {
  patternType: string;
  displayName: string;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  lastDetected: string; // ISO string from API
  percentage?: number;
} 