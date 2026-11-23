export type TelemetrySource = 'firewalld' | 'nginx' | 'pm2' | 'system' | 'siem';

export type SeverityLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export type AdminRole = 'admin' | 'analyst' | 'viewer';

export type RuleType =
  | 'threshold'
  | 'distinct_count'
  | 'signature'
  | 'metric_sustained'
  | 'metric_delta'
  | 'correlation';

export interface TelemetryEvent {
  id: string;
  source: TelemetrySource;
  eventType: string;
  sourceIp?: string;
  destinationIp?: string;
  eventData: Record<string, any>;
  severity: SeverityLevel;
  fingerprint?: string;
  occurredAt: string;
  createdAt: string;
}

export interface SystemMetric {
  id: string;
  source: TelemetrySource;
  metricName: string;
  metricValue: number;
  labels: Record<string, any>;
  recordedAt: string;
}

export interface SecurityAlert {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: SeverityLevel;
  sourceIp?: string;
  status: AlertStatus;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  evidence?: Record<string, any>;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

export interface DetectionRule {
  id: string;
  ruleName: string;
  ruleType: RuleType;
  threshold: number;
  timeWindow: number;
  severity: SeverityLevel;
  enabled: boolean;
  configuration: Record<string, any>;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface CollectorHealth {
  name: string;
  source: TelemetrySource;
  status: 'healthy' | 'degraded' | 'unavailable' | 'stopped';
  running: boolean;
  eventsCollected: number;
  errorsCount: number;
  lastCollection?: string;
  lastError?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: AdminRole;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  data: T[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  pagination: PaginationMeta;
}

export interface DashboardOverview {
  overallHealth: 'healthy' | 'warning' | 'critical';
  totalHttpRequests: number;
  firewallBlockedEvents: number;
  averageCpuPercent: number;
  totalMemoryBytes: number;
  activeAlertsCount: number;
  criticalAlertsCount: number;
  collectors: CollectorHealth[];
  recentEvents: TelemetryEvent[];
  recentAlerts: SecurityAlert[];
  generatedAt: string;
}

export interface TrafficBucket {
  timestamp: string;
  httpRequests: number;
  firewallBlocked: number;
  http4xx: number;
  http5xx: number;
  alertsTriggered: number;
}

export interface IPCount {
  ip: string;
  count: number;
}

export interface ProtocolCount {
  protocol: string;
  count: number;
}

export interface PortCount {
  port: number;
  count: number;
}

export interface NetworkStatistics {
  totalDropped: number;
  totalRejected: number;
  uniqueSourceIps: number;
  topSourceIps: IPCount[];
  protocolDistribution: ProtocolCount[];
  topDestinationPorts: PortCount[];
  timeline: TrafficBucket[];
}

export interface StatusDistribution {
  statusGroup: string;
  count: number;
}

export interface EndpointStat {
  endpoint: string;
  method: string;
  count: number;
  avgDurationMs: number;
  errorCount: number;
}

export interface WebStatistics {
  totalRequests: number;
  totalErrors: number;
  avgRequestDurationMs: number;
  p95RequestDurationMs: number;
  p99RequestDurationMs: number;
  statusDistribution: StatusDistribution[];
  topEndpoints: EndpointStat[];
  topSourceIps: IPCount[];
  timeline: TrafficBucket[];
}

export interface PM2ProcessSummary {
  name: string;
  pid: number;
  pmId: number;
  status: string;
  cpuPercent: number;
  memoryBytes: number;
  restartCount: number;
  uptimeSeconds: number;
  instances: number;
  execMode: string;
  recordedAt: string;
}

export interface RetentionConfig {
  cleanupIntervalHours: number;
  telemetryEventsDays: number;
  systemMetricsDays: number;
  securityAlertsDays: number;
}

export interface SystemSettingsResponse {
  collectors: CollectorHealth[];
  pm2CollectionIntervalSec: number;
  nginxPollIntervalMs: number;
  idsEvaluationIntervalSec: number;
  passiveModeOnly: boolean;
  retention: RetentionConfig;
  droppedEventsCount: number;
  droppedMetricsCount: number;
}

export interface StreamMessage {
  type: 'connected' | 'heartbeat' | 'telemetry_event' | 'system_metric' | 'security_alert';
  timestamp: string;
  payload?: any;
}

export interface KillSwitchStatus {
  enabled: boolean;
  key: string;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface IngestEventInput {
  event_id: string;
  source?: TelemetrySource;
  event_type?: string;
  source_ip?: string;
  destination_ip?: string;
  severity: SeverityLevel;
  description: string;
  event_data?: Record<string, any>;
}


