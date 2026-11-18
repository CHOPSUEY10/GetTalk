import type {
  PaginatedResult,
  TelemetryEvent,
  WebStatistics,
} from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchWebRequests(params: {
  limit?: number;
  offset?: number;
  eventType?: string;
  severity?: string;
  sourceIp?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<TelemetryEvent>> {
  return api.get<PaginatedResult<TelemetryEvent>>(
    `/api/v1/web/requests${buildQueryString({ limit: 20, ...params })}`
  );
}

export async function fetchWebStatistics(params: {
  range?: string;
  from?: string;
  to?: string;
} = {}): Promise<WebStatistics> {
  return api.get<WebStatistics>(
    `/api/v1/web/statistics${buildQueryString({ range: '24h', ...params })}`
  );
}

