/**
 * Shared TypeScript types and interfaces for the Hackathon Discovery Platform.
 * These types define API response shapes, filter criteria, pagination, and search results.
 */

/** Hackathon format type */
export type Format = 'virtual' | 'in_person' | 'hybrid';

/** Summary representation of a hackathon for listing/card display */
export interface HackathonSummary {
  id: string;
  slug: string;
  /** Truncated to 80 characters for card display */
  title: string;
  /** ISO 8601 date string */
  startDate: string;
  /** ISO 8601 date string or null */
  endDate: string | null;
  format: Format;
  /** Maximum 3 primary tags for card display */
  tags: string[];
  organizer: string | null;
}

/** Full hackathon detail data */
export interface HackathonDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** ISO 8601 date string */
  startDate: string;
  /** ISO 8601 date string or null */
  endDate: string | null;
  location: string | null;
  format: Format;
  organizer: string | null;
  prizes: string | null;
  tags: string[];
  sourceUrl: string;
  sources: string[];
  /** ISO 8601 date string */
  updatedAt: string;
}

/** Response shape for GET /api/hackathons */
export interface HackathonListResponse {
  data: HackathonSummary[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
}

/** Response shape for GET /api/hackathons/[id] */
export interface HackathonDetailResponse {
  data: HackathonDetail;
}

/** Filter criteria for hackathon queries */
export interface FilterCriteria {
  dateRange?: { start: string; end: string };
  format?: Format[];
  tags?: string[];
}

/** Pagination parameters for list queries */
export interface PaginationParams {
  page: number;
  /** Default: 12 */
  pageSize: number;
}

/** Search result returned by the search engine */
export interface SearchResult {
  hackathons: HackathonSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** API error response shape */
export interface ErrorResponse {
  error: string;
  details?: string[];
}

/** Validation result for data normalizer */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
