import { writable } from 'svelte/store';
import type {
  IngestEventInput,
  PaginationMeta,
  TelemetryEvent,
} from '../lib/types/telemetry.ts';
import {
  fetchUnifiedEvents,
  ingestSecurityEvent,
} from '../services/api/events.api.ts';

export interface EventsState {
  events: TelemetryEvent[];
  pagination: PaginationMeta;
  loading: boolean;
  submitting: boolean;
  error: string | null;
}

function createEventsStore() {
  const { subscribe, update } = writable<EventsState>({
    events: [],
    pagination: { limit: 25, offset: 0, total: 0, hasMore: false },
    loading: false,
    submitting: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: {
      limit?: number;
      offset?: number;
      source?: string;
      eventType?: string;
      severity?: string;
      sourceIp?: string;
      from?: string;
      to?: string;
    } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await fetchUnifiedEvents(params);
        update((s) => ({
          ...s,
          events: page.items || [],
          pagination: page.pagination,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load unified security events',
        }));
      }
    },
    ingestEvent: async (payload: IngestEventInput) => {
      update((s) => ({ ...s, submitting: true, error: null }));
      try {
        const created = await ingestSecurityEvent(payload);
        update((s) => ({
          ...s,
          submitting: false,
          events: [created, ...s.events.filter((x) => x.id !== created.id)].slice(
            0,
            s.pagination.limit || 25
          ),
          pagination: {
            ...s.pagination,
            total: s.pagination.total + 1,
          },
        }));
        return created;
      } catch (err: any) {
        update((s) => ({
          ...s,
          submitting: false,
          error: err?.message || 'Failed to ingest SIEM security event',
        }));
        throw err;
      }
    },
    prependRealtimeEvent: (ev: TelemetryEvent) => {
      update((s) => ({
        ...s,
        events: [ev, ...s.events.filter((x) => x.id !== ev.id)].slice(0, s.pagination.limit || 25),
      }));
    },
  };
}

export const eventsStore = createEventsStore();
export default eventsStore;


