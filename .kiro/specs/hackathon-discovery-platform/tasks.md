# Implementation Plan: Hackathon Discovery Platform

## Overview

Build a self-hosted hackathon discovery platform deployed on Cloudflare's edge network using Astro (SSR/SSG), React islands, Cloudflare D1 with FTS5 full-text search, and Cron Triggers for scheduled data aggregation. The implementation progresses from project scaffolding through data layer, aggregation worker, API, UI, SEO, error handling, and testing.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Initialize Astro project with Cloudflare adapter, React integration, and Tailwind CSS
    - Run `npm create astro` with TypeScript strict mode
    - Install and configure `@astrojs/cloudflare`, `@astrojs/react`, `@astrojs/tailwind`
    - Configure `astro.config.mjs` with Cloudflare adapter and React integration
    - Set up `tailwind.config.mjs` with content paths
    - Create `src/env.d.ts` with D1 binding types
    - _Requirements: 7.1, 6.1_

  - [x] 1.2 Set up Drizzle ORM with D1 driver and project directory structure
    - Install `drizzle-orm`, `drizzle-kit`, `@cloudflare/workers-types`
    - Create `drizzle.config.ts` for D1
    - Create directory structure: `src/pages/`, `src/components/`, `src/lib/db/`, `src/lib/`, `src/layouts/`, `workers/aggregator/adapters/`
    - _Requirements: 7.1_

  - [x] 1.3 Configure wrangler.toml for Pages project and Aggregation Worker
    - Create root `wrangler.toml` with D1 database binding
    - Create `workers/aggregator/wrangler.toml` with D1 binding and cron trigger (`0 * * * *`)
    - Add environment variables for source enable/disable flags and refresh interval
    - _Requirements: 7.1, 7.2, 1.3_

  - [x] 1.4 Set up testing infrastructure (Vitest + fast-check + Playwright)
    - Install `vitest`, `@cloudflare/vitest-pool-workers`, `fast-check`, `@playwright/test`
    - Create `vitest.config.ts` with Cloudflare Workers pool configuration
    - Create `playwright.config.ts` for E2E tests
    - Create test directory structure: `tests/unit/`, `tests/property/`, `tests/integration/`, `tests/e2e/`
    - _Requirements: 7.1_

- [x] 2. Database schema and migrations
  - [x] 2.1 Create Drizzle schema for hackathons, aggregation_logs, and refresh_metadata tables
    - Define `src/lib/db/schema.ts` with all tables, columns, indexes per design
    - Include deduplication unique index on (title, start_date)
    - Include indexes on start_date and format columns
    - _Requirements: 1.2, 1.5, 1.6_

  - [x] 2.2 Create D1 SQL migration with FTS5 virtual table and sync triggers
    - Write `src/lib/db/migrations/0001_create_tables.sql` with all CREATE TABLE statements
    - Create FTS5 virtual table `hackathon_fts` with porter tokenizer and unicode61
    - Create AFTER INSERT, UPDATE, DELETE triggers to keep FTS5 in sync
    - Create aggregation_logs and refresh_metadata tables
    - _Requirements: 1.2, 1.5, 2.1, 2.3_

  - [x] 2.3 Create typed query helper functions
    - Write `src/lib/db/queries.ts` with Drizzle-based typed queries for CRUD operations
    - Include functions: `getHackathons`, `getHackathonBySlug`, `upsertHackathon`, `getAggregationLogs`, `updateRefreshMetadata`
    - _Requirements: 1.2, 1.5, 1.6_

- [x] 3. Checkpoint - Ensure project builds and migrations are valid
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Shared types and utilities
  - [x] 4.1 Define shared TypeScript types and interfaces
    - Create `src/lib/types.ts` with all shared interfaces: `HackathonSummary`, `HackathonDetailResponse`, `HackathonListResponse`, `FilterCriteria`, `PaginationParams`, `SearchResult`
    - Define API response shapes per design
    - _Requirements: 1.2, 2.1, 3.2, 4.2_

  - [x] 4.2 Implement slug generation utility
    - Create utility function to generate URL-safe slugs from hackathon titles
    - Handle special characters, Unicode, and potential collisions
    - _Requirements: 5.3_

- [x] 5. Source adapters (Aggregation Worker)
  - [x] 5.1 Create source adapter interface and base types
    - Write `workers/aggregator/adapters/interface.ts` with `EventSourceAdapter` and `RawHackathonEvent` interfaces
    - _Requirements: 1.1, 1.4_

  - [x] 5.2 Implement Devpost source adapter
    - Write `workers/aggregator/adapters/devpost.ts` implementing `EventSourceAdapter`
    - Fetch hackathon data from Devpost structured endpoints
    - Map Devpost-specific fields to `RawHackathonEvent`
    - Implement `healthCheck()` method
    - _Requirements: 1.1, 1.4_

  - [x] 5.3 Implement MLH source adapter
    - Write `workers/aggregator/adapters/mlh.ts` implementing `EventSourceAdapter`
    - Scrape MLH events page HTML for hackathon data
    - Map MLH-specific fields to `RawHackathonEvent`
    - Implement `healthCheck()` method
    - _Requirements: 1.1, 1.4_

  - [x] 5.4 Implement HackerEarth source adapter
    - Write `workers/aggregator/adapters/hackerearth.ts` implementing `EventSourceAdapter`
    - Scrape HackerEarth challenge listings HTML
    - Map HackerEarth-specific fields to `RawHackathonEvent`
    - Implement `healthCheck()` method
    - _Requirements: 1.1, 1.4_

  - [x]* 5.5 Write property test for partial-failure resilience (Property 3)
    - **Property 3: Resilient partial-failure fetching**
    - Generate random non-empty subsets of failing adapters while keeping at least one healthy
    - Verify aggregator stores data from healthy sources and logs failures
    - **Validates: Requirements 1.4, 1.7**

- [x] 6. Data normalizer and deduplicator
  - [x] 6.1 Implement data normalizer with validation
    - Write `workers/aggregator/normalizer.ts` implementing `DataNormalizer` interface
    - Enforce field length constraints: title<=200, description<=5000, tags<=20
    - Validate required fields (title, startDate, sourceUrl) are present and non-empty
    - Detect format (virtual/in_person/hybrid) from location data
    - _Requirements: 1.2_

  - [x]* 6.2 Write property test for normalization schema conformance (Property 1)
    - **Property 1: Normalization schema conformance**
    - Generate random `RawHackathonEvent` with variable field lengths (0-500 char titles, 0-10000 char descriptions, 0-50 tags)
    - Verify output always conforms to schema constraints
    - **Validates: Requirements 1.2**

  - [x] 6.3 Implement deduplication engine
    - Write `workers/aggregator/deduplicator.ts` implementing `DeduplicationEngine` interface
    - Query D1 for existing records by title (case-insensitive) + start_date
    - Merge records from different sources preserving information from both
    - _Requirements: 1.6_

  - [x]* 6.4 Write property test for deduplication merge correctness (Property 5)
    - **Property 5: Deduplication merge correctness**
    - Generate pairs of events with matching title+startDate from different sources
    - Verify exactly one merged record is produced preserving data from both
    - **Validates: Requirements 1.6**

- [x] 7. Aggregation Worker with Cron Trigger
  - [x] 7.1 Implement aggregation worker scheduled handler
    - Write `workers/aggregator/index.ts` with `scheduled()` event handler
    - Orchestrate: fetch from enabled sources → normalize → deduplicate → upsert to D1
    - Implement error handling per source (continue on individual failure)
    - Update refresh_metadata after each run
    - Log aggregation results to aggregation_logs table
    - _Requirements: 1.1, 1.3, 1.4, 1.7_

  - [x] 7.2 Implement refresh interval validation and cache staleness logic
    - Validate configurable interval >= 15 minutes
    - Implement staleness check: stale if currentTime > lastRefresh + (2 × interval)
    - Store interval in refresh_metadata
    - _Requirements: 1.3, 1.5_

  - [x]* 7.3 Write property test for refresh interval validation (Property 2)
    - **Property 2: Refresh interval validation**
    - Generate random integers (0-1440) as interval values
    - Verify acceptance if >= 15, rejection if < 15
    - **Validates: Requirements 1.3**

  - [x]* 7.4 Write property test for cache staleness calculation (Property 4)
    - **Property 4: Cache staleness calculation**
    - Generate random (lastRefreshTimestamp, interval>=15, currentTime) tuples
    - Verify staleness iff currentTime > lastRefresh + (2 × interval)
    - **Validates: Requirements 1.5**

- [x] 8. Checkpoint - Ensure aggregation pipeline works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Search engine (FTS5 with BM25 ranking)
  - [x] 9.1 Implement FTS5 search logic with BM25 ranking
    - Write `src/lib/search.ts` implementing `SearchEngine` interface
    - Build FTS5 MATCH queries with BM25 column weights (title=10, tags=5, description=1)
    - Handle queries < 2 chars by returning full dataset
    - Handle queries > 200 chars by rejecting with validation error
    - Support pagination in search results
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 9.2 Write property test for search substring matching (Property 6)
    - **Property 6: Search substring matching**
    - Generate random queries (2-200 chars) and hackathon datasets
    - Verify every result contains the query as case-insensitive substring in title, description, or tags
    - **Validates: Requirements 2.1**

  - [x]* 9.3 Write property test for short query returns full dataset (Property 7)
    - **Property 7: Short query returns full dataset**
    - Generate random 0-1 char strings and hackathon datasets
    - Verify result set equals the complete unfiltered dataset
    - **Validates: Requirements 2.2**

  - [x]* 9.4 Write property test for search ranking priority (Property 8)
    - **Property 8: Search ranking priority**
    - Generate datasets with controlled match locations (title-only, tag-only, desc-only)
    - Verify title matches appear before tag matches, which appear before description matches
    - **Validates: Requirements 2.3**

- [x] 10. Filter logic
  - [x] 10.1 Implement filter composition engine
    - Write `src/lib/filters.ts` with filter logic for date range, format, and tags
    - Implement AND logic across filter types, OR logic within filter types
    - Implement date range presets (upcoming, this week, this month, custom)
    - Validate custom date ranges (start <= end)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 10.2 Write property test for filter AND/OR logic (Property 9)
    - **Property 9: Filter AND/OR logic**
    - Generate random filter combinations and hackathon datasets
    - Verify results satisfy ALL filter types (AND) and at least one value within each type (OR)
    - **Validates: Requirements 3.2**

  - [x]* 10.3 Write property test for search and filter composition (Property 10)
    - **Property 10: Search and filter composition**
    - Generate random queries + filters + datasets
    - Verify result equals intersection of search-only results and filter-only results
    - **Validates: Requirements 3.3**

  - [x]* 10.4 Write property test for filter reset restores full dataset (Property 11)
    - **Property 11: Filter reset restores full dataset**
    - Generate random datasets with random prior filter state
    - Verify clearing all filters and search produces complete dataset
    - **Validates: Requirements 3.4**

  - [x]* 10.5 Write property test for invalid date range rejection (Property 12)
    - **Property 12: Invalid date range rejection**
    - Generate random date pairs (both valid and invalid orderings)
    - Verify rejection when start > end, acceptance otherwise
    - **Validates: Requirements 3.5**

- [x] 11. API routes
  - [x] 11.1 Implement GET /api/hackathons endpoint
    - Create `src/pages/api/hackathons/index.ts`
    - Accept query params: `q`, `page`, `pageSize`, `format`, `tags`, `dateStart`, `dateEnd`
    - Integrate search engine and filter logic
    - Return `HackathonListResponse` JSON with data and meta (total, page, pageSize, hasMore)
    - Validate input parameters (query length, page bounds)
    - _Requirements: 2.1, 2.2, 3.2, 3.3, 4.4_

  - [x] 11.2 Implement GET /api/hackathons/[id] endpoint
    - Create `src/pages/api/hackathons/[id].ts`
    - Fetch hackathon by ID or slug from D1
    - Return `HackathonDetailResponse` JSON
    - Return 404 for non-existent hackathons
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 11.3 Implement GET /api/health endpoint
    - Create `src/pages/api/health.ts`
    - Check D1 database connectivity
    - Return health status JSON
    - _Requirements: 7.1_

  - [x]* 11.4 Write property test for result count consistency (Property 14)
    - **Property 14: Result count consistency**
    - Generate random search/filter combinations and datasets
    - Verify reported total count equals actual matching count in database
    - **Validates: Requirements 4.4**

- [x] 12. Checkpoint - Ensure API routes return correct data
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. UI components (React islands)
  - [x] 13.1 Create base Astro layout with semantic HTML structure
    - Write `src/layouts/Base.astro` with HTML boilerplate, nav, main, footer landmarks
    - Include h1 heading, proper semantic elements
    - Set up Tailwind responsive breakpoints
    - _Requirements: 6.1, 8.4_

  - [x] 13.2 Implement SearchBar React component
    - Write `src/components/SearchBar.tsx` as a React island (`client:load`)
    - Debounced input (300ms) with minimum 2-char threshold
    - Emit search query changes to parent/state
    - Show error state when search is unavailable
    - _Requirements: 2.1, 2.2, 6.2_

  - [x] 13.3 Implement FilterPanel React component
    - Write `src/components/FilterPanel.tsx` as a React island (`client:visible`)
    - Include DateRangeFilter (presets + custom), FormatFilter, TagFilter sub-components
    - Implement clear-all functionality
    - Show validation error for invalid date ranges
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 6.2_

  - [x] 13.4 Implement HackathonCard component with truncation rules
    - Write `src/components/HackathonCard.tsx`
    - Display title (truncated to 80 chars with ellipsis), start/end dates, format badge, up to 3 tags, organizer
    - Link to detail page via slug
    - Responsive card layout
    - _Requirements: 4.2, 4.1_

  - [x]* 13.5 Write property test for card display truncation rules (Property 13)
    - **Property 13: Card display truncation rules**
    - Generate random hackathons with title lengths 0-300 and tag counts 0-20
    - Verify title truncated to <=80 chars with ellipsis if original exceeds 80, and max 3 tags displayed
    - **Validates: Requirements 4.2**

  - [x] 13.6 Implement HackathonGrid with infinite scroll
    - Write `src/components/HackathonGrid.tsx` and `src/components/InfiniteScroll.tsx`
    - Fetch from `/api/hackathons` with pagination
    - Append next batch (12 items) on scroll-to-bottom
    - Show loading skeletons during fetch
    - Show error state with retry button on failure
    - Show "no results" message when empty
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 6.4, 6.5_

  - [x] 13.7 Implement LoadingSkeleton Astro component
    - Write `src/components/LoadingSkeleton.astro` with animated placeholders matching card dimensions
    - _Requirements: 6.4_

- [ ] 14. SSR pages
  - [~] 14.1 Implement landing page (/)
    - Write `src/pages/index.astro` with featured hackathons section
    - SSR with edge caching
    - Include search prompt and navigation to full listing
    - _Requirements: 6.1, 8.1_

  - [~] 14.2 Implement hackathon listing page (/hackathons)
    - Write `src/pages/hackathons/index.astro` with SearchBar, FilterPanel, and HackathonGrid islands
    - SSR with reactive client-side updates
    - Display total result count
    - _Requirements: 4.1, 4.4, 6.1, 6.2, 8.1_

  - [~] 14.3 Implement hackathon detail page (/hackathons/[slug])
    - Write `src/pages/hackathons/[slug].astro` with full hackathon details
    - Display: title, description, dates, location, organizer, prizes, tags, source link (opens in new tab)
    - Handle 404 for non-existent slugs
    - Handle missing source URL gracefully
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1_

  - [ ]* 14.4 Write property test for permalink round-trip (Property 15)
    - **Property 15: Permalink round-trip**
    - Generate random hackathon slugs and data
    - Verify generating a permalink from slug and querying it resolves to same hackathon data
    - **Validates: Requirements 5.3**

- [ ] 15. SEO implementation
  - [~] 15.1 Add meta tags to detail pages (OG, Twitter, canonical)
    - Add og:title, og:description, og:url, twitter:card, twitter:title meta tags to detail page layout
    - Add canonical URL meta tag
    - Populate from hackathon content
    - _Requirements: 8.2, 8.5_

  - [ ]* 15.2 Write property test for meta tag completeness (Property 17)
    - **Property 17: Meta tag completeness on detail pages**
    - Generate random hackathon data with varying lengths and special chars
    - Verify HTML output contains all required meta tags with non-empty values
    - **Validates: Requirements 8.2, 8.5**

  - [~] 15.3 Implement dynamic sitemap.xml generation
    - Write `src/pages/sitemap.xml.ts` that queries D1 for all published hackathons
    - Generate valid sitemap XML with detail page URLs
    - Update within 60 minutes of hackathon publish/removal
    - _Requirements: 8.3_

  - [ ]* 15.4 Write property test for sitemap completeness (Property 18)
    - **Property 18: Sitemap completeness**
    - Generate random sets of published/removed hackathons
    - Verify sitemap contains exactly the URLs for published hackathons and none for removed ones
    - **Validates: Requirements 8.3**

  - [~] 15.5 Ensure semantic HTML structure across all pages
    - Verify h1 headings, nav/main landmarks, list elements for repeating items on listing and detail pages
    - _Requirements: 8.4_

- [ ] 16. Error handling
  - [~] 16.1 Implement global error handler and error page
    - Create error page returning 500 with generic message (no internals exposed)
    - Implement not-found (404) page with navigation back to listing
    - Add error boundary for React islands
    - _Requirements: 7.5, 5.4_

  - [ ]* 16.2 Write property test for error response information containment (Property 16)
    - **Property 16: Error response information containment**
    - Generate random error types and messages containing file paths, stack traces, env vars
    - Verify 500 response body never contains stack traces, file paths, env vars, D1 connection strings, or Worker internals
    - **Validates: Requirements 7.5**

  - [~] 16.3 Implement client-side error states and retry logic
    - Add exponential backoff retry (1s, 2s, 4s, max 3 retries) for network/5xx errors
    - Show "search temporarily unavailable" banner with retry on search failure
    - Show inline error + retry at bottom of list on infinite scroll failure
    - Replace skeletons with error message after 10s timeout
    - _Requirements: 2.5, 4.7, 6.5_

- [~] 17. Checkpoint - Ensure full UI renders correctly with all error states
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Integration tests
  - [~] 18.1 Write D1 integration tests
    - Test migrations apply cleanly and FTS5 table is created
    - Test FTS5 triggers sync data on insert/update/delete
    - Test search returns correctly ranked results from D1
    - Test deduplication merges records in D1
    - _Requirements: 1.2, 1.6, 2.1, 2.3_

  - [~] 18.2 Write API route integration tests
    - Test `/api/hackathons` with various query/filter combinations
    - Test `/api/hackathons/[id]` returns correct detail and 404
    - Test `/api/health` returns connectivity status
    - Test response shapes match defined interfaces
    - _Requirements: 2.1, 3.2, 4.4, 5.1, 5.4_

  - [~] 18.3 Write aggregation worker integration tests
    - Test `scheduled()` handler completes with mock sources
    - Test partial source failure handling (some sources fail, others succeed)
    - Test all-sources-failed scenario preserves existing data
    - Test refresh_metadata and aggregation_logs are updated correctly
    - _Requirements: 1.1, 1.4, 1.7_

- [ ] 19. E2E tests (Playwright)
  - [ ]* 19.1 Write E2E tests for search and filter flows
    - Test search updates results reactively
    - Test filter application narrows results correctly
    - Test combined search + filter
    - Test "no results" state
    - _Requirements: 2.1, 3.2, 3.3, 4.6, 6.2_

  - [ ]* 19.2 Write E2E tests for navigation and responsive layout
    - Test card click navigates to detail page
    - Test permalink direct URL access
    - Test mobile viewport (320px) single-column layout
    - Test desktop viewport (1200px) multi-column grid
    - Test infinite scroll loads next batch
    - Test skeleton loading states
    - _Requirements: 4.1, 4.3, 5.3, 6.1, 6.4, 6.6_

  - [ ]* 19.3 Write E2E tests for SEO verification
    - Test meta tags present in page source
    - Test sitemap.xml accessible and valid
    - _Requirements: 8.2, 8.3, 8.5_

- [ ] 20. Deployment configuration and final wiring
  - [~] 20.1 Finalize deployment configuration
    - Verify `wrangler.toml` configurations for both Pages and Aggregation Worker
    - Set up D1 database creation commands in README/scripts
    - Configure HTTPS redirect (Cloudflare automatic)
    - Verify custom domain configuration approach
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [~] 20.2 Wire all components together and verify build
    - Ensure all imports resolve correctly
    - Verify Astro build succeeds with Cloudflare adapter
    - Verify aggregation worker builds independently
    - Test `wrangler pages dev` serves pages locally
    - _Requirements: 7.1_

- [~] 21. Final checkpoint - Full system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties from the design document (18 properties total)
- Unit tests and property tests are complementary — properties verify universal invariants, unit tests verify specific examples
- The implementation uses TypeScript throughout (Astro, React, Drizzle ORM, Vitest, fast-check)
- All source adapters follow the adapter pattern defined in the design
- D1 FTS5 handles full-text search natively — no external search service needed
- Cloudflare free tier constraints are well within expected usage (see design for headroom analysis)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "4.1", "4.2", "5.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.5", "6.1", "6.3"] },
    { "id": 5, "tasks": ["6.2", "6.4", "7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "9.1", "10.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 9, "tasks": ["11.4", "13.1", "13.7"] },
    { "id": 10, "tasks": ["13.2", "13.3", "13.4"] },
    { "id": 11, "tasks": ["13.5", "13.6"] },
    { "id": 12, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 13, "tasks": ["14.4", "15.1", "15.3", "15.5"] },
    { "id": 14, "tasks": ["15.2", "15.4", "16.1"] },
    { "id": 15, "tasks": ["16.2", "16.3"] },
    { "id": 16, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 17, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 18, "tasks": ["20.1", "20.2"] }
  ]
}
```
