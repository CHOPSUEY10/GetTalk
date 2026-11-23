import { writable } from 'svelte/store';
import type {
  KillSwitchStatus,
  RetentionConfig,
  SystemSettingsResponse,
} from '../lib/types/telemetry.ts';
import {
  fetchKillSwitchStatus,
  fetchSystemSettings,
  updateKillSwitchStatus,
  updateRetentionSettings,
} from '../services/api/settings.api.ts';

export interface SettingsState {
  settings: SystemSettingsResponse | null;
  killSwitch: KillSwitchStatus | null;
  loading: boolean;
  saving: boolean;
  togglingKillSwitch: boolean;
  error: string | null;
}

function createSettingsStore() {
  const { subscribe, update } = writable<SettingsState>({
    settings: null,
    killSwitch: null,
    loading: false,
    saving: false,
    togglingKillSwitch: false,
    error: null,
  });

  return {
    subscribe,
    loadKillSwitch: async () => {
      try {
        const ks = await fetchKillSwitchStatus();
        update((s) => ({ ...s, killSwitch: ks }));
        return ks;
      } catch {
        // Non-admin roles cannot access /api/v1/admin/kill-switch; ignore silently
        return null;
      }
    },
    load: async () => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const ksPromise = fetchKillSwitchStatus().catch(() => null);
        const [settingsResult, ksResult] = await Promise.allSettled([
          fetchSystemSettings(),
          ksPromise,
        ]);

        const ks = ksResult.status === 'fulfilled' ? ksResult.value : null;
        if (settingsResult.status === 'fulfilled') {
          update((s) => ({
            ...s,
            settings: settingsResult.value,
            killSwitch: ks ?? s.killSwitch ?? {
              enabled: true,
              key: 'siem:backend:enabled',
              updatedAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
          }));
        } else {
          const err: any = settingsResult.reason;
          const is503 = err?.status === 503 || err?.code === 'SERVICE_UNAVAILABLE';
          update((s) => ({
            ...s,
            killSwitch:
              ks ??
              (is503
                ? {
                    enabled: false,
                    key: 'siem:backend:enabled',
                    updatedAt: new Date().toISOString(),
                  }
                : s.killSwitch),
            loading: false,
            error: err?.message || 'Failed to load telemetry settings',
          }));
        }
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
    toggleKillSwitch: async (enabled: boolean, reason?: string) => {
      update((s) => ({ ...s, togglingKillSwitch: true, error: null }));
      try {
        const ks = await updateKillSwitchStatus({ enabled, reason });
        update((s) => ({
          ...s,
          killSwitch: ks,
          togglingKillSwitch: false,
          error: null,
        }));
        if (enabled) {
          try {
            const settings = await fetchSystemSettings();
            update((s) => ({ ...s, settings }));
          } catch {
            // Ignore secondary refresh error
          }
        }
        return ks;
      } catch (err: any) {
        update((s) => ({
          ...s,
          togglingKillSwitch: false,
          error: err?.message || 'Failed to update backend kill switch',
        }));
        throw err;
      }
    },
    markKillSwitchDisabled: () => {
      update((s) => ({
        ...s,
        killSwitch: {
          enabled: false,
          key: s.killSwitch?.key || 'siem:backend:enabled',
          reason: s.killSwitch?.reason,
          updatedBy: s.killSwitch?.updatedBy,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
  };
}

export const settingsStore = createSettingsStore();
export default settingsStore;


