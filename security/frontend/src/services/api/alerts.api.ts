import type {
  AlertStatus,
  PaginatedResult,
  SecurityAlert,
} from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchSecurityAlerts(params: {
  limit?: number;
  offset?: number;
  severity?: string;
  status?: string;
  ruleId?: string;
  sourceIp?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<SecurityAlert>> {
  return api.get<PaginatedResult<SecurityAlert>>(
    `/api/v1/alerts${buildQueryString({ limit: 20, ...params })}`
  );
}

export async function updateSecurityAlertStatus(
  id: string,
  status: AlertStatus
): Promise<SecurityAlert> {
  return api.patch<SecurityAlert>(`/api/v1/alerts/${encodeURIComponent(id)}`, { status });
}

