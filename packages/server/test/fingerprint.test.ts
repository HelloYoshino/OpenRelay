import { describe, expect, it } from 'vitest';
import { computeFingerprint, jaccard, normalizeText, tokenize } from '../src/engine/fingerprint.js';

describe('normalizeText', () => {
  it('replaces volatile parts with placeholders', () => {
    expect(normalizeText('Request 8f14e45f-ceea-467f-a0e3-a1b2c3d4e5f6 failed after 3021ms')).toBe('request <uuid> failed after <n>ms');
    expect(normalizeText('Connection to 10.0.0.5:5432 refused')).toBe('connection to <ip> refused');
    expect(normalizeText('Build deadbeef12 failed at 2026-10-12T10:00:00Z')).toBe('build <hex> failed at <ts>');
    expect(normalizeText('Mail to ops@example.com bounced')).toBe('mail to <email> bounced');
  });

  it('keeps meaningful words', () => {
    expect(normalizeText('Disk  FULL on   /var')).toBe('disk full on /var');
  });
});

describe('computeFingerprint', () => {
  const base = { source: 'api', service: 'checkout', host: null, type: null };

  it('treats messages that only differ in ids and numbers as identical', () => {
    const a = computeFingerprint({ ...base, title: 'Timeout after 3021 ms for order 1234' });
    const b = computeFingerprint({ ...base, title: 'Timeout after 12 ms for order 98765' });
    expect(a).toBe(b);
  });

  it('distinguishes services and sources', () => {
    const a = computeFingerprint({ ...base, title: 'Timeout' });
    expect(computeFingerprint({ ...base, service: 'billing', title: 'Timeout' })).not.toBe(a);
    expect(computeFingerprint({ ...base, source: 'worker', title: 'Timeout' })).not.toBe(a);
  });
});

describe('similarity', () => {
  it('scores similar titles high and unrelated ones low', () => {
    expect(jaccard(tokenize('Database connection refused'), tokenize('database connection refused on replica'))).toBeGreaterThan(0.5);
    expect(jaccard(tokenize('Disk full'), tokenize('Certificate expires soon'))).toBe(0);
  });
});
