import type { AuditLog, PaginatedResult } from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchAuditLogs(params: {
  limit?: number;
  offset?: number;
  actorId?: string;
  eventType?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<AuditLog>> {
  return api.get<PaginatedResult<AuditLog>>(
    `/api/v1/audit-logs${buildQueryString({ limit: 25, ...params })}`
  );
}

