/**
 * Deduplication engine for the hackathon aggregation worker.
 *
 * Implements finding duplicates by title (case-insensitive) + start_date,
 * and merging records from different sources while preserving the richest data.
 */

import type { Format } from '../../src/lib/types';

/**
 * Normalized hackathon data from the normalizer step.
 * This type matches what the DataNormalizer produces.
 */
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

/**
 * Existing hackathon record from the D1 database (row shape).
 */
export interface ExistingHackathon {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  location: string | null;
  format: Format;
  organizer: string | null;
  prizes: string | null;
  sourceUrl: string;
  sources: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

/**
 * Merged hackathon data ready for upsert back into D1.
 */
export interface MergedHackathon {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  location: string | null;
  format: Format;
  organizer: string | null;
  prizes: string | null;
  sourceUrl: string;
  sources: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

/**
 * Format precedence ordering: in_person > hybrid > virtual.
 * Higher index = higher precedence.
 */
const FORMAT_PRECEDENCE: Record<Format, number> = {
  virtual: 0,
  hybrid: 1,
  in_person: 2,
};

/**
 * Deduplication engine interface.
 */
export interface DeduplicationEngine {
  findDuplicate(
    event: NormalizedHackathon,
    db: D1Database
  ): Promise<ExistingHackathon | null>;

  merge(
    existing: ExistingHackathon,
    incoming: NormalizedHackathon
  ): MergedHackathon;
}

/**
 * Find a duplicate hackathon in D1 by matching title (case-insensitive) and start_date.
 *
 * @param event - The normalized hackathon to look up
 * @param db - The D1Database binding
 * @returns The existing record if found, or null
 */
export async function findDuplicate(
  event: NormalizedHackathon,
  db: D1Database
): Promise<ExistingHackathon | null> {
  const result = await db
    .prepare(
      `SELECT * FROM hackathons WHERE LOWER(title) = LOWER(?) AND start_date = ? LIMIT 1`
    )
    .bind(event.title, event.startDate)
    .first<Record<string, unknown>>();

  if (!result) {
    return null;
  }

  return {
    id: result.id as string,
    slug: result.slug as string,
    title: result.title as string,
    description: (result.description as string) ?? null,
    startDate: result.start_date as string,
    endDate: (result.end_date as string) ?? null,
    location: (result.location as string) ?? null,
    format: result.format as Format,
    organizer: (result.organizer as string) ?? null,
    prizes: (result.prizes as string) ?? null,
    sourceUrl: result.source_url as string,
    sources: JSON.parse((result.sources as string) || '[]'),
    tags: JSON.parse((result.tags as string) || '[]'),
    createdAt: result.created_at as string,
    updatedAt: result.updated_at as string,
    lastSeenAt: result.last_seen_at as string,
  };
}

/**
 * Merge an existing hackathon record with an incoming normalized event.
 *
 * Merge strategy:
 * - sources: Union of both source names
 * - description: Keep the longer of the two
 * - tags: Union of both tag sets (deduplicated, max 20)
 * - prizes: Keep whichever is non-null, prefer longer text
 * - organizer: Keep whichever is non-null (prefer existing if both present)
 * - endDate: Keep whichever is non-null (prefer existing if both present)
 * - location: Keep whichever is non-null (prefer existing if both present)
 * - format: Prefer higher precedence (in_person > hybrid > virtual)
 *
 * @param existing - The current record from D1
 * @param incoming - The new normalized event from a source adapter
 * @returns The merged result ready for upsert
 */
export function merge(
  existing: ExistingHackathon,
  incoming: NormalizedHackathon
): MergedHackathon {
  const now = new Date().toISOString();

  // Merge sources: union of source names
  const mergedSources = Array.from(
    new Set([...existing.sources, incoming.sourceName])
  );

  // Merge description: keep the longer one
  const mergedDescription = pickLongerText(
    existing.description,
    incoming.description
  );

  // Merge tags: union of both sets, deduplicated, max 20
  const mergedTags = mergeTags(existing.tags, incoming.tags);

  // Merge prizes: keep non-null, prefer longer
  const mergedPrizes = pickLongerText(existing.prizes, incoming.prizes);

  // Merge organizer: keep whichever is non-null (prefer existing)
  const mergedOrganizer = existing.organizer ?? incoming.organizer;

  // Merge endDate: keep whichever is non-null (prefer existing)
  const mergedEndDate = existing.endDate ?? incoming.endDate;

  // Merge location: keep whichever is non-null (prefer existing)
  const mergedLocation = existing.location ?? incoming.location;

  // Merge format: prefer higher precedence
  const mergedFormat = pickHigherPrecedenceFormat(
    existing.format,
    incoming.format
  );

  return {
    id: existing.id,
    slug: existing.slug,
    title: existing.title,
    description: mergedDescription,
    startDate: existing.startDate,
    endDate: mergedEndDate,
    location: mergedLocation,
    format: mergedFormat,
    organizer: mergedOrganizer,
    prizes: mergedPrizes,
    sourceUrl: existing.sourceUrl,
    sources: mergedSources,
    tags: mergedTags,
    createdAt: existing.createdAt,
    updatedAt: now,
    lastSeenAt: now,
  };
}

/**
 * Pick the longer of two nullable text values.
 * Returns null only if both are null.
 */
export function pickLongerText(
  a: string | null,
  b: string | null
): string | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return a.length >= b.length ? a : b;
}

/**
 * Merge two tag arrays into a deduplicated union, capped at 20 tags.
 * Tags are compared case-insensitively for deduplication.
 */
export function mergeTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of [...existing, ...incoming]) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(tag);
    }
    if (result.length >= 20) break;
  }

  return result;
}

/**
 * Pick the format with higher precedence.
 * Precedence: in_person > hybrid > virtual
 */
export function pickHigherPrecedenceFormat(a: Format, b: Format): Format {
  return FORMAT_PRECEDENCE[a] >= FORMAT_PRECEDENCE[b] ? a : b;
}

/**
 * Concrete deduplication engine that bundles findDuplicate and merge.
 */
export const deduplicationEngine: DeduplicationEngine = {
  findDuplicate,
  merge,
};
