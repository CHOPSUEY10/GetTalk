import { writable } from 'svelte/store';
import type {
  PM2ProcessSummary,
  PaginationMeta,
  SystemMetric,
} from '../lib/types/telemetry.ts';
import {
  fetchApplicationMetrics,
  fetchApplicationProcesses,
} from '../services/api/application.api.ts';

export interface ApplicationState {
  processes: PM2ProcessSummary[];
  metrics: SystemMetric[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createApplicationStore() {
  const { subscribe, update } = writable<ApplicationState>({
    processes: [],
    metrics: [],
    pagination: { limit: 25, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: { limit?: number; offset?: number; metricName?: string } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const [procsPage, metricsPage] = await Promise.all([
          fetchApplicationProcesses(),
          fetchApplicationMetrics(params),
        ]);
        update((s) => ({
          ...s,
          processes: procsPage.items || [],
          metrics: metricsPage.items || [],
          pagination: metricsPage.pagination,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load application monitoring metrics',
        }));
      }
    },
  };
}

export const applicationStore = createApplicationStore();
export default applicationStore;

