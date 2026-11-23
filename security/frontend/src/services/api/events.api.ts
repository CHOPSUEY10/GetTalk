import type {
  IngestEventInput,
  PaginatedResult,
  TelemetryEvent,
} from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchUnifiedEvents(params: {
  limit?: number;
  offset?: number;
  source?: string;
  eventType?: string;
  severity?: string;
  sourceIp?: string;
  from?: string;
  to?: string;
} = {}): Promise<PaginatedResult<TelemetryEvent>> {
  return api.get<PaginatedResult<TelemetryEvent>>(
    `/api/v1/events${buildQueryString({ limit: 25, ...params })}`
  );
}

export async function ingestSecurityEvent(
  payload: IngestEventInput
): Promise<TelemetryEvent> {
  return api.post<TelemetryEvent>('/api/v1/events', payload);
}


