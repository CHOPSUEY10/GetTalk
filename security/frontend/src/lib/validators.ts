const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;
const RULE_ID_REGEX = /^[A-Z0-9]+-[A-Z0-9]+$/;
const HEADER_INJECTION_REGEX = /[\r\n\x00]/;
const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

export function hasHeaderInjection(...values: (string | undefined | null)[]): boolean {
  return values.some((v) => typeof v === 'string' && HEADER_INJECTION_REGEX.test(v));
}

export function isValidIPFilter(ip: string): boolean {
  if (hasHeaderInjection(ip)) return false;
  const trimmed = ip.trim();
  if (!trimmed) return true;
  if (trimmed.length > 45) return false;
  return IPV4_REGEX.test(trimmed) || (trimmed.includes(':') && IPV6_REGEX.test(trimmed));
}

export function validateIngestEventInput(input: {
  event_id: string;
  source?: string;
  event_type?: string;
  source_ip?: string;
  severity: string;
  description: string;
}): string | null {
  if (
    hasHeaderInjection(
      input.event_id,
      input.source,
      input.event_type,
      input.source_ip,
      input.severity,
      input.description
    )
  ) {
    return 'Invalid control characters (CRLF / header injection) are not allowed.';
  }
  const eventId = (input.event_id || '').trim();
  if (!eventId || eventId.length > 128) {
    return 'Event ID is required (max 128 characters).';
  }
  const sev = (input.severity || '').trim().toLowerCase();
  if (!VALID_SEVERITIES.has(sev)) {
    return 'Severity must be one of: info, low, medium, high, critical.';
  }
  const desc = (input.description || '').trim();
  if (!desc || desc.length > 4096) {
    return 'Description is required (max 4096 characters).';
  }
  const srcIp = (input.source_ip || '').trim();
  if (srcIp && !isValidIPFilter(srcIp)) {
    return 'Source IP must be a valid IPv4 or IPv6 address.';
  }
  return null;
}

export function validateKillSwitchInput(input: {
  enabled: boolean;
  reason?: string;
}): string | null {
  if (typeof input.enabled !== 'boolean') {
    return 'Kill switch enabled flag must be a boolean.';
  }
  if (hasHeaderInjection(input.reason)) {
    return 'Invalid control characters (CRLF) are not allowed in reason.';
  }
  if (input.reason && input.reason.trim().length > 512) {
    return 'Reason must be at most 512 characters.';
  }
  return null;
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

