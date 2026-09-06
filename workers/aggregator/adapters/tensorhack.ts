/**
 * TensorHack source adapter for the hackathon aggregation worker.
 *
 * Fetches hackathon listings from TensorHack's JSON API endpoint
 * (https://tensorhack.com/api/hackathons) and maps them to the unified
 * RawHackathonEvent schema.
 *
 * TensorHack is an AI-focused hackathon aggregator that indexes 200+
 * open hackathons with source-verified prize data and live deadlines.
 * Their API returns a flat JSON array — no pagination required.
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Shape of a single hackathon entry in the TensorHack API response. */
interface TensorHackEntry {
  id?: string;
  name?: string;
  org?: string;
  blurb?: string;
  /** Prize amount in USD (0 means TBA / not listed) */
  prize?: number;
  /** Deadline / end date in ISO 8601 format (YYYY-MM-DD or full ISO string) */
  deadline?: string;
  /** "ONLINE" | "IN-PERSON" */
  mode?: string;
  /** Location string, e.g. "GLOBAL", "INDIA", city name */
  location?: string;
  /** Array of uppercase tag strings, e.g. ["MLH","STUDENT","REMOTE"] */
  tags?: string[];
  /** Canonical URL to the original hackathon page */
  url?: string;
  last_verified?: string;
}

/** TensorHack API endpoint that returns all open hackathons. */
const TENSORHACK_API_URL = 'https://tensorhack.com/api/hackathons';

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Normalise a TensorHack location string into a human-readable value.
 *
 * TensorHack stores locations as uppercase strings like "GLOBAL", "INDIA",
 * or specific city names. We convert known sentinel values to friendlier
 * labels and leave everything else as-is (but in title-case).
 */
function normaliseLocation(mode: string | undefined, location: string | undefined): string | undefined {
  if (!location) return undefined;

  const upper = location.trim().toUpperCase();

  // Prefer mode signal for "Online" label
  if (upper === 'GLOBAL' || mode?.toUpperCase() === 'ONLINE') {
    return 'Online';
  }

  if (upper === 'INDIA') {
    return 'India';
  }

  // Return the raw location string for specific city/venue names
  return location.trim();
}

/**
 * Convert a TensorHack prize amount (USD integer) to a display string.
 * Returns undefined when prize is 0 or absent (means "TBA" or not listed).
 */
function normalisePrize(prize: number | undefined): string | undefined {
  if (!prize || prize <= 0) return undefined;
  return `$${prize.toLocaleString('en-US')}`;
}

/**
 * Normalise the deadline field to a full ISO 8601 datetime string.
 *
 * TensorHack stores deadlines as "YYYY-MM-DD" date-only strings.
 * We convert to end-of-day UTC so downstream consumers treat it as a
 * deadline rather than a start-of-day timestamp.
 */
function normaliseDeadline(deadline: string | undefined): string | null {
  if (!deadline) return null;

  const trimmed = deadline.trim();

  // Already a full ISO string — validate and return
  if (trimmed.includes('T')) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Date-only string "YYYY-MM-DD" — treat as end-of-day UTC
  const dateOnly = new Date(`${trimmed}T23:59:59.000Z`);
  return isNaN(dateOnly.getTime()) ? null : dateOnly.toISOString();
}

/**
 * Derive a normalised tag array from the TensorHack tags field.
 *
 * TensorHack tags are uppercase strings like "MACHINE LEARNING/AI",
 * "MLH", "BEGINNER FRIENDLY", etc. We lower-case and slugify them,
 * and always include the 'tensorhack' source tag plus 'ai' where
 * the event is AI-related.
 */
function normaliseTags(rawTags: string[] | undefined): string[] {
  const base: string[] = ['tensorhack'];

  if (!rawTags || !Array.isArray(rawTags)) return base;

  for (const tag of rawTags) {
    if (typeof tag !== 'string') continue;

    const cleaned = tag.trim().toLowerCase()
      // "machine learning/ai" → "machine-learning-ai"
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (cleaned && !base.includes(cleaned)) {
      base.push(cleaned);
    }
  }

  // Ensure 'ai' tag is present for AI-related events
  const isAiRelated = rawTags.some((t) =>
    /machine.learning|ai\b|artificial.intelligence/i.test(t)
  );
  if (isAiRelated && !base.includes('ai')) {
    base.push('ai');
  }

  return base;
}

/**
 * Map a single TensorHack API entry to a RawHackathonEvent.
 * Returns null if required fields are missing or unparseable.
 */
function mapToRawEvent(entry: TensorHackEntry): RawHackathonEvent | null {
  const title = entry.name?.trim();
  if (!title) return null;

  const url = entry.url?.trim();
  if (!url) return null;

  // TensorHack treats the deadline as the primary/end date.
  // We use it as both startDate (best approximation) and endDate.
  const endDate = normaliseDeadline(entry.deadline);
  if (!endDate) return null;

  return {
    title,
    description: entry.blurb?.trim() || undefined,
    // deadline is the closest we have to a single date — use as startDate
    startDate: endDate,
    endDate,
    location: normaliseLocation(entry.mode, entry.location),
    organizer: entry.org?.trim() || undefined,
    prizes: normalisePrize(entry.prize),
    tags: normaliseTags(entry.tags),
    url,
    source: 'tensorhack',
  };
}

/**
 * Perform a fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'HackathonDiscoveryPlatform/1.0 (aggregator)',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * TensorHack source adapter.
 *
 * Fetches all open hackathons from TensorHack's JSON API in a single
 * request (no pagination). TensorHack specialises in AI hackathons and
 * provides source-verified prize data and live submission deadlines.
 */
export class TensorHackAdapter implements EventSourceAdapter {
  readonly name = 'TensorHack';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from TensorHack's API.
   *
   * The API returns a flat JSON array of all open hackathons.
   * Individual entries that cannot be parsed are silently skipped.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    const response = await fetchWithTimeout(TENSORHACK_API_URL, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(
        `TensorHack API returned ${response.status} ${response.statusText}`
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('TensorHack API returned invalid JSON');
    }

    if (!Array.isArray(data)) {
      throw new Error('TensorHack API response is not a JSON array');
    }

    const events: RawHackathonEvent[] = [];

    for (const entry of data as TensorHackEntry[]) {
      try {
        const event = mapToRawEvent(entry);
        if (event) {
          events.push(event);
        }
      } catch {
        // Skip malformed entries without surfacing noise
        continue;
      }
    }

    return events;
  }

  /**
   * Check whether the TensorHack API is reachable and responding with
   * a non-empty JSON array.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(TENSORHACK_API_URL, REQUEST_TIMEOUT_MS);
      if (!response.ok) return false;

      const data = await response.json();
      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  }
}
