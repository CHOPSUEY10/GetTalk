import { writable } from 'svelte/store';
import { APPLICATION_METRIC_NAMES } from '../lib/metrics-chart.ts';
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

const MAX_POINTS_PER_METRIC = 120;

export function resolveTimeRangeBounds(range: string): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (range) {
    case '15m':
      return { from: new Date(now.getTime() - 15 * 60 * 1000).toISOString(), to };
    case '1h':
      return { from: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), to };
    case '6h':
      return { from: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), to };
    case '24h':
      return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), to };
    case '7d':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to };
    default:
      return {};
  }
}

function createApplicationStore() {
  const { subscribe, update } = writable<ApplicationState>({
    processes: [],
    metrics: [],
    pagination: { limit: 100, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (
      params: {
        limit?: number;
        offset?: number;
        metricName?: string;
        range?: string;
        from?: string;
        to?: string;
      } = {}
    ) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const perMetricLimit = params.limit ?? 100;
        const offset = params.offset ?? 0;
        const rangeBounds = params.range ? resolveTimeRangeBounds(params.range) : {};
        const from = params.from ?? rangeBounds.from;
        const to = params.to ?? rangeBounds.to;

        const targetMetricNames = params.metricName
          ? [params.metricName]
          : APPLICATION_METRIC_NAMES;

        const [procsPage, ...metricPages] = await Promise.all([
          fetchApplicationProcesses(),
          ...targetMetricNames.map((metricName) =>
            fetchApplicationMetrics({
              limit: perMetricLimit,
              offset,
              metricName,
              from,
              to,
            })
          ),
        ]);

        const seenIds = new Set<string>();
        const mergedMetrics: SystemMetric[] = [];
        let totalCount = 0;
        let hasMore = false;

        for (const page of metricPages) {
          totalCount += page.pagination?.total ?? (page.items?.length || 0);
          if (page.pagination?.hasMore) {
            hasMore = true;
          }
          for (const item of page.items || []) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              mergedMetrics.push(item);
            }
          }
        }

        mergedMetrics.sort(
          (a, b) => Date.parse(b.recordedAt || '') - Date.parse(a.recordedAt || '')
        );

        update((s) => ({
          ...s,
          processes: procsPage.items || [],
          metrics: mergedMetrics,
          pagination: {
            limit: perMetricLimit,
            offset,
            total: totalCount,
            hasMore,
          },
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

    appendRealtimeMetric: (metric: SystemMetric) => {
      if (!metric || metric.source !== 'pm2') return;
      update((s) => {
        if (s.metrics.some((m) => m.id === metric.id)) {
          return s;
        }
        const nextMetrics = [metric, ...s.metrics];
        // Cap per-metric history size in memory
        const countsByMetric = new Map<string, number>();
        const boundedMetrics = nextMetrics.filter((m) => {
          const count = countsByMetric.get(m.metricName) || 0;
          if (count >= MAX_POINTS_PER_METRIC) return false;
          countsByMetric.set(m.metricName, count + 1);
          return true;
        });

        return {
          ...s,
          metrics: boundedMetrics,
        };
      });
    },
  };
}

export const applicationStore = createApplicationStore();
export default applicationStore;
