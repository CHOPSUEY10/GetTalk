import type {
  KillSwitchStatus,
  RetentionConfig,
  SystemSettingsResponse,
} from '../../lib/types/telemetry.ts';
import api from './client.ts';

export async function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  return api.get<SystemSettingsResponse>('/api/v1/settings');
}

export async function updateRetentionSettings(
  retention: RetentionConfig
): Promise<SystemSettingsResponse> {
  return api.patch<SystemSettingsResponse>('/api/v1/settings/retention', retention);
}

export async function fetchKillSwitchStatus(): Promise<KillSwitchStatus> {
  return api.get<KillSwitchStatus>('/api/v1/admin/kill-switch');
}

export async function updateKillSwitchStatus(payload: {
  enabled: boolean;
  reason?: string;
}): Promise<KillSwitchStatus> {
  return api.post<KillSwitchStatus>('/api/v1/admin/kill-switch', payload);
}


