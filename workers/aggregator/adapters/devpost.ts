/**
 * Devpost source adapter for the hackathon aggregation worker.
 *
 * Fetches hackathon listings from Devpost's structured API endpoint
 * and maps them to the unified RawHackathonEvent schema.
 */

import type { EventSourceAdapter, RawHackathonEvent } from './interface';

/** Shape of a single hackathon entry in the Devpost API response. */
interface DevpostHackathon {
  id?: number;
  title?: string;
  tagline?: string;
  open_state?: string;
  thumbnail_url?: string;
  url?: string;
  submission_period_dates?: string;
  themes?: { name: string }[];
  prize_amount?: string;
  registrations_count?: number;
  organization_name?: string;
  time_left_to_submission?: string;
  displayed_location?: {
    icon?: string;
    location?: string;
  };
}

/** Shape of the Devpost API list response. */
interface DevpostApiResponse {
  hackathons?: DevpostHackathon[];
  meta?: {
    total_count?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
}

/** Base URL for the Devpost hackathon API. */
const DEVPOST_API_BASE = 'https://devpost.com/api/hackathons';

/** Maximum number of pages to fetch in a single run. */
const MAX_PAGES = 5;

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Parses a Devpost submission period date string into ISO 8601 start/end dates.
 *
 * Devpost uses formats like:
 *  - "Jun 15 - Jul 30, 2024"
 *  - "Jun 15, 2024 - Jul 30, 2024"
 *  - "Ends Jul 30, 2024"
 *
 * Returns best-effort parsing; returns null for unparseable values.
 */
function parseSubmissionDates(dateStr: string | undefined): { startDate: string | null; endDate: string | null } {
  if (!dateStr) {
    return { startDate: null, endDate: null };
  }

  try {
    // Remove "Ends " prefix if present
    const cleaned = dateStr.replace(/^Ends\s+/i, '');

    // Try splitting on " - " to separate start and end
    const parts = cleaned.split(/\s*-\s*/);

    if (parts.length === 2) {
      const startRaw = parts[0].trim();
      const endRaw = parts[1].trim();

      // If start doesn't have a year, borrow from end
      const endDate = new Date(endRaw);
      let startDate: Date;

      if (/\d{4}/.test(startRaw)) {
        startDate = new Date(startRaw);
      } else {
        // Append the year from end date
        const year = endDate.getFullYear();
        startDate = new Date(`${startRaw}, ${year}`);
      }

      const startIso = isNaN(startDate.getTime()) ? null : startDate.toISOString();
      const endIso = isNaN(endDate.getTime()) ? null : endDate.toISOString();

      return { startDate: startIso, endDate: endIso };
    }

    // Single date (e.g., just an end date from "Ends ...")
    const singleDate = new Date(cleaned);
    if (!isNaN(singleDate.getTime())) {
      return { startDate: singleDate.toISOString(), endDate: null };
    }
  } catch {
    // Fall through to default
  }

  return { startDate: null, endDate: null };
}

/**
 * Extracts tags from Devpost theme objects.
 */
function extractTags(themes: { name: string }[] | undefined): string[] {
  if (!themes || !Array.isArray(themes)) {
    return [];
  }
  return themes
    .filter((t) => t && typeof t.name === 'string' && t.name.trim().length > 0)
    .map((t) => t.name.trim());
}

/**
 * Determines the location string from Devpost's displayed_location field.
 */
function extractLocation(displayed: DevpostHackathon['displayed_location']): string | undefined {
  if (!displayed || !displayed.location) {
    return undefined;
  }
  return displayed.location;
}

/**
 * Maps a single Devpost hackathon entry to a RawHackathonEvent.
 * Returns null if required fields are missing.
 */
function mapToRawEvent(hackathon: DevpostHackathon): RawHackathonEvent | null {
  const title = hackathon.title?.trim();
  if (!title) {
    return null;
  }

  const url = hackathon.url?.trim();
  if (!url) {
    return null;
  }

  const { startDate, endDate } = parseSubmissionDates(hackathon.submission_period_dates);
  if (!startDate) {
    // startDate is required per the interface
    return null;
  }

  return {
    title,
    description: hackathon.tagline?.trim() || undefined,
    startDate,
    endDate: endDate || undefined,
    location: extractLocation(hackathon.displayed_location),
    organizer: hackathon.organization_name?.trim() || undefined,
    prizes: hackathon.prize_amount?.trim() || undefined,
    tags: extractTags(hackathon.themes),
    url,
    source: 'devpost',
  };
}

/**
 * Devpost source adapter.
 *
 * Fetches open hackathon listings from Devpost's internal API endpoint.
 * Uses pagination to collect multiple pages of results.
 */
export class DevpostAdapter implements EventSourceAdapter {
  readonly name = 'Devpost';
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Fetch hackathon events from Devpost's API.
   * Paginates through available pages up to MAX_PAGES.
   * Skips individual entries that cannot be parsed.
   */
  async fetch(): Promise<RawHackathonEvent[]> {
    if (!this.enabled) {
      return [];
    }

    const allEvents: RawHackathonEvent[] = [];
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      const url = `${DEVPOST_API_BASE}?status=open&page=${currentPage}`;

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        // If the first page fails, throw so the aggregator logs it.
        // If a later page fails, return what we've collected so far.
        if (currentPage === 1) {
          throw new Error(
            `Devpost API returned ${response.status} ${response.statusText}`
          );
        }
        break;
      }

      let data: DevpostApiResponse;
      try {
        data = (await response.json()) as DevpostApiResponse;
      } catch {
        if (currentPage === 1) {
          throw new Error('Devpost API returned invalid JSON');
        }
        break;
      }

      const hackathons = data.hackathons;
      if (!hackathons || !Array.isArray(hackathons) || hackathons.length === 0) {
        break;
      }

      for (const hackathon of hackathons) {
        try {
          const event = mapToRawEvent(hackathon);
          if (event) {
            allEvents.push(event);
          }
        } catch {
          // Skip malformed entries
          continue;
        }
      }

      // Check if there are more pages
      const totalPages = data.meta?.total_pages ?? 1;
      if (currentPage >= totalPages) {
        break;
      }

      currentPage++;
    }

    return allEvents;
  }

  /**
   * Simple connectivity check — verifies that Devpost's API responds
   * successfully to a minimal request.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${DEVPOST_API_BASE}?status=open&page=1`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Perform a fetch with an AbortController timeout.
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HackathonDiscoveryPlatform/1.0',
        },
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
