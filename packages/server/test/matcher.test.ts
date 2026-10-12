import { describe, expect, it } from 'vitest';
import { matchesAll, MatcherError, parseCondition, validateMatchers } from '../src/engine/matcher.js';

const ctx = {
  severity: 'high',
  priority: 2,
  source: 'github',
  service: 'api-gateway',
  services: ['api-gateway', 'postgres'],
  host: 'web-03',
  'labels.env': 'prod',
  title: 'Workflow "CI" failed',
};

describe('matcher', () => {
  it.each([
    ['severity >= high', true],
    ['severity >= critical', false],
    ['severity < critical', true],
    ['severity = HIGH', true],
    ['labels.env = prod', true],
    ['labels.env != prod', false],
    ['labels.team exists', false],
    ['labels.team missing', true],
    ['service =~ ^api-', true],
    ['service !~ ^api-', false],
    ['host = web-*', true],
    ['host = db-*', false],
    ['source in [github, gitlab]', true],
    ['source not in [github, gitlab]', false],
    ['source in gitlab', false],
    ['services = postgres', true],
    ['services != postgres', false],
    ['priority <= 2', true],
    ['priority < 2', false],
    ['title = "Workflow \\"CI\\" failed"', false],
    ["title =~ 'CI'", true],
  ])('%s → %s', (expr, expected) => {
    expect(matchesAll([expr], ctx)).toBe(expected);
  });

  it('requires all conditions', () => {
    expect(matchesAll(['severity >= warning', 'labels.env = prod'], ctx)).toBe(true);
    expect(matchesAll(['severity >= warning', 'labels.env = staging'], ctx)).toBe(false);
    expect(matchesAll([], ctx)).toBe(true);
  });

  it('rejects invalid expressions', () => {
    expect(() => parseCondition('severity ~ high')).toThrow(MatcherError);
    expect(() => parseCondition('service =~ (')).toThrow(MatcherError);
    expect(() => parseCondition('severity >= urgentish')).toThrow(MatcherError);
    expect(validateMatchers(['severity >= high', 'oops'])).toHaveLength(1);
  });
});
