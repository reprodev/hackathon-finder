/**
 * Data normalizer for the hackathon aggregation worker.
 *
 * Takes raw hackathon events from source adapters and produces
 * normalized, validated records conforming to the unified schema.
 */

import type { RawHackathonEvent } from './adapters/interface';

/**
 * Strip HTML tags from a string, preserving the text content.
 * Also normalizes whitespace and decodes common HTML entities.
 */
export function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')     // Remove HTML tags
    .replace(/&amp;/g, '&')      // Decode &amp;
    .replace(/&lt;/g, '<')       // Decode &lt;
    .replace(/&gt;/g, '>')       // Decode &gt;
    .replace(/&quot;/g, '"')     // Decode &quot;
    .replace(/&#39;/g, "'")      // Decode &#39;
    .replace(/&nbsp;/g, ' ')     // Decode &nbsp;
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim();
}

/** Maximum field length constraints */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_COUNT = 20;

/** Hackathon format type */
export type Format = 'virtual' | 'in_person' | 'hybrid';

/** Normalized hackathon data ready for storage */
export interface NormalizedHackathon {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  location: string | null;
  format: Format;
  organizer: string | null;
  prizes: string | null;
  tags: string[];
  sourceUrl: string;
  sourceName: string;
}

/** Validation result for a normalization attempt */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Keywords that indicate a virtual event format.
 * Checked case-insensitively against the location field.
 */
const VIRTUAL_KEYWORDS = ['online', 'virtual', 'remote'];

/**
 * Detect the hackathon format based on the location string.
 *
 * - null, undefined, empty, or virtual keywords → 'virtual'
 * - Contains "hybrid" → 'hybrid'
 * - Otherwise → 'in_person'
 */
export function detectFormat(location: string | undefined | null): Format {
  if (!location || !location.trim()) {
    return 'virtual';
  }

  const lower = location.toLowerCase().trim();

  // Check for exact virtual keywords
  if (VIRTUAL_KEYWORDS.some((keyword) => lower === keyword)) {
    return 'virtual';
  }

  // Check if location contains "hybrid"
  if (lower.includes('hybrid')) {
    return 'hybrid';
  }

  // Check if location contains a virtual keyword (e.g., "Online & In-Person")
  // but not alone — if it also contains physical indicators, treat as hybrid
  const hasVirtualIndicator = VIRTUAL_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (hasVirtualIndicator) {
    // If it has both a virtual keyword and other text, it's likely hybrid
    // e.g., "Online and San Francisco" or "Virtual + NYC"
    const stripped = VIRTUAL_KEYWORDS.reduce(
      (loc, kw) => loc.replace(new RegExp(kw, 'gi'), '').trim(),
      lower
    );
    // If there's still meaningful text after removing virtual keywords, it's hybrid
    if (stripped.replace(/[^a-z0-9]/g, '').length > 0) {
      return 'hybrid';
    }
    return 'virtual';
  }

  return 'in_person';
}

/**
 * Check whether a string is a valid ISO 8601 date/datetime.
 * Accepts formats like: 2024-01-15, 2024-01-15T10:00:00Z, 2024-01-15T10:00:00+05:00
 */
export function isValidISO8601(dateStr: string): boolean {
  if (!dateStr || !dateStr.trim()) {
    return false;
  }

  // Try parsing as a Date — must produce a valid timestamp
  const parsed = Date.parse(dateStr.trim());
  if (isNaN(parsed)) {
    return false;
  }

  // Basic ISO 8601 pattern check (YYYY-MM-DD with optional time portion)
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
  return iso8601Pattern.test(dateStr.trim());
}

/**
 * Normalize a raw hackathon event into the unified schema.
 *
 * - Trims and truncates title to 200 characters
 * - Truncates description to 5000 characters
 * - Limits tags to first 20 entries
 * - Detects format from location
 * - Maps source fields to normalized fields
 */
export function normalize(raw: RawHackathonEvent): NormalizedHackathon {
  // Trim, strip HTML, and truncate title
  const title = stripHtml(raw.title || '').substring(0, MAX_TITLE_LENGTH);

  // Strip HTML, trim, and truncate description
  const rawDesc = raw.description ? stripHtml(raw.description) : null;
  const description = rawDesc && rawDesc.length > 0 ? rawDesc.substring(0, MAX_DESCRIPTION_LENGTH) : null;

  // Trim startDate
  const startDate = (raw.startDate || '').trim();

  // Trim endDate, null if empty
  const rawEnd = raw.endDate?.trim() || null;
  const endDate = rawEnd || null;

  // Location: trim, null if empty
  const rawLocation = raw.location?.trim() || null;
  const location = rawLocation || null;

  // Detect format from location
  const format = detectFormat(raw.location);

  // Organizer: strip HTML, trim, null if empty
  const organizer = raw.organizer ? stripHtml(raw.organizer) || null : null;

  // Prizes: strip HTML, trim, null if empty
  const prizes = raw.prizes ? stripHtml(raw.prizes) || null : null;

  // Tags: filter empty, trim, limit to 20
  const tags = (raw.tags || [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, MAX_TAGS_COUNT);

  // Source URL: trim
  const sourceUrl = (raw.url || '').trim();

  // Source name: trim
  const sourceName = (raw.source || '').trim();

  return {
    title,
    description,
    startDate,
    endDate,
    location,
    format,
    organizer,
    prizes,
    tags,
    sourceUrl,
    sourceName,
  };
}

/**
 * Validate a normalized hackathon record.
 *
 * Checks:
 * - title is non-empty
 * - startDate is a valid ISO 8601 string
 * - sourceUrl is non-empty
 *
 * Returns a ValidationResult indicating whether the record is valid
 * and any validation errors encountered.
 */
export function validate(hackathon: NormalizedHackathon): ValidationResult {
  const errors: string[] = [];

  // Title must be non-empty after trimming
  if (!hackathon.title || !hackathon.title.trim()) {
    errors.push('title is required and must be non-empty');
  }

  // startDate must be a valid ISO 8601 string
  if (!hackathon.startDate || !hackathon.startDate.trim()) {
    errors.push('startDate is required and must be non-empty');
  } else if (!isValidISO8601(hackathon.startDate)) {
    errors.push('startDate must be a valid ISO 8601 date string');
  }

  // sourceUrl must be non-empty
  if (!hackathon.sourceUrl || !hackathon.sourceUrl.trim()) {
    errors.push('sourceUrl is required and must be non-empty');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_TAGS_COUNT };
