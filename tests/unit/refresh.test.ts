import { describe, it, expect } from 'vitest';
import {
  validateRefreshInterval,
  isCacheStale,
  calculateNextRefreshAt,
} from '../../workers/aggregator/refresh';

describe('validateRefreshInterval', () => {
  it('rejects intervals below 15 minutes', () => {
    expect(validateRefreshInterval(0)).toEqual({
      valid: false,
      error: 'Refresh interval must be at least 15 minutes',
    });
    expect(validateRefreshInterval(14)).toEqual({
      valid: false,
      error: 'Refresh interval must be at least 15 minutes',
    });
    expect(validateRefreshInterval(1)).toEqual({
      valid: false,
      error: 'Refresh interval must be at least 15 minutes',
    });
    expect(validateRefreshInterval(-10)).toEqual({
      valid: false,
      error: 'Refresh interval must be at least 15 minutes',
    });
  });

  it('accepts interval of exactly 15 minutes', () => {
    expect(validateRefreshInterval(15)).toEqual({ valid: true });
  });

  it('accepts intervals above 15 minutes', () => {
    expect(validateRefreshInterval(16)).toEqual({ valid: true });
    expect(validateRefreshInterval(60)).toEqual({ valid: true });
    expect(validateRefreshInterval(1440)).toEqual({ valid: true });
  });

  it('rejects NaN', () => {
    expect(validateRefreshInterval(NaN)).toEqual({
      valid: false,
      error: 'Refresh interval must be a finite number',
    });
  });

  it('rejects Infinity', () => {
    expect(validateRefreshInterval(Infinity)).toEqual({
      valid: false,
      error: 'Refresh interval must be a finite number',
    });
  });
});

describe('isCacheStale', () => {
  const baseTime = new Date('2024-06-01T12:00:00.000Z');

  it('returns false when cache is fresh (within 2 × interval)', () => {
    // Last refresh was at 12:00, interval is 60min, threshold is 120min
    // Checking at 12:30 → not stale
    const currentTime = new Date('2024-06-01T12:30:00.000Z');
    expect(isCacheStale(baseTime.toISOString(), 60, currentTime)).toBe(false);
  });

  it('returns false when exactly at the boundary (not stale)', () => {
    // Last refresh at 12:00, interval 60min, threshold is 120min
    // Exactly at 14:00 → not stale (must exceed, not equal)
    const currentTime = new Date('2024-06-01T14:00:00.000Z');
    expect(isCacheStale(baseTime.toISOString(), 60, currentTime)).toBe(false);
  });

  it('returns true when past the boundary (stale)', () => {
    // Last refresh at 12:00, interval 60min, threshold is 120min
    // At 14:00:01 → stale
    const currentTime = new Date('2024-06-01T14:00:01.000Z');
    expect(isCacheStale(baseTime.toISOString(), 60, currentTime)).toBe(true);
  });

  it('returns true when well past the boundary', () => {
    // Last refresh at 12:00, interval 60min, checking at 18:00
    const currentTime = new Date('2024-06-01T18:00:00.000Z');
    expect(isCacheStale(baseTime.toISOString(), 60, currentTime)).toBe(true);
  });

  it('works with 15-minute interval', () => {
    // Interval 15min → threshold 30min
    // Last refresh at 12:00, check at 12:29 → not stale
    const fresh = new Date('2024-06-01T12:29:00.000Z');
    expect(isCacheStale(baseTime.toISOString(), 15, fresh)).toBe(false);

    // Check at 12:31 → stale
    const stale = new Date('2024-06-01T12:31:00.000Z');
    expect(isCacheStale(baseTime.toISOString(), 15, stale)).toBe(true);
  });

  it('handles same timestamp as last refresh (not stale)', () => {
    expect(isCacheStale(baseTime.toISOString(), 60, baseTime)).toBe(false);
  });
});

describe('calculateNextRefreshAt', () => {
  it('adds interval minutes to the given time', () => {
    const from = new Date('2024-06-01T12:00:00.000Z');
    const result = calculateNextRefreshAt(60, from);
    expect(result).toBe('2024-06-01T13:00:00.000Z');
  });

  it('works with 15-minute interval', () => {
    const from = new Date('2024-06-01T12:00:00.000Z');
    const result = calculateNextRefreshAt(15, from);
    expect(result).toBe('2024-06-01T12:15:00.000Z');
  });

  it('works with large intervals', () => {
    const from = new Date('2024-06-01T12:00:00.000Z');
    const result = calculateNextRefreshAt(1440, from); // 24 hours
    expect(result).toBe('2024-06-02T12:00:00.000Z');
  });

  it('returns a valid ISO 8601 string', () => {
    const from = new Date('2024-06-01T12:00:00.000Z');
    const result = calculateNextRefreshAt(30, from);
    // Should be parseable back to a valid Date
    const parsed = new Date(result);
    expect(parsed.getTime()).toBe(from.getTime() + 30 * 60 * 1000);
  });

  it('defaults to current time when fromTime is not provided', () => {
    const before = Date.now();
    const result = calculateNextRefreshAt(60);
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    // The result should be approximately 60 minutes from now
    expect(resultMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(resultMs).toBeLessThanOrEqual(after + 60 * 60 * 1000);
  });
});
