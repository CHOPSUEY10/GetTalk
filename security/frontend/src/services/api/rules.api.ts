import type { DetectionRule, PaginatedResult } from '../../lib/types/telemetry.ts';
import api, { buildQueryString } from './client.ts';

export async function fetchDetectionRules(params: {
  limit?: number;
  offset?: number;
  severity?: string;
} = {}): Promise<PaginatedResult<DetectionRule>> {
  return api.get<PaginatedResult<DetectionRule>>(
    `/api/v1/rules${buildQueryString({ limit: 50, ...params })}`
  );
}

export async function createDetectionRule(
  rule: Omit<DetectionRule, 'updatedAt'>
): Promise<DetectionRule> {
  return api.post<DetectionRule>('/api/v1/rules', rule);
}

export async function updateDetectionRule(
  id: string,
  patch: Partial<Pick<DetectionRule, 'ruleName' | 'threshold' | 'timeWindow' | 'severity' | 'enabled' | 'configuration'>>
): Promise<DetectionRule> {
  return api.patch<DetectionRule>(`/api/v1/rules/${encodeURIComponent(id)}`, patch);
}

