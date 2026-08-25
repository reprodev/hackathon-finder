import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const hackathons = sqliteTable('hackathons', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  location: text('location'),
  format: text('format', { enum: ['virtual', 'in_person', 'hybrid'] })
    .notNull()
    .default('virtual'),
  organizer: text('organizer'),
  prizes: text('prizes'),
  sourceUrl: text('source_url').notNull(),
  sources: text('sources').notNull(),       // JSON array of source names
  tags: text('tags').notNull().default('[]'), // JSON array of tag strings
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => ({
  startDateIdx: index('idx_start_date').on(table.startDate),
  formatIdx: index('idx_format').on(table.format),
  deduplicationKey: uniqueIndex('idx_dedup').on(table.title, table.startDate),
}));

export const aggregationLogs = sqliteTable('aggregation_logs', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  sourceName: text('source_name').notNull(),
  status: text('status', { enum: ['success', 'partial_failure', 'failure'] }).notNull(),
  eventsFound: integer('events_found').notNull().default(0),
  eventsCreated: integer('events_created').notNull().default(0),
  eventsUpdated: integer('events_updated').notNull().default(0),
  errorMessage: text('error_message'),
  errorType: text('error_type'),
  durationMs: integer('duration_ms').notNull(),
});

export const refreshMetadata = sqliteTable('refresh_metadata', {
  id: text('id').primaryKey().default('singleton'),
  lastRefreshAt: text('last_refresh_at').notNull(),
  nextRefreshAt: text('next_refresh_at').notNull(),
  intervalMinutes: integer('interval_minutes').notNull().default(60),
  allSourcesFailed: integer('all_sources_failed', { mode: 'boolean' }).notNull().default(false),
});
