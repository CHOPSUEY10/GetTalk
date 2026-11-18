import { writable } from 'svelte/store';
import type {
  PaginationMeta,
  TelemetryEvent,
  WebStatistics,
} from '../lib/types/telemetry.ts';
import { fetchWebRequests, fetchWebStatistics } from '../services/api/web.api.ts';

export interface WebState {
  requests: TelemetryEvent[];
  statistics: WebStatistics | null;
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createWebStore() {
  const { subscribe, update } = writable<WebState>({
    requests: [],
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
        const [requestsPage, statistics] = await Promise.all([
          fetchWebRequests(params),
          fetchWebStatistics({ range: params.range || '24h' }),
        ]);
        update((s) => ({
          ...s,
          requests: requestsPage.items || [],
          pagination: requestsPage.pagination,
          statistics,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load web monitoring telemetry',
        }));
      }
    },
  };
}

export const webStore = createWebStore();
export default webStore;

