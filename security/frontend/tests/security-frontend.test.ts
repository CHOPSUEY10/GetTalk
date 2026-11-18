import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_ERROR_CODES,
  handleApiError,
  mapStatusToCode,
} from '../src/lib/errors/apierror.ts';
import { sanitize, sanitizeString, sanitizeUrl } from '../src/lib/logger.ts';
import {
  isValidIPFilter,
  validateRetentionInput,
  validateRuleInput,
} from '../src/lib/validators.ts';
import { buildQueryString, getCsrfToken, setCsrfToken } from '../src/services/api/client.ts';

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

