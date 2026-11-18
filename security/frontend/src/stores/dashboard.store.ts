import { writable } from 'svelte/store';
import type { DashboardOverview, TrafficBucket } from '../lib/types/telemetry.ts';
import { fetchDashboardOverview, fetchDashboardTraffic } from '../services/api/dashboard.api.ts';

export interface DashboardState {
  overview: DashboardOverview | null;
  traffic: TrafficBucket[];
  range: string;
  loading: boolean;
  error: string | null;
}

function createDashboardStore() {
  const { subscribe, update } = writable<DashboardState>({
    overview: null,
    traffic: [],
    range: '24h',
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (range = '24h') => {
      update((s) => ({ ...s, loading: true, error: null, range }));
      try {
        const [overview, trafficRes] = await Promise.all([
          fetchDashboardOverview(range),
          fetchDashboardTraffic({ range, bucketMinutes: range === '15m' || range === '1h' ? 1 : 5 }),
        ]);
        update((s) => ({
          ...s,
          overview,
          traffic: trafficRes.series || [],
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load dashboard overview',
        }));
      }
    },
  };
}

export const dashboardStore = createDashboardStore();
export default dashboardStore;

