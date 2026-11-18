import { writable } from 'svelte/store';
import type { RetentionConfig, SystemSettingsResponse } from '../lib/types/telemetry.ts';
import {
  fetchSystemSettings,
  updateRetentionSettings,
} from '../services/api/settings.api.ts';

export interface SettingsState {
  settings: SystemSettingsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

function createSettingsStore() {
  const { subscribe, update } = writable<SettingsState>({
    settings: null,
    loading: false,
    saving: false,
    error: null,
  });

  return {
    subscribe,
    load: async () => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const settings = await fetchSystemSettings();
        update((s) => ({ ...s, settings, loading: false, error: null }));
      } catch (err: any) {
        update((s) => ({
          ...s,
          loading: false,
          error: err?.message || 'Failed to load telemetry settings',
        }));
      }
    },
    saveRetention: async (retention: RetentionConfig) => {
      update((s) => ({ ...s, saving: true, error: null }));
      try {
        const updated = await updateRetentionSettings(retention);
        update((s) => ({ ...s, settings: updated, saving: false, error: null }));
        return updated;
      } catch (err: any) {
        update((s) => ({
          ...s,
          saving: false,
          error: err?.message || 'Failed to update retention settings',
        }));
        throw err;
      }
    },
  };
}

export const settingsStore = createSettingsStore();
export default settingsStore;

