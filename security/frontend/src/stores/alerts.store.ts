import { writable } from 'svelte/store';
import type {
  AlertStatus,
  PaginationMeta,
  SecurityAlert,
} from '../lib/types/telemetry.ts';
import {
  fetchSecurityAlerts,
  updateSecurityAlertStatus,
} from '../services/api/alerts.api.ts';

export interface AlertsState {
  alerts: SecurityAlert[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createAlertsStore() {
  const { subscribe, update } = writable<AlertsState>({
    alerts: [],
    pagination: { limit: 20, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: {
      limit?: number;
      offset?: number;
      severity?: string;
      status?: string;
      ruleId?: string;
      sourceIp?: string;
    } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await fetchSecurityAlerts(params);
        update((s) => ({
          ...s,
          alerts: page.items || [],
          pagination: page.pagination,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load security alerts',
        }));
      }
    },
    updateStatus: async (id: string, status: AlertStatus) => {
      const updated = await updateSecurityAlertStatus(id, status);
      update((s) => ({
        ...s,
        alerts: s.alerts.map((a) => (a.id === id ? updated : a)),
      }));
      return updated;
    },
    prependRealtimeAlert: (alert: SecurityAlert) => {
      update((s) => ({
        ...s,
        alerts: [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(0, 50),
      }));
    },
  };
}

export const alertsStore = createAlertsStore();
export default alertsStore;

