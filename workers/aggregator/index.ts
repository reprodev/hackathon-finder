/**
 * Aggregation Worker - Scheduled handler for the hackathon data pipeline.
 *
 * Orchestrates the full aggregation cycle:
 *   1. Read enabled source adapters from env
 *   2. Fetch from all enabled sources in parallel
 *   3. Normalize and validate fetched events
 *   4. Deduplicate against existing D1 records
 *   5. Upsert new/merged events to D1
 *   6. Log per-source results to aggregation_logs
 *   7. Update refresh_metadata with run status
 *
 * Triggered by a Cloudflare Cron Trigger (default: every 60 minutes).
 */

import { DevpostAdapter } from './adapters/devpost';
import { MLHAdapter } from './adapters/mlh';
import { HackerEarthAdapter } from './adapters/hackerearth';
import type { EventSourceAdapter, RawHackathonEvent } from './adapters/interface';
import { normalize, validate } from './normalizer';
import type { NormalizedHackathon } from './normalizer';
import { findDuplicate, merge } from './deduplicator';
import { generateUniqueSlug } from '../../src/lib/slug';

/**
 * Environment bindings for the Aggregation Worker.
 */
export interface AggregatorEnv {
  DB: D1Database;
  REFRESH_INTERVAL_MINUTES: string;
  SOURCE_DEVPOST_ENABLED: string;
  SOURCE_MLH_ENABLED: string;
  SOURCE_HACKEREARTH_ENABLED: string;
}

/**
 * Per-source aggregation result tracking.
 */
interface SourceResult {
  sourceName: string;
  status: 'success' | 'partial_failure' | 'failure';
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  errorMessage: string | null;
  errorType: string | null;
  durationMs: number;
}

/**
 * Parse an env var string as a boolean. Treats "true", "1", "yes" as true.
 */
function envBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes'].includes(value.toLowerCase().trim());
}

/**
 * Parse the refresh interval from env, enforcing the minimum of 15 minutes.
 */
function parseRefreshInterval(value: string | undefined): number {
  const parsed = parseInt(value || '60', 10);
  if (isNaN(parsed) || parsed < 15) {
    return 60; // Default if invalid or below minimum
  }
  return parsed;
}

/**
 * Create enabled source adapter instances based on env configuration.
 */
function createAdapters(env: AggregatorEnv): EventSourceAdapter[] {
  const adapters: EventSourceAdapter[] = [];

  adapters.push(new DevpostAdapter(envBool(env.SOURCE_DEVPOST_ENABLED)));
  adapters.push(new MLHAdapter(envBool(env.SOURCE_MLH_ENABLED)));
  adapters.push(new HackerEarthAdapter(envBool(env.SOURCE_HACKEREARTH_ENABLED)));

  return adapters.filter((adapter) => adapter.enabled);
}

/**
 * Process a batch of raw events from a single source:
 * normalize, validate, deduplicate, and upsert to D1.
 *
 * Returns counts of created/updated events and any partial errors.
 */
async function processEvents(
  rawEvents: RawHackathonEvent[],
  db: D1Database
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const raw of rawEvents) {
    try {
      // Normalize
      const normalized = normalize(raw);

      // Validate
      const validation = validate(normalized);
      if (!validation.valid) {
        skipped++;
        continue;
      }

      // Check for duplicates
      const existing = await findDuplicate(normalized, db);

      if (existing) {
        // Merge and update
        const merged = merge(existing, normalized);
        await upsertHackathonToD1(db, merged);
        updated++;
      } else {
        // Insert new record
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const slug = generateUniqueSlug(normalized.title);

        await insertHackathonToD1(db, {
          id,
          slug,
          title: normalized.title,
          description: normalized.description,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          location: normalized.location,
          format: normalized.format,
          organizer: normalized.organizer,
          prizes: normalized.prizes,
          sourceUrl: normalized.sourceUrl,
          sources: [normalized.sourceName],
          tags: normalized.tags,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
        });
        created++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Event "${raw.title}": ${message}`);
      skipped++;
    }
  }

  return { created, updated, skipped, errors };
}

/**
 * Insert a new hackathon record into D1 using raw SQL.
 */
async function insertHackathonToD1(
  db: D1Database,
  data: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    startDate: string;
    endDate: string | null;
    location: string | null;
    format: string;
    organizer: string | null;
    prizes: string | null;
    sourceUrl: string;
    sources: string[];
    tags: string[];
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO hackathons (id, slug, title, description, start_date, end_date, location, format, organizer, prizes, source_url, sources, tags, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.slug,
      data.title,
      data.description,
      data.startDate,
      data.endDate,
      data.location,
      data.format,
      data.organizer,
      data.prizes,
      data.sourceUrl,
      JSON.stringify(data.sources),
      JSON.stringify(data.tags),
      data.createdAt,
      data.updatedAt,
      data.lastSeenAt
    )
    .run();
}

/**
 * Upsert a merged hackathon record into D1 (update existing row).
 */
async function upsertHackathonToD1(
  db: D1Database,
  data: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    startDate: string;
    endDate: string | null;
    location: string | null;
    format: string;
    organizer: string | null;
    prizes: string | null;
    sourceUrl: string;
    sources: string[];
    tags: string[];
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE hackathons
       SET description = ?, end_date = ?, location = ?, format = ?, organizer = ?, prizes = ?,
           source_url = ?, sources = ?, tags = ?, updated_at = ?, last_seen_at = ?
       WHERE id = ?`
    )
    .bind(
      data.description,
      data.endDate,
      data.location,
      data.format,
      data.organizer,
      data.prizes,
      data.sourceUrl,
      JSON.stringify(data.sources),
      JSON.stringify(data.tags),
      data.updatedAt,
      data.lastSeenAt,
      data.id
    )
    .run();
}

/**
 * Log an aggregation result for a source to the aggregation_logs table.
 */
async function logAggregationResult(
  db: D1Database,
  result: SourceResult
): Promise<void> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO aggregation_logs (id, timestamp, source_name, status, events_found, events_created, events_updated, error_message, error_type, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      timestamp,
      result.sourceName,
      result.status,
      result.eventsFound,
      result.eventsCreated,
      result.eventsUpdated,
      result.errorMessage,
      result.errorType,
      result.durationMs
    )
    .run();
}

/**
 * Update the refresh_metadata singleton row with latest run info.
 */
async function updateRefreshMetadata(
  db: D1Database,
  intervalMinutes: number,
  allSourcesFailed: boolean
): Promise<void> {
  const now = new Date();
  const lastRefreshAt = now.toISOString();
  const nextRefreshAt = new Date(
    now.getTime() + intervalMinutes * 60 * 1000
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO refresh_metadata (id, last_refresh_at, next_refresh_at, interval_minutes, all_sources_failed)
       VALUES ('singleton', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_refresh_at = excluded.last_refresh_at,
         next_refresh_at = excluded.next_refresh_at,
         interval_minutes = excluded.interval_minutes,
         all_sources_failed = excluded.all_sources_failed`
    )
    .bind(
      lastRefreshAt,
      nextRefreshAt,
      intervalMinutes,
      allSourcesFailed ? 1 : 0
    )
    .run();
}

/**
 * Main aggregation orchestrator.
 * Fetches from all enabled sources, processes events, logs results.
 */
async function runAggregation(env: AggregatorEnv): Promise<void> {
  const intervalMinutes = parseRefreshInterval(env.REFRESH_INTERVAL_MINUTES);
  const adapters = createAdapters(env);

  if (adapters.length === 0) {
    // No adapters enabled — update metadata and return
    await updateRefreshMetadata(env.DB, intervalMinutes, false);
    return;
  }

  // Fetch from all enabled sources in parallel
  const fetchResults = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const start = Date.now();
      try {
        const events = await adapter.fetch();
        return {
          adapter,
          events,
          durationMs: Date.now() - start,
          error: null,
        };
      } catch (error) {
        return {
          adapter,
          events: [] as RawHackathonEvent[],
          durationMs: Date.now() - start,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    })
  );

  const sourceResults: SourceResult[] = [];
  let anySourceSucceeded = false;

  // Process each source's results
  for (const settled of fetchResults) {
    // Promise.allSettled with our wrapper always fulfills (errors are captured inside)
    if (settled.status !== 'fulfilled') {
      continue;
    }

    const { adapter, events, durationMs, error } = settled.value;

    if (error) {
      // Source fetch failed entirely
      sourceResults.push({
        sourceName: adapter.name,
        status: 'failure',
        eventsFound: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        errorMessage: error.message,
        errorType: error.name || 'Error',
        durationMs,
      });
      continue;
    }

    // Source fetch succeeded — process events
    anySourceSucceeded = true;
    const processStart = Date.now();

    try {
      const { created, updated, skipped, errors } = await processEvents(
        events,
        env.DB
      );

      const totalDuration = durationMs + (Date.now() - processStart);
      const hasPartialErrors = errors.length > 0;

      sourceResults.push({
        sourceName: adapter.name,
        status: hasPartialErrors ? 'partial_failure' : 'success',
        eventsFound: events.length,
        eventsCreated: created,
        eventsUpdated: updated,
        errorMessage: hasPartialErrors
          ? `${errors.length} events failed: ${errors.slice(0, 3).join('; ')}`
          : null,
        errorType: hasPartialErrors ? 'ProcessingError' : null,
        durationMs: totalDuration,
      });
    } catch (error) {
      // Processing phase failed (e.g., D1 unavailable)
      const message = error instanceof Error ? error.message : String(error);
      const totalDuration = durationMs + (Date.now() - processStart);

      sourceResults.push({
        sourceName: adapter.name,
        status: 'failure',
        eventsFound: events.length,
        eventsCreated: 0,
        eventsUpdated: 0,
        errorMessage: `Processing failed: ${message}`,
        errorType: error instanceof Error ? error.name : 'Error',
        durationMs: totalDuration,
      });
    }
  }

  // Log all source results to aggregation_logs
  for (const result of sourceResults) {
    try {
      await logAggregationResult(env.DB, result);
    } catch {
      // If logging itself fails, we can't do much — continue
    }
  }

  // Update refresh_metadata
  const allFailed = !anySourceSucceeded;
  await updateRefreshMetadata(env.DB, intervalMinutes, allFailed);
}

/**
 * Cloudflare Worker export with scheduled handler.
 */
export default {
  /**
   * Cron Trigger handler — runs the full aggregation pipeline.
   */
  async scheduled(
    _controller: ScheduledController,
    env: AggregatorEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runAggregation(env));
  },

  /**
   * Optional HTTP handler for manual trigger / testing via:
   *   curl http://localhost:8787/__scheduled
   * or the Wrangler scheduled handler test endpoint.
   */
  async fetch(
    request: Request,
    env: AggregatorEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Allow manual trigger for testing
    if (url.pathname === '/__scheduled' || url.pathname === '/trigger') {
      try {
        await runAggregation(env);
        return new Response(
          JSON.stringify({ success: true, message: 'Aggregation completed' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(
          JSON.stringify({ success: false, error: message }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
