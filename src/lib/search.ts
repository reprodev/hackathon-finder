/**
 * FTS5 search engine for the Hackathon Discovery Platform.
 * Uses D1's FTS5 virtual table with BM25 ranking for full-text search.
 *
 * BM25 column weights correspond to FTS5 table column order:
 *   title (10.0), description (1.0), tags (5.0)
 *
 * Requirements satisfied: 2.1, 2.2, 2.3
 */

import type {
  FilterCriteria,
  PaginationParams,
  SearchResult,
  HackathonSummary,
} from './types';

/** Maximum allowed search query length */
export const MAX_QUERY_LENGTH = 200;

/** Minimum query length to trigger FTS search */
export const MIN_QUERY_LENGTH = 2;

/** Default page size for results */
export const DEFAULT_PAGE_SIZE = 12;

/**
 * Custom error thrown when the search query exceeds the maximum allowed length.
 */
export class SearchQueryTooLongError extends Error {
  constructor(length: number) {
    super(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters (got ${length})`);
    this.name = 'SearchQueryTooLongError';
  }
}

/**
 * Sanitize an FTS5 query string to prevent syntax errors.
 * Escapes special FTS5 characters and wraps tokens with wildcards for prefix matching.
 */
export function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special operators that could cause syntax errors
  const cleaned = query
    .replace(/['"]/g, '') // remove quotes
    .replace(/[(){}[\]]/g, '') // remove brackets
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '') // remove boolean operators
    .replace(/[*^]/g, '') // remove wildcards/boost
    .trim();

  if (!cleaned) {
    return '';
  }

  // Split into tokens and wrap each with double quotes for exact phrase per token
  // Append * for prefix matching
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  return tokens.map((token) => `"${token}"*`).join(' ');
}

/**
 * Build WHERE clause fragments for filter criteria.
 * Returns an array of SQL condition strings and their bound parameters.
 */
export function buildFilterConditions(filters?: FilterCriteria): {
  conditions: string[];
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!filters) {
    return { conditions, params };
  }

  if (filters.format && filters.format.length > 0) {
    const placeholders = filters.format.map(() => '?').join(', ');
    conditions.push(`h.format IN (${placeholders})`);
    params.push(...filters.format);
  }

  if (filters.dateRange?.start) {
    conditions.push('h.start_date >= ?');
    params.push(filters.dateRange.start);
  }

  if (filters.dateRange?.end) {
    conditions.push('h.start_date <= ?');
    params.push(filters.dateRange.end);
  }

  if (filters.tags && filters.tags.length > 0) {
    // OR within tags: match any of the specified tags
    const tagConditions = filters.tags.map(() =>
      `EXISTS (SELECT 1 FROM json_each(h.tags) WHERE json_each.value = ?)`
    );
    conditions.push(`(${tagConditions.join(' OR ')})`);
    params.push(...filters.tags);
  }

  return { conditions, params };
}

/**
 * Map a raw database row to a HackathonSummary.
 * Truncates title to 80 chars with ellipsis, limits tags to 3.
 */
export function mapRowToSummary(row: Record<string, unknown>): HackathonSummary {
  const title = String(row.title ?? '');
  const rawTags = row.tags ? JSON.parse(String(row.tags)) as string[] : [];

  return {
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    title: title.length > 80 ? title.slice(0, 80) + '\u2026' : title,
    startDate: String(row.start_date ?? ''),
    endDate: row.end_date ? String(row.end_date) : null,
    format: String(row.format ?? 'virtual') as HackathonSummary['format'],
    tags: rawTags.slice(0, 3),
    organizer: row.organizer ? String(row.organizer) : null,
  };
}

/** Sort options for hackathon listing */
export type SortOption = 'newest' | 'ending_soon' | 'prize_desc';

/**
 * Search hackathons using D1 FTS5 with BM25 ranking.
 *
 * Behavior:
 * - Query empty or < 2 chars: returns all hackathons (no FTS filtering), applies filters if present
 * - Query > 200 chars: throws SearchQueryTooLongError
 * - Otherwise: uses FTS5 MATCH with BM25 ranking (title=10, description=1, tags=5)
 *
 * @param db - D1Database instance
 * @param query - Search query string
 * @param filters - Optional filter criteria (format, tags, dateRange)
 * @param pagination - Optional pagination parameters (page, pageSize)
 * @param sort - Optional sort option (newest, ending_soon, prize_desc)
 * @returns SearchResult with paginated hackathons, total count, and hasMore flag
 */
export async function searchHackathons(
  db: D1Database,
  query: string,
  filters?: FilterCriteria,
  pagination?: PaginationParams,
  sort?: SortOption
): Promise<SearchResult> {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  // Validate query length
  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchQueryTooLongError(query.length);
  }

  const { conditions: filterConditions, params: filterParams } = buildFilterConditions(filters);

  // Determine if we should use FTS5 search or return all results
  const useSearch = query.length >= MIN_QUERY_LENGTH;

  if (useSearch) {
    return searchWithFts(db, query, filterConditions, filterParams, page, pageSize, offset, sort);
  } else {
    return searchWithoutFts(db, filterConditions, filterParams, page, pageSize, offset, sort);
  }
}

/**
 * Get the ORDER BY clause based on sort option.
 * For FTS queries, default is BM25 rank. For non-FTS, default is start_date DESC.
 */
function getOrderByClause(sort: SortOption | undefined, isFts: boolean): string {
  switch (sort) {
    case 'ending_soon':
      return 'ORDER BY CASE WHEN h.end_date IS NULL THEN 1 ELSE 0 END, h.end_date ASC';
    case 'prize_desc':
      return 'ORDER BY CASE WHEN h.prizes IS NULL THEN 1 ELSE 0 END, h.prizes DESC';
    case 'newest':
      return 'ORDER BY h.start_date DESC';
    default:
      return isFts ? 'ORDER BY rank' : 'ORDER BY h.start_date DESC';
  }
}

/**
 * Execute an FTS5 search query with BM25 ranking.
 */
async function searchWithFts(
  db: D1Database,
  query: string,
  filterConditions: string[],
  filterParams: unknown[],
  page: number,
  pageSize: number,
  offset: number,
  sort?: SortOption
): Promise<SearchResult> {
  const sanitized = sanitizeFtsQuery(query);

  // If sanitization leaves nothing, fall back to unfiltered
  if (!sanitized) {
    return searchWithoutFts(db, filterConditions, filterParams, page, pageSize, offset, sort);
  }

  // Build WHERE clause for filters
  const filterWhere = filterConditions.length > 0
    ? ' AND ' + filterConditions.join(' AND ')
    : '';

  // Count query
  const countSql = `
    SELECT COUNT(*) as total
    FROM hackathon_fts fts
    JOIN hackathons h ON h.rowid = fts.rowid
    WHERE hackathon_fts MATCH ?${filterWhere}
  `;

  const countParams = [sanitized, ...filterParams];
  const countResult = await db.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  // Data query with BM25 ranking
  // BM25 weights: title=10.0, description=1.0, tags=5.0
  const orderBy = getOrderByClause(sort, true);
  const dataSql = `
    SELECT h.*, bm25(hackathon_fts, 10.0, 1.0, 5.0) AS rank
    FROM hackathon_fts fts
    JOIN hackathons h ON h.rowid = fts.rowid
    WHERE hackathon_fts MATCH ?${filterWhere}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const dataParams = [sanitized, ...filterParams, pageSize, offset];
  const dataResult = await db.prepare(dataSql).bind(...dataParams).all();
  const rows = dataResult.results ?? [];

  const hackathons = rows.map(mapRowToSummary);

  return {
    hackathons,
    total,
    page,
    pageSize,
    hasMore: offset + hackathons.length < total,
  };
}

/**
 * Return all hackathons without FTS search (for empty/short queries).
 * Still applies filters and pagination.
 */
async function searchWithoutFts(
  db: D1Database,
  filterConditions: string[],
  filterParams: unknown[],
  page: number,
  pageSize: number,
  offset: number,
  sort?: SortOption
): Promise<SearchResult> {
  const whereClause = filterConditions.length > 0
    ? 'WHERE ' + filterConditions.join(' AND ')
    : '';

  // Count query
  const countSql = `SELECT COUNT(*) as total FROM hackathons h ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...filterParams).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  // Data query with configurable sort order
  const orderBy = getOrderByClause(sort, false);
  const dataSql = `
    SELECT h.*
    FROM hackathons h
    ${whereClause}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const dataParams = [...filterParams, pageSize, offset];
  const dataResult = await db.prepare(dataSql).bind(...dataParams).all();
  const rows = dataResult.results ?? [];

  const hackathons = rows.map(mapRowToSummary);

  return {
    hackathons,
    total,
    page,
    pageSize,
    hasMore: offset + hackathons.length < total,
  };
}
