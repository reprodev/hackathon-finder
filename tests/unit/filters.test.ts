import { describe, it, expect } from 'vitest';
import {
  buildFilterClauses,
  validateDateRange,
  getDateRangePreset,
  composeWhereClause,
} from '../../src/lib/filters';
import type { FilterCriteria } from '../../src/lib/types';

describe('validateDateRange', () => {
  it('returns valid for start <= end', () => {
    const result = validateDateRange('2025-01-01', '2025-01-31');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid when start equals end', () => {
    const result = validateDateRange('2025-06-15', '2025-06-15');
    expect(result.valid).toBe(true);
  });

  it('returns invalid when start > end', () => {
    const result = validateDateRange('2025-03-15', '2025-03-01');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Start date must not be after end date');
  });

  it('returns invalid for malformed start date', () => {
    const result = validateDateRange('not-a-date', '2025-01-31');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid start date format');
  });

  it('returns invalid for malformed end date', () => {
    const result = validateDateRange('2025-01-01', 'garbage');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid end date format');
  });
});

describe('getDateRangePreset', () => {
  const fixedNow = new Date('2025-06-15T12:00:00Z');

  it('upcoming returns tomorrow through far-future', () => {
    const result = getDateRangePreset('upcoming', fixedNow);
    expect(result.start).toBe('2025-06-16');
    expect(result.end).toBe('2099-12-31');
  });

  it('this_week returns today through today+7', () => {
    const result = getDateRangePreset('this_week', fixedNow);
    expect(result.start).toBe('2025-06-15');
    expect(result.end).toBe('2025-06-22');
  });

  it('this_month returns today through today+30', () => {
    const result = getDateRangePreset('this_month', fixedNow);
    expect(result.start).toBe('2025-06-15');
    expect(result.end).toBe('2025-07-15');
  });
});

describe('buildFilterClauses', () => {
  describe('date range filter', () => {
    it('produces BETWEEN-style clause for valid date range', () => {
      const filters: FilterCriteria = {
        dateRange: { start: '2025-01-01', end: '2025-06-30' },
      };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('start_date >= ? AND start_date <= ?');
      expect(result.bindValues).toEqual(['2025-01-01', '2025-06-30']);
    });

    it('throws on invalid date range (start > end)', () => {
      const filters: FilterCriteria = {
        dateRange: { start: '2025-06-30', end: '2025-01-01' },
      };
      expect(() => buildFilterClauses(filters)).toThrow('Start date must not be after end date');
    });
  });

  describe('format filter', () => {
    it('produces IN clause for single format', () => {
      const filters: FilterCriteria = { format: ['virtual'] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('format IN (?)');
      expect(result.bindValues).toEqual(['virtual']);
    });

    it('produces IN clause for multiple formats (OR within)', () => {
      const filters: FilterCriteria = { format: ['virtual', 'hybrid'] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('format IN (?, ?)');
      expect(result.bindValues).toEqual(['virtual', 'hybrid']);
    });

    it('produces no clause for empty format array', () => {
      const filters: FilterCriteria = { format: [] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(0);
      expect(result.bindValues).toHaveLength(0);
    });
  });

  describe('tags filter', () => {
    it('produces LIKE clause for single tag (OR within)', () => {
      const filters: FilterCriteria = { tags: ['ai'] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('(tags LIKE ?)');
      expect(result.bindValues).toEqual(['%"ai"%']);
    });

    it('produces OR-joined LIKE clauses for multiple tags', () => {
      const filters: FilterCriteria = { tags: ['ai', 'web3'] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('(tags LIKE ? OR tags LIKE ?)');
      expect(result.bindValues).toEqual(['%"ai"%', '%"web3"%']);
    });

    it('produces no clause for empty tags array', () => {
      const filters: FilterCriteria = { tags: [] };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(0);
      expect(result.bindValues).toHaveLength(0);
    });
  });

  describe('AND composition across filter types', () => {
    it('combines date range + format + tags with AND', () => {
      const filters: FilterCriteria = {
        dateRange: { start: '2025-01-01', end: '2025-12-31' },
        format: ['virtual', 'in_person'],
        tags: ['blockchain', 'defi'],
      };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(3);
      expect(result.whereClauses[0]).toBe('start_date >= ? AND start_date <= ?');
      expect(result.whereClauses[1]).toBe('format IN (?, ?)');
      expect(result.whereClauses[2]).toBe('(tags LIKE ? OR tags LIKE ?)');
      expect(result.bindValues).toEqual([
        '2025-01-01',
        '2025-12-31',
        'virtual',
        'in_person',
        '%"blockchain"%',
        '%"defi"%',
      ]);
    });

    it('combines only active filters (skips undefined/empty)', () => {
      const filters: FilterCriteria = {
        format: ['hybrid'],
        tags: [],
      };
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(1);
      expect(result.whereClauses[0]).toBe('format IN (?)');
      expect(result.bindValues).toEqual(['hybrid']);
    });
  });

  describe('empty filters', () => {
    it('returns empty clauses and values when no filters provided', () => {
      const filters: FilterCriteria = {};
      const result = buildFilterClauses(filters);

      expect(result.whereClauses).toHaveLength(0);
      expect(result.bindValues).toHaveLength(0);
    });
  });
});

describe('composeWhereClause', () => {
  it('returns empty string for no clauses', () => {
    expect(composeWhereClause({ whereClauses: [], bindValues: [] })).toBe('');
  });

  it('wraps single clause in parens', () => {
    const result = composeWhereClause({
      whereClauses: ['format IN (?)'],
      bindValues: ['virtual'],
    });
    expect(result).toBe('(format IN (?))');
  });

  it('joins multiple clauses with AND', () => {
    const result = composeWhereClause({
      whereClauses: ['start_date >= ? AND start_date <= ?', 'format IN (?)'],
      bindValues: ['2025-01-01', '2025-12-31', 'virtual'],
    });
    expect(result).toBe('(start_date >= ? AND start_date <= ?) AND (format IN (?))');
  });
});
