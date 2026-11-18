import type {
  PM2ProcessSummary,
  PaginatedResult,
  SystemMetric,
} from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchApplicationProcesses(params: {
  limit?: number;
  offset?: number;
} = {}): Promise<PaginatedResult<PM2ProcessSummary>> {
  return api.get<PaginatedResult<PM2ProcessSummary>>(
    `/api/v1/application/processes${buildQueryString({ limit: 50, ...params })}`
  );
}

export async function fetchApplicationMetrics(params: {
  limit?: number;
  offset?: number;
  metricName?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<SystemMetric>> {
  return api.get<PaginatedResult<SystemMetric>>(
    `/api/v1/application/metrics${buildQueryString({ limit: 25, ...params })}`
  );
}

