const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;
const RULE_ID_REGEX = /^[A-Z0-9]+-[A-Z0-9]+$/;

export function isValidIPFilter(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return true;
  if (trimmed.length > 45) return false;
  return IPV4_REGEX.test(trimmed) || (trimmed.includes(':') && IPV6_REGEX.test(trimmed));
}

export function validateRuleInput(input: {
  id: string;
  ruleName: string;
  threshold: number;
  timeWindow: number;
}): string | null {
  const id = input.id.trim().toUpperCase();
  if (!id || !RULE_ID_REGEX.test(id) || id.length > 32) {
    return 'Rule ID must follow format PREFIX-NNN (e.g. NET-003) and be at most 32 characters.';
  }
  if (!input.ruleName.trim() || input.ruleName.trim().length > 128) {
    return 'Rule name is required (max 128 characters).';
  }
  if (!Number.isFinite(input.threshold) || input.threshold < 0) {
    return 'Threshold must be a non-negative number.';
  }
  if (!Number.isInteger(input.timeWindow) || input.timeWindow < 1 || input.timeWindow > 86400) {
    return 'Time window must be an integer between 1 and 86400 seconds.';
  }
  return null;
}

export function validateRetentionInput(input: {
  telemetryEventsDays: number;
  systemMetricsDays: number;
  securityAlertsDays: number;
}): string | null {
  for (const [label, val] of [
    ['Raw telemetry events retention', input.telemetryEventsDays],
    ['System metrics retention', input.systemMetricsDays],
    ['Security alerts retention', input.securityAlertsDays],
  ] as const) {
    if (!Number.isInteger(val) || val < 1 || val > 3650) {
      return `${label} must be between 1 and 3650 days.`;
    }
  }
  return null;
}

