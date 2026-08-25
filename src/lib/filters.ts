/**
 * Filter composition engine for hackathon queries.
 *
 * Produces SQL WHERE clause fragments with bind parameters.
 * Logic:
 *   - AND across filter types (date range, format, tags)
 *   - OR within each filter type (e.g., format IN ('virtual', 'hybrid'))
 *
 * Integrates with the search module by providing composable clause fragments.
 */

import type { FilterCriteria, Format } from './types';

/** Result of building filter clauses — ready to compose into a SQL query */
export interface FilterResult {
  /** Individual WHERE clause fragments (join with AND) */
  whereClauses: string[];
  /** Positional bind values corresponding to `?` placeholders in clauses */
  bindValues: (string | number)[];
}

/** Date range preset names */
export type DateRangePreset = 'upcoming' | 'this_week' | 'this_month';

/**
 * Validate a custom date range. Returns valid:true if start <= end.
 */
export function validateDateRange(start: string, end: string): { valid: boolean; error?: string } {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (isNaN(startDate.getTime())) {
    return { valid: false, error: 'Invalid start date format' };
  }
  if (isNaN(endDate.getTime())) {
    return { valid: false, error: 'Invalid end date format' };
  }
  if (startDate > endDate) {
    return { valid: false, error: 'Start date must not be after end date' };
  }

  return { valid: true };
}

/**
 * Compute a date range from a preset name.
 * All dates returned as ISO 8601 date strings (YYYY-MM-DD).
 */
export function getDateRangePreset(
  preset: DateRangePreset,
  now: Date = new Date()
): { start: string; end: string } {
  const toISO = (d: Date): string => d.toISOString().split('T')[0];

  switch (preset) {
    case 'upcoming': {
      // start_date > now (tomorrow onward, no fixed end — use far-future sentinel)
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return { start: toISO(tomorrow), end: '2099-12-31' };
    }
    case 'this_week': {
      // start_date within next 7 days (today through today+7)
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return { start: toISO(now), end: toISO(weekEnd) };
    }
    case 'this_month': {
      // start_date within next 30 days (today through today+30)
      const monthEnd = new Date(now);
      monthEnd.setDate(monthEnd.getDate() + 30);
      return { start: toISO(now), end: toISO(monthEnd) };
    }
  }
}

/**
 * Build SQL WHERE clause fragments from filter criteria.
 *
 * All filter types are AND-composed across types.
 * Within a filter type, values are OR-composed:
 *   - format: `format IN (?, ?, ...)`
 *   - tags: checks JSON array for any matching tag
 *   - dateRange: `start_date BETWEEN ? AND ?`
 */
export function buildFilterClauses(filters: FilterCriteria): FilterResult {
  const whereClauses: string[] = [];
  const bindValues: (string | number)[] = [];

  // Date range filter
  if (filters.dateRange) {
    const { start, end } = filters.dateRange;
    const validation = validateDateRange(start, end);
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid date range');
    }
    whereClauses.push('start_date >= ? AND start_date <= ?');
    bindValues.push(start, end);
  }

  // Format filter — OR within type using IN clause
  if (filters.format && filters.format.length > 0) {
    const placeholders = filters.format.map(() => '?').join(', ');
    whereClauses.push(`format IN (${placeholders})`);
    bindValues.push(...filters.format);
  }

  // Tags filter — OR within type
  // Since tags are stored as a JSON array string, use LIKE for each tag
  // and OR them together. Example: (tags LIKE '%"ai"%' OR tags LIKE '%"web3"%')
  if (filters.tags && filters.tags.length > 0) {
    const tagConditions = filters.tags.map(() => 'tags LIKE ?');
    whereClauses.push(`(${tagConditions.join(' OR ')})`);
    for (const tag of filters.tags) {
      // Match the tag as a JSON array element — surrounded by quotes
      bindValues.push(`%"${tag}"%`);
    }
  }

  return { whereClauses, bindValues };
}

/**
 * Combine a FilterResult into a single WHERE string.
 * If no clauses, returns an empty string (no WHERE needed).
 * Otherwise returns clauses joined with AND (without the leading WHERE keyword).
 */
export function composeWhereClause(result: FilterResult): string {
  if (result.whereClauses.length === 0) {
    return '';
  }
  return result.whereClauses.map((c) => `(${c})`).join(' AND ');
}
