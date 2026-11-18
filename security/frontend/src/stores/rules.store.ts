import { writable } from 'svelte/store';
import type { DetectionRule, PaginationMeta } from '../lib/types/telemetry.ts';
import {
  createDetectionRule,
  fetchDetectionRules,
  updateDetectionRule,
} from '../services/api/rules.api.ts';

export interface RulesState {
  rules: DetectionRule[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;
}

function createRulesStore() {
  const { subscribe, update } = writable<RulesState>({
    rules: [],
    pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
    loading: false,
    error: null,
  });

  return {
    subscribe,
    load: async (params: { limit?: number; offset?: number; severity?: string } = {}) => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await fetchDetectionRules(params);
        update((s) => ({
          ...s,
          rules: page.items || [],
          pagination: page.pagination,
          loading: false,
          error: null,
        }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load IDS detection rules',
        }));
      }
    },
    create: async (rule: Omit<DetectionRule, 'updatedAt'>) => {
      const created = await createDetectionRule(rule);
      update((s) => ({
        ...s,
        rules: [...s.rules, created],
      }));
      return created;
    },
    patch: async (
      id: string,
      patch: Partial<Pick<DetectionRule, 'ruleName' | 'threshold' | 'timeWindow' | 'severity' | 'enabled' | 'configuration'>>
    ) => {
      const updated = await updateDetectionRule(id, patch);
      update((s) => ({
        ...s,
        rules: s.rules.map((r) => (r.id === id ? updated : r)),
      }));
      return updated;
    },
  };
}

export const rulesStore = createRulesStore();
export default rulesStore;

