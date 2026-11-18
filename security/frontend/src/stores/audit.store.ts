import { writable } from 'svelte/store';
import type { AuditLog, PaginationMeta } from '../lib/types/telemetry.ts';
import { fetchAuditLogs } from '../services/api/audit.api.ts';

export interface AuditState {
  logs: AuditLog[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createAuditStore() {
  const { subscribe, update } = writable<AuditState>({
    logs: [],
    pagination: { limit: 25, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: {
      limit?: number;
      offset?: number;
      actorId?: string;
      eventType?: string;
      from?: string;
      to?: string;
    } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await fetchAuditLogs(params);
        update((s) => ({
          ...s,
          logs: page.items || [],
          pagination: page.pagination,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load audit logs',
        }));
      }
    },
  };
}

export const auditStore = createAuditStore();
export default auditStore;

