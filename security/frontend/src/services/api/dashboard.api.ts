import type { DashboardOverview, TrafficBucket } from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchDashboardOverview(range = '24h'): Promise<DashboardOverview> {
  return api.get<DashboardOverview>(`/api/v1/dashboard/overview${buildQueryString({ range })}`);
}

export async function fetchDashboardTraffic(params: {
  range?: string;
  bucketMinutes?: number;
  from?: string;
  to?: string;
} = {}): Promise<{ from: string; to: string; bucketMinutes: number; series: TrafficBucket[] }> {
  return api.get(`/api/v1/dashboard/traffic${buildQueryString(params)}`);
}

