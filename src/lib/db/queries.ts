import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, desc, sql, gte, lte, inArray } from 'drizzle-orm';
import { hackathons, aggregationLogs, refreshMetadata } from './schema';
import type { FilterCriteria, PaginationParams, HackathonSummary, HackathonDetail } from '../types';

/**
 * Query options for paginated hackathon listing.
 */
export interface GetHackathonsOptions {
  pagination?: PaginationParams;
  filters?: FilterCriteria;
}

/**
 * Data shape for upserting a hackathon record.
 */
export interface UpsertHackathonData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  location: string | null;
  format: 'virtual' | 'in_person' | 'hybrid';
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
 * Data shape for updating refresh metadata.
 */
export interface UpdateRefreshMetadataData {
  lastRefreshAt: string;
  nextRefreshAt: string;
  intervalMinutes?: number;
  allSourcesFailed?: boolean;
}

/**
 * Get paginated hackathons with optional filters.
 * Returns HackathonSummary[] and total count.
 */
export async function getHackathons(
  db: D1Database,
  options?: GetHackathonsOptions
): Promise<{ hackathons: HackathonSummary[]; total: number }> {
  const orm = drizzle(db);
  const page = options?.pagination?.page ?? 1;
  const pageSize = options?.pagination?.pageSize ?? 12;
  const offset = (page - 1) * pageSize;
  const filters = options?.filters;

  // Build WHERE conditions
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters?.format && filters.format.length > 0) {
    conditions.push(inArray(hackathons.format, filters.format));
  }

  if (filters?.dateRange?.start) {
    conditions.push(gte(hackathons.startDate, filters.dateRange.start));
  }

  if (filters?.dateRange?.end) {
    conditions.push(lte(hackathons.startDate, filters.dateRange.end));
  }

  if (filters?.tags && filters.tags.length > 0) {
    // Tags are stored as a JSON array in a text column.
    // Use OR across individual tag checks with JSON_EACH or LIKE-based matching.
    const tagConditions = filters.tags.map((tag) =>
      sql`EXISTS (SELECT 1 FROM json_each(${hackathons.tags}) WHERE json_each.value = ${tag})`
    );
    conditions.push(or(...tagConditions)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await orm
    .select({ count: sql<number>`COUNT(*)` })
    .from(hackathons)
    .where(whereClause);

  const total = countResult[0]?.count ?? 0;

  // Get paginated results
  const rows = await orm
    .select({
      id: hackathons.id,
      slug: hackathons.slug,
      title: hackathons.title,
      startDate: hackathons.startDate,
      endDate: hackathons.endDate,
      format: hackathons.format,
      tags: hackathons.tags,
      organizer: hackathons.organizer,
    })
    .from(hackathons)
    .where(whereClause)
    .orderBy(desc(hackathons.startDate))
    .limit(pageSize)
    .offset(offset);

  // Map rows to HackathonSummary, parsing tags JSON and truncating title
  const summaries: HackathonSummary[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title.length > 80 ? row.title.slice(0, 80) + '…' : row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    format: row.format as HackathonSummary['format'],
    tags: (JSON.parse(row.tags) as string[]).slice(0, 3),
    organizer: row.organizer,
  }));

  return { hackathons: summaries, total };
}

/**
 * Get a single hackathon by its slug.
 * Returns the full HackathonDetail or null if not found.
 */
export async function getHackathonBySlug(
  db: D1Database,
  slug: string
): Promise<HackathonDetail | null> {
  const orm = drizzle(db);

  const rows = await orm
    .select()
    .from(hackathons)
    .where(eq(hackathons.slug, slug))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
    format: row.format as HackathonDetail['format'],
    organizer: row.organizer,
    prizes: row.prizes,
    tags: JSON.parse(row.tags) as string[],
    sourceUrl: row.sourceUrl,
    sources: JSON.parse(row.sources) as string[],
    updatedAt: row.updatedAt,
  };
}

/**
 * Get a single hackathon by its ID.
 * Returns the full HackathonDetail or null if not found.
 */
export async function getHackathonById(
  db: D1Database,
  id: string
): Promise<HackathonDetail | null> {
  const orm = drizzle(db);

  const rows = await orm
    .select()
    .from(hackathons)
    .where(eq(hackathons.id, id))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
    format: row.format as HackathonDetail['format'],
    organizer: row.organizer,
    prizes: row.prizes,
    tags: JSON.parse(row.tags) as string[],
    sourceUrl: row.sourceUrl,
    sources: JSON.parse(row.sources) as string[],
    updatedAt: row.updatedAt,
  };
}

/**
 * Insert or update a hackathon using the title+start_date deduplication constraint.
 * On conflict, merges sources and updates relevant fields.
 */
export async function upsertHackathon(
  db: D1Database,
  hackathon: UpsertHackathonData
): Promise<void> {
  const orm = drizzle(db);

  await orm
    .insert(hackathons)
    .values({
      id: hackathon.id,
      slug: hackathon.slug,
      title: hackathon.title,
      description: hackathon.description,
      startDate: hackathon.startDate,
      endDate: hackathon.endDate,
      location: hackathon.location,
      format: hackathon.format,
      organizer: hackathon.organizer,
      prizes: hackathon.prizes,
      sourceUrl: hackathon.sourceUrl,
      sources: JSON.stringify(hackathon.sources),
      tags: JSON.stringify(hackathon.tags),
      createdAt: hackathon.createdAt,
      updatedAt: hackathon.updatedAt,
      lastSeenAt: hackathon.lastSeenAt,
    })
    .onConflictDoUpdate({
      target: [hackathons.title, hackathons.startDate],
      set: {
        description: hackathon.description,
        endDate: hackathon.endDate,
        location: hackathon.location,
        format: hackathon.format,
        organizer: hackathon.organizer,
        prizes: hackathon.prizes,
        sourceUrl: hackathon.sourceUrl,
        sources: JSON.stringify(hackathon.sources),
        tags: JSON.stringify(hackathon.tags),
        updatedAt: hackathon.updatedAt,
        lastSeenAt: hackathon.lastSeenAt,
      },
    });
}

/**
 * Get recent aggregation logs, ordered by timestamp descending.
 */
export async function getAggregationLogs(
  db: D1Database,
  limit: number = 20
): Promise<typeof aggregationLogs.$inferSelect[]> {
  const orm = drizzle(db);

  return orm
    .select()
    .from(aggregationLogs)
    .orderBy(desc(aggregationLogs.timestamp))
    .limit(limit);
}

/**
 * Update the singleton refresh metadata row.
 * Creates the row if it doesn't exist.
 */
export async function updateRefreshMetadata(
  db: D1Database,
  metadata: UpdateRefreshMetadataData
): Promise<void> {
  const orm = drizzle(db);

  await orm
    .insert(refreshMetadata)
    .values({
      id: 'singleton',
      lastRefreshAt: metadata.lastRefreshAt,
      nextRefreshAt: metadata.nextRefreshAt,
      intervalMinutes: metadata.intervalMinutes ?? 60,
      allSourcesFailed: metadata.allSourcesFailed ?? false,
    })
    .onConflictDoUpdate({
      target: refreshMetadata.id,
      set: {
        lastRefreshAt: metadata.lastRefreshAt,
        nextRefreshAt: metadata.nextRefreshAt,
        ...(metadata.intervalMinutes !== undefined && {
          intervalMinutes: metadata.intervalMinutes,
        }),
        ...(metadata.allSourcesFailed !== undefined && {
          allSourcesFailed: metadata.allSourcesFailed,
        }),
      },
    });
}

/**
 * Get the current refresh metadata (singleton row).
 * Returns null if no metadata has been stored yet.
 */
export async function getRefreshMetadata(
  db: D1Database
): Promise<typeof refreshMetadata.$inferSelect | null> {
  const orm = drizzle(db);

  const rows = await orm
    .select()
    .from(refreshMetadata)
    .where(eq(refreshMetadata.id, 'singleton'))
    .limit(1);

  return rows[0] ?? null;
}
