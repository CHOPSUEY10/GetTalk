import type {
  NetworkStatistics,
  PaginatedResult,
  TelemetryEvent,
} from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchNetworkEvents(params: {
  limit?: number;
  offset?: number;
  eventType?: string;
  severity?: string;
  sourceIp?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<TelemetryEvent>> {
  return api.get<PaginatedResult<TelemetryEvent>>(
    `/api/v1/network/events${buildQueryString({ limit: 20, ...params })}`
  );
}

export async function fetchNetworkStatistics(params: {
  range?: string;
  from?: string;
  to?: string;
} = {}): Promise<NetworkStatistics> {
  return api.get<NetworkStatistics>(
    `/api/v1/network/statistics${buildQueryString({ range: '24h', ...params })}`
  );
}

