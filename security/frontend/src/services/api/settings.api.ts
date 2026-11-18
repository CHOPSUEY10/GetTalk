import type { RetentionConfig, SystemSettingsResponse } from '../../lib/types/telemetry.ts';
import api from './client.ts';

export async function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  return api.get<SystemSettingsResponse>('/api/v1/settings');
}

export async function updateRetentionSettings(
  retention: RetentionConfig
): Promise<SystemSettingsResponse> {
  return api.patch<SystemSettingsResponse>('/api/v1/settings/retention', retention);
}

