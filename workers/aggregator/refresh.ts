/**
 * Refresh interval validation and cache staleness logic.
 *
 * Requirements satisfied:
 * - 1.3: Configurable schedule with minimum interval of 15 minutes
 * - 1.5: Cache staleness detection (stale if not refreshed within 2 × interval)
 */

/**
 * Validates that a refresh interval is at least 15 minutes.
 * Returns a validation result indicating whether the interval is acceptable.
 */
export function validateRefreshInterval(minutes: number): { valid: boolean; error?: string } {
  if (!Number.isFinite(minutes) || Number.isNaN(minutes)) {
    return { valid: false, error: 'Refresh interval must be a finite number' };
  }

  if (minutes < 15) {
    return { valid: false, error: 'Refresh interval must be at least 15 minutes' };
  }

  return { valid: true };
}

/**
 * Determines whether cached data is stale.
 *
 * Cached data is considered stale if the current time exceeds
 * lastRefreshAt + (2 × intervalMinutes).
 *
 * @param lastRefreshAt - ISO 8601 timestamp of the last successful refresh
 * @param intervalMinutes - The configured refresh interval in minutes
 * @param currentTime - Optional current time (defaults to now)
 * @returns true if the cache is stale, false otherwise
 */
export function isCacheStale(
  lastRefreshAt: string,
  intervalMinutes: number,
  currentTime?: Date
): boolean {
  const now = currentTime ?? new Date();
  const lastRefresh = new Date(lastRefreshAt);
  const stalenessThresholdMs = 2 * intervalMinutes * 60 * 1000;
  const staleAfter = lastRefresh.getTime() + stalenessThresholdMs;

  return now.getTime() > staleAfter;
}

/**
 * Calculates the next scheduled refresh time as an ISO 8601 timestamp.
 *
 * @param intervalMinutes - The configured refresh interval in minutes
 * @param fromTime - Optional start time (defaults to now)
 * @returns ISO 8601 timestamp of the next refresh
 */
export function calculateNextRefreshAt(intervalMinutes: number, fromTime?: Date): string {
  const from = fromTime ?? new Date();
  const nextRefreshMs = from.getTime() + intervalMinutes * 60 * 1000;
  return new Date(nextRefreshMs).toISOString();
}
