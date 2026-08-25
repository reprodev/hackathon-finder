/**
 * HackathonGrid — Main orchestrating React island combining SearchBar,
 * FilterPanel, and the grid of HackathonCards with infinite scroll.
 *
 * Manages state: query, filters, hackathons[], page, total, hasMore, loading, error.
 * Fetches from /api/hackathons with pagination and appends results on scroll.
 *
 * Requirements satisfied: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 6.4, 6.5
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { HackathonSummary, FilterCriteria } from '../lib/types';
import SearchBar from './SearchBar';
import FilterPanel from './FilterPanel';
import HackathonCard from './HackathonCard';
import InfiniteScroll from './InfiniteScroll';

const PAGE_SIZE = 12;

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-700 bg-gray-800 p-5">
      {/* Format badge skeleton */}
      <div className="h-5 w-16 rounded-full bg-gray-700" />
      {/* Title skeleton */}
      <div className="mt-3 h-6 w-3/4 rounded bg-gray-700" />
      {/* Date skeleton */}
      <div className="mt-2 h-4 w-1/2 rounded bg-gray-700" />
      {/* Tags skeleton */}
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-12 rounded-md bg-gray-700" />
        <div className="h-5 w-14 rounded-md bg-gray-700" />
        <div className="h-5 w-10 rounded-md bg-gray-700" />
      </div>
      {/* Organizer skeleton */}
      <div className="mt-3 h-3 w-1/3 rounded bg-gray-700" />
    </div>
  );
}

function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Error State ──────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-900/50 bg-red-900/10 px-6 py-12 text-center">
      <svg
        className="mb-4 h-12 w-12 text-red-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="text-sm text-red-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800/50 px-6 py-16 text-center">
      <svg
        className="mb-4 h-12 w-12 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
      <h3 className="text-lg font-medium text-gray-200">No hackathons found</h3>
      <p className="mt-2 text-sm text-gray-400">
        Try broadening your search or adjusting your filters to see more results.
      </p>
    </div>
  );
}

// ─── Inline Loading (bottom of list) ──────────────────────────────────────────

function InlineLoader() {
  return (
    <div className="flex items-center justify-center py-6">
      <svg
        className="h-6 w-6 animate-spin text-indigo-400"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span className="ml-2 text-sm text-gray-400">Loading more hackathons...</span>
    </div>
  );
}

// ─── Inline Error (bottom of list, during infinite scroll) ────────────────────

function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-4">
      <p className="text-sm text-red-300">Failed to load more results.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// ─── Helper: Build fetch URL ──────────────────────────────────────────────────

function buildApiUrl(query: string, filters: FilterCriteria, page: number): string {
  const params = new URLSearchParams();

  if (query) params.set('q', query);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  if (filters.format && filters.format.length > 0) {
    params.set('format', filters.format.join(','));
  }
  if (filters.tags && filters.tags.length > 0) {
    params.set('tags', filters.tags.join(','));
  }
  if (filters.dateRange) {
    params.set('dateStart', filters.dateRange.start);
    params.set('dateEnd', filters.dateRange.end);
  }

  return `/api/hackathons?${params.toString()}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface HackathonGridProps {
  /** Initial search query (e.g., from URL params) */
  initialQuery?: string;
  /** Initial filters (e.g., from URL params) */
  initialFilters?: FilterCriteria;
}

export default function HackathonGrid({
  initialQuery = '',
  initialFilters,
}: HackathonGridProps) {
  // State
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<FilterCriteria>(initialFilters ?? {});
  const [hackathons, setHackathons] = useState<HackathonSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollError, setScrollError] = useState(false);

  // Track the current fetch to avoid race conditions
  const fetchIdRef = useRef(0);

  // ─── Fetch Data ─────────────────────────────────────────────────────────

  const fetchHackathons = useCallback(
    async (
      searchQuery: string,
      searchFilters: FilterCriteria,
      pageNum: number,
      append: boolean
    ) => {
      const fetchId = ++fetchIdRef.current;

      if (append) {
        setLoadingMore(true);
        setScrollError(false);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const url = buildApiUrl(searchQuery, searchFilters, pageNum);
        const response = await fetch(url, { signal: controller.signal });

        clearTimeout(timeoutId);

        // Ignore stale responses
        if (fetchId !== fetchIdRef.current) return;

        if (!response.ok) {
          throw new Error(`Server error (${response.status})`);
        }

        const json = (await response.json()) as {
          data: HackathonSummary[];
          meta: { total: number; page: number; pageSize: number; hasMore: boolean };
        };
        const { data, meta } = json;

        if (append) {
          setHackathons((prev) => [...prev, ...data]);
        } else {
          setHackathons(data);
        }

        setTotal(meta.total);
        setHasMore(meta.hasMore);
        setPage(meta.page);
      } catch (err: unknown) {
        // Ignore stale responses
        if (fetchId !== fetchIdRef.current) return;

        const message =
          err instanceof Error && err.name === 'AbortError'
            ? 'Request timed out. Please try again.'
            : 'Failed to load hackathons. Please try again.';

        if (append) {
          setScrollError(true);
        } else {
          setError(message);
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    []
  );

  // ─── Initial load ───────────────────────────────────────────────────────

  useEffect(() => {
    fetchHackathons(query, filters, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Search Handler ─────────────────────────────────────────────────────

  const handleSearch = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
      setPage(1);
      setHackathons([]);
      fetchHackathons(newQuery, filters, 1, false);
    },
    [filters, fetchHackathons]
  );

  // ─── Filter Handler ─────────────────────────────────────────────────────

  const handleFilterChange = useCallback(
    (newFilters: FilterCriteria) => {
      setFilters(newFilters);
      setPage(1);
      setHackathons([]);
      fetchHackathons(query, newFilters, 1, false);
    },
    [query, fetchHackathons]
  );

  // ─── Load More (infinite scroll) ───────────────────────────────────────

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    fetchHackathons(query, filters, nextPage, true);
  }, [loadingMore, hasMore, page, query, filters, fetchHackathons]);

  // ─── Retry Handlers ─────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    fetchHackathons(query, filters, 1, false);
  }, [query, filters, fetchHackathons]);

  const handleScrollRetry = useCallback(() => {
    const nextPage = page + 1;
    fetchHackathons(query, filters, nextPage, true);
  }, [page, query, filters, fetchHackathons]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <SearchBar
        onSearch={handleSearch}
        initialQuery={initialQuery}
        disabled={false}
        error={error && !hackathons.length ? undefined : undefined}
      />

      {/* Main content area with filters sidebar */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Filter Panel */}
        <div className="w-full shrink-0 lg:w-64">
          <FilterPanel
            onFilterChange={handleFilterChange}
            initialFilters={initialFilters}
          />
        </div>

        {/* Results area */}
        <div className="flex-1 space-y-4">
          {/* Result count */}
          {!loading && !error && (
            <p className="text-sm text-gray-400">
              Showing{' '}
              <span className="font-medium text-gray-200">{hackathons.length}</span> of{' '}
              <span className="font-medium text-gray-200">{total}</span> hackathons
            </p>
          )}

          {/* Initial loading state */}
          {loading && <SkeletonGrid count={PAGE_SIZE} />}

          {/* Error state (full page) */}
          {!loading && error && (
            <ErrorState message={error} onRetry={handleRetry} />
          )}

          {/* Empty state */}
          {!loading && !error && hackathons.length === 0 && <EmptyState />}

          {/* Hackathon cards grid */}
          {!loading && !error && hackathons.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {hackathons.map((hackathon) => (
                  <HackathonCard key={hackathon.id} hackathon={hackathon} />
                ))}
              </div>

              {/* Inline loading during infinite scroll */}
              {loadingMore && <InlineLoader />}

              {/* Inline error during infinite scroll */}
              {scrollError && <InlineError onRetry={handleScrollRetry} />}

              {/* Infinite scroll trigger */}
              {!loadingMore && !scrollError && (
                <InfiniteScroll
                  onLoadMore={handleLoadMore}
                  hasMore={hasMore}
                  loading={loadingMore}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
