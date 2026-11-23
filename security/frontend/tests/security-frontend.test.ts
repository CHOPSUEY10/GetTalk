import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_ERROR_CODES,
  handleApiError,
  mapStatusToCode,
} from '../src/lib/errors/apierror.ts';
import { sanitize, sanitizeString, sanitizeUrl } from '../src/lib/logger.ts';
import {
  hasHeaderInjection,
  isValidIPFilter,
  validateIngestEventInput,
  validateKillSwitchInput,
  validateRetentionInput,
  validateRuleInput,
} from '../src/lib/validators.ts';
import { generateQrCodeMatrix, generateQrCodeSvg } from '../src/lib/qrcode.ts';
import {
  APPLICATION_METRIC_NAMES,
  buildMetricChartGroups,
  buildPlottedSeries,
  extractProcessNames,
  formatMemoryBytes,
  formatUptimeDuration,
} from '../src/lib/metrics-chart.ts';
import type { SystemMetric } from '../src/lib/types/telemetry.ts';
import { buildQueryString, getCsrfToken, setCsrfToken } from '../src/services/api/client.ts';
import { resolveTimeRangeBounds } from '../src/stores/application.store.ts';

test('Error normalization maps HTTP status codes and redacts SQL/internal leaks', () => {
  assert.equal(mapStatusToCode(400), API_ERROR_CODES.VALIDATION_ERROR);
  assert.equal(mapStatusToCode(401), API_ERROR_CODES.UNAUTHORIZED);
  assert.equal(mapStatusToCode(403), API_ERROR_CODES.FORBIDDEN);
  assert.equal(mapStatusToCode(404), API_ERROR_CODES.NOT_FOUND);
  assert.equal(mapStatusToCode(409), API_ERROR_CODES.CONFLICT);
  assert.equal(mapStatusToCode(429), API_ERROR_CODES.TOO_MANY_REQUESTS);
  assert.equal(mapStatusToCode(500), API_ERROR_CODES.SERVER_ERROR);

  const sqlLeakErr = handleApiError(null, {
    status: 500,
    endpoint: 'http://localhost:4100/api/v1/events?sourceIp=1.2.3.4',
    method: 'GET',
    data: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'SELECT * FROM telemetry_events WHERE source_ip = $1 syntax error at or near',
      },
    },
    silent: true,
  });

  assert.equal(sqlLeakErr.code, API_ERROR_CODES.SERVER_ERROR);
  assert.equal(sqlLeakErr.endpoint, '/api/v1/events');
  assert.ok(!sqlLeakErr.message.includes('SELECT'));
  assert.ok(!sqlLeakErr.message.includes('telemetry_events'));
});

test('Logger sanitizes tokens, passwords, SQL, and filesystem paths', () => {
  const dirty =
    'Bearer eyJhbGciOiJIUzI1NiJ9.secret password=MySecret123 SELECT id FROM security_admins /var/log/nginx/access.log';
  const cleaned = sanitizeString(dirty);
  assert.ok(!cleaned.includes('MySecret123'));
  assert.ok(cleaned.includes('[REDACTED]'));
  assert.ok(cleaned.includes('[REDACTED_SQL]'));
  assert.ok(cleaned.includes('[REDACTED_PATH]'));

  const obj = sanitize({
    username: 'secadmin',
    password: 'PlainPassword',
    csrfToken: 'csrf-123',
    mfaSecret: 'JBSWY3DPEHPK3PXP',
  });
  assert.equal(obj.username, 'secadmin');
  assert.equal(obj.password, '[REDACTED]');
  assert.equal(obj.csrfToken, '[REDACTED]');
  assert.equal(obj.mfaSecret, '[REDACTED]');

  assert.equal(sanitizeUrl('https://monitor.gettalk.example/api/v1/events?token=abc'), '/api/v1/events');
});

test('Client-side validators enforce IP, detection rule, and retention constraints', () => {
  assert.equal(isValidIPFilter(''), true);
  assert.equal(isValidIPFilter('203.0.113.45'), true);
  assert.equal(isValidIPFilter('2001:db8::1'), true);
  assert.equal(isValidIPFilter("198.51.100.1' OR '1'='1"), false);

  assert.equal(
    validateRuleInput({
      id: 'NET-003',
      ruleName: 'SSH Brute Force',
      threshold: 25,
      timeWindow: 60,
    }),
    null
  );
  assert.notEqual(
    validateRuleInput({
      id: 'invalid_id',
      ruleName: 'Bad ID',
      threshold: 10,
      timeWindow: 60,
    }),
    null
  );

  assert.equal(
    validateRetentionInput({
      telemetryEventsDays: 30,
      systemMetricsDays: 90,
      securityAlertsDays: 180,
    }),
    null
  );
  assert.notEqual(
    validateRetentionInput({
      telemetryEventsDays: 0,
      systemMetricsDays: 90,
      securityAlertsDays: 180,
    }),
    null
  );
});

test('API client query string builder and CSRF token state work as expected', () => {
  setCsrfToken('test-csrf-token-999');
  assert.equal(getCsrfToken(), 'test-csrf-token-999');
  setCsrfToken('');
  assert.equal(getCsrfToken(), '');

  const qs = buildQueryString({ limit: 20, offset: 0, source: 'nginx', empty: '' });
  assert.equal(qs, '?limit=20&offset=0&source=nginx');
});

test('Local TOTP QR Code generator produces standards-compliant SVG for otpauth:// URIs', () => {
  const otpUri =
    'otpauth://totp/GetTalkSecurity:requiemstand90@gmail.com?secret=TH6G6VHRVEESBZ6HRNQNXPCVY7ERHLKF&issuer=GetTalkSecurity&algorithm=SHA1&digits=6&period=30';

  const matrix = generateQrCodeMatrix(otpUri);
  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length);

  const svg = generateQrCodeSvg(otpUri, {
    size: 196,
    title: 'GetTalk Security TOTP MFA QR Code',
  });
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('width="196"'));
  assert.ok(svg.includes('GetTalk Security TOTP MFA QR Code'));
  assert.ok(svg.includes('<path d="M'));

  assert.throws(() => generateQrCodeMatrix(''), /non-empty string/);
});

test('Application metrics time-series grouping creates dedicated charts per metric and plots coordinates', () => {
  const sampleMetrics: SystemMetric[] = [
    {
      id: 'm-1',
      source: 'pm2',
      metricName: 'cpu_percent',
      metricValue: 18.5,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:00:00Z',
    },
    {
      id: 'm-2',
      source: 'pm2',
      metricName: 'cpu_percent',
      metricValue: 34.2,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:05:00Z',
    },
    {
      id: 'm-3',
      source: 'pm2',
      metricName: 'memory_bytes',
      metricValue: 64 * 1024 * 1024,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:05:00Z',
    },
    {
      id: 'm-4',
      source: 'pm2',
      metricName: 'memory_percent',
      metricValue: 6.25,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:05:00Z',
    },
    {
      id: 'm-5',
      source: 'pm2',
      metricName: 'restart_count',
      metricValue: 2,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:05:00Z',
    },
    {
      id: 'm-6',
      source: 'pm2',
      metricName: 'uptime_seconds',
      metricValue: 7265,
      labels: { process_name: 'gettalk-api', pm_id: 0, status: 'online' },
      recordedAt: '2026-11-19T06:05:00Z',
    },
  ];

  // Should build one dedicated chart group for each of the 5 application metrics
  const groups = buildMetricChartGroups(sampleMetrics);
  assert.equal(groups.length, APPLICATION_METRIC_NAMES.length);
  assert.deepEqual(
    groups.map((g) => g.metricName),
    APPLICATION_METRIC_NAMES
  );

  const cpuGroup = groups.find((g) => g.metricName === 'cpu_percent')!;
  assert.equal(cpuGroup.totalPoints, 2);
  assert.equal(cpuGroup.minValue, 18.5);
  assert.equal(cpuGroup.maxValue, 34.2);
  assert.equal(cpuGroup.latestValue, 34.2);
  assert.equal(cpuGroup.formatValue(34.2), '34.2%');

  const plotted = buildPlottedSeries(cpuGroup, {
    width: 760,
    height: 225,
    padLeft: 64,
    padRight: 18,
    padTop: 18,
    padBottom: 30,
  });
  assert.ok(plotted.axisMax >= 34.2);
  assert.equal(plotted.plottedSeries.length, 1);
  assert.equal(plotted.plottedSeries[0].coordinates.length, 2);
  assert.ok(plotted.plottedSeries[0].polylinePoints.includes(' '));
  assert.ok(plotted.plottedSeries[0].areaPoints.length > 0);

  // Filtering by metricName returns only that metric's chart group
  const filteredByMetric = buildMetricChartGroups(sampleMetrics, {
    metricNameFilter: 'memory_bytes',
  });
  assert.equal(filteredByMetric.length, 1);
  assert.equal(filteredByMetric[0].metricName, 'memory_bytes');
  assert.equal(filteredByMetric[0].formatValue(64 * 1024 * 1024), '64.0 MB');

  // Process name extraction & formatting helpers
  assert.deepEqual(extractProcessNames(sampleMetrics), ['gettalk-api']);
  assert.equal(formatMemoryBytes(0), '0 MB');
  assert.equal(formatMemoryBytes(50 * 1024 * 1024), '50.0 MB');
  assert.equal(formatUptimeDuration(7265), '2h 1m');

  const bounds = resolveTimeRangeBounds('1h');
  assert.ok(bounds.from && bounds.to);
});

test('Kill Switch 503 Service Unavailable error mapping and SIEM event / header-injection validation', () => {
  // 1. 503 maps to SERVICE_UNAVAILABLE rather than generic SERVER_ERROR
  assert.equal(mapStatusToCode(503), API_ERROR_CODES.SERVICE_UNAVAILABLE);

  const killSwitchErr = handleApiError(null, {
    status: 503,
    endpoint: 'http://localhost:4100/api/v1/events',
    method: 'POST',
    data: {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'SIEM backend is temporarily disabled by administrator kill switch',
      },
    },
    silent: true,
  });
  assert.equal(killSwitchErr.code, API_ERROR_CODES.SERVICE_UNAVAILABLE);
  assert.equal(killSwitchErr.status, 503);
  assert.ok(killSwitchErr.message.includes('kill switch'));

  // 2. SMTP Header Injection (CRLF) & SIEM Event input validation
  assert.equal(hasHeaderInjection('clean-event-001', 'normal description'), false);
  assert.equal(hasHeaderInjection('evt-001\r\nBcc: evil@attacker.example'), true);
  assert.equal(hasHeaderInjection('normal', 'line1\nSubject: Injected'), true);

  assert.equal(
    validateIngestEventInput({
      event_id: 'evt-crit-001',
      source: 'siem',
      event_type: 'intrusion_detected',
      source_ip: '198.51.100.99',
      severity: 'critical',
      description: 'Unauthorized root access detected',
    }),
    null
  );

  assert.notEqual(
    validateIngestEventInput({
      event_id: '',
      severity: 'critical',
      description: 'Missing event_id',
    }),
    null
  );

  assert.notEqual(
    validateIngestEventInput({
      event_id: 'evt-1\r\nBcc: attacker@evil.com',
      severity: 'critical',
      description: 'Header injection attempt in event_id',
    }),
    null
  );

  assert.notEqual(
    validateIngestEventInput({
      event_id: 'evt-2',
      severity: 'critical',
      description: 'Header injection\r\nSubject: Hacked',
    }),
    null
  );

  // 3. Kill Switch input validator
  assert.equal(
    validateKillSwitchInput({
      enabled: false,
      reason: 'Emergency incident response',
    }),
    null
  );
  assert.notEqual(
    validateKillSwitchInput({
      enabled: false,
      reason: 'Invalid reason\r\nInjected-Header: true',
    }),
    null
  );
});




