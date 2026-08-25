import { useRef, useEffect } from 'react';

export interface InfiniteScrollProps {
  /** Callback triggered when sentinel enters viewport */
  onLoadMore: () => void;
  /** Whether more data is available to load */
  hasMore: boolean;
  /** Whether a load is currently in progress (prevents duplicate triggers) */
  loading?: boolean;
  /** Root margin for the intersection observer (default: '200px') */
  rootMargin?: string;
}

/**
 * InfiniteScroll component uses Intersection Observer to detect when a
 * sentinel element enters the viewport, triggering the onLoadMore callback.
 *
 * Reusable and lightweight — renders only a small invisible sentinel div.
 *
 * Requirements satisfied: 4.3
 */
export default function InfiniteScroll({
  onLoadMore,
  hasMore,
  loading = false,
  rootMargin = '200px',
}: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [onLoadMore, hasMore, loading, rootMargin]);

  if (!hasMore) return null;

  return (
    <div
      ref={sentinelRef}
      className="h-1 w-full"
      aria-hidden="true"
      data-testid="infinite-scroll-sentinel"
    />
  );
}
