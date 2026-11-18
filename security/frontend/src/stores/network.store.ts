import { writable } from 'svelte/store';
import type {
  NetworkStatistics,
  PaginationMeta,
  TelemetryEvent,
} from '../lib/types/telemetry.ts';
import { fetchNetworkEvents, fetchNetworkStatistics } from '../services/api/network.api.ts';

export interface NetworkState {
  events: TelemetryEvent[];
  statistics: NetworkStatistics | null;
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createNetworkStore() {
  const { subscribe, update } = writable<NetworkState>({
    events: [],
    statistics: null,
    pagination: { limit: 20, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: {
      limit?: number;
      offset?: number;
      eventType?: string;
      severity?: string;
      sourceIp?: string;
      range?: string;
    } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const [eventsPage, statistics] = await Promise.all([
          fetchNetworkEvents(params),
          fetchNetworkStatistics({ range: params.range || '24h' }),
        ]);
        update((s) => ({
          ...s,
          events: eventsPage.items || [],
          pagination: eventsPage.pagination,
          statistics,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load network telemetry',
        }));
      }
    },
  };
}

export const networkStore = createNetworkStore();
export default networkStore;

