/**
 * GET /api/hackathons
 *
 * List and search hackathons with filtering and pagination.
 *
 * Query params:
 *   q         - Search query string (2-200 chars for FTS, <2 returns all)
 *   page      - Page number (>= 1, default 1)
 *   pageSize  - Results per page (1-50, default 12)
 *   format    - Comma-separated formats: virtual, in_person, hybrid
 *   tags      - Comma-separated tag strings
 *   dateStart - ISO 8601 date string for range start
 *   dateEnd   - ISO 8601 date string for range end
 *
 * Returns: HackathonListResponse JSON
 *
 * Requirements satisfied: 2.1, 2.2, 3.2, 3.3, 4.4
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { FilterCriteria, PaginationParams, HackathonListResponse, Format } from '../../../lib/types';
import { searchHackathons, SearchQueryTooLongError, MAX_QUERY_LENGTH } from '../../../lib/search';
import { validateDateRange } from '../../../lib/filters';

/** Valid format values */
const VALID_FORMATS: Set<string> = new Set(['virtual', 'in_person', 'hybrid']);

export const GET: APIRoute = async ({ request }) => {
  const db = env.DB as D1Database;
  const url = new URL(request.url);

  // --- Parse and validate query parameters ---

  const query = url.searchParams.get('q') ?? '';
  const pageRaw = url.searchParams.get('page');
  const pageSizeRaw = url.searchParams.get('pageSize');
  const formatRaw = url.searchParams.get('format');
  const tagsRaw = url.searchParams.get('tags');
  const dateStart = url.searchParams.get('dateStart');
  const dateEnd = url.searchParams.get('dateEnd');

  const errors: string[] = [];

  // Validate query length
  if (query.length > MAX_QUERY_LENGTH) {
    errors.push(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
  }

  // Parse and validate page
  let page = 1;
  if (pageRaw !== null) {
    page = parseInt(pageRaw, 10);
    if (isNaN(page) || page < 1) {
      errors.push('page must be an integer >= 1');
    }
  }

  // Parse and validate pageSize
  let pageSize = 12;
  if (pageSizeRaw !== null) {
    pageSize = parseInt(pageSizeRaw, 10);
    if (isNaN(pageSize) || pageSize < 1 || pageSize > 50) {
      errors.push('pageSize must be an integer between 1 and 50');
    }
  }

  // Parse and validate format filter
  let formats: Format[] | undefined;
  if (formatRaw) {
    const formatValues = formatRaw.split(',').map((f) => f.trim()).filter(Boolean);
    const invalidFormats = formatValues.filter((f) => !VALID_FORMATS.has(f));
    if (invalidFormats.length > 0) {
      errors.push(`Invalid format values: ${invalidFormats.join(', ')}. Valid values: virtual, in_person, hybrid`);
    } else {
      formats = formatValues as Format[];
    }
  }

  // Parse tags
  let tags: string[] | undefined;
  if (tagsRaw) {
    tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) {
      tags = undefined;
    }
  }

  // Validate date range
  let dateRange: { start: string; end: string } | undefined;
  if (dateStart || dateEnd) {
    if (dateStart && dateEnd) {
      const validation = validateDateRange(dateStart, dateEnd);
      if (!validation.valid) {
        errors.push(validation.error ?? 'Invalid date range');
      } else {
        dateRange = { start: dateStart, end: dateEnd };
      }
    } else if (dateStart && !dateEnd) {
      // Only start provided — validate it's a valid date
      if (isNaN(new Date(dateStart).getTime())) {
        errors.push('Invalid dateStart format');
      } else {
        // Use a far-future sentinel for the end
        dateRange = { start: dateStart, end: '2099-12-31' };
      }
    } else if (!dateStart && dateEnd) {
      // Only end provided — validate it's a valid date
      if (isNaN(new Date(dateEnd).getTime())) {
        errors.push('Invalid dateEnd format');
      } else {
        // Use a far-past sentinel for the start
        dateRange = { start: '1970-01-01', end: dateEnd };
      }
    }
  }

  // Return 400 if any validation errors
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: 'Invalid parameters', details: errors }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // --- Build filter criteria ---

  const filters: FilterCriteria | undefined =
    (formats || tags || dateRange)
      ? {
          ...(formats && { format: formats }),
          ...(tags && { tags }),
          ...(dateRange && { dateRange }),
        }
      : undefined;

  const pagination: PaginationParams = { page, pageSize };

  // --- Execute search ---

  try {
    const result = await searchHackathons(db, query, filters, pagination);

    const response: HackathonListResponse = {
      data: result.hackathons,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Handle SearchQueryTooLongError as 400
    if (error instanceof SearchQueryTooLongError) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // D1 or other errors → 503
    return new Response(
      JSON.stringify({ error: 'Service temporarily unavailable. Please try again later.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
