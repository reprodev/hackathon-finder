import type { HackathonSummary, Format } from '../lib/types';

/**
 * Formats a date range for display.
 * Examples: "Jun 15 - Jun 17, 2024" or "Jun 15, 2024" if no end date.
 */
function formatDateRange(startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const monthDay: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const full: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

  if (!endDate) {
    return start.toLocaleDateString('en-US', full);
  }

  const end = new Date(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const sameDay = sameMonth && start.getDate() === end.getDate();

  if (sameDay) {
    return start.toLocaleDateString('en-US', full);
  }

  if (sameYear) {
    return `${start.toLocaleDateString('en-US', monthDay)} - ${end.toLocaleDateString('en-US', full)}`;
  }

  return `${start.toLocaleDateString('en-US', full)} - ${end.toLocaleDateString('en-US', full)}`;
}

/**
 * Truncates a title to maxLength characters, appending ellipsis if truncated.
 */
function truncateTitle(title: string, maxLength: number = 80): string {
  if (title.length <= maxLength) {
    return title;
  }
  return title.slice(0, maxLength) + '…';
}

/**
 * Determines deadline status based on endDate relative to now.
 * Returns 'ending_soon' if within 7 days, 'ended' if past, null otherwise.
 */
function getDeadlineStatus(endDate: string | null): 'ending_soon' | 'ended' | null {
  if (!endDate) return null;
  const end = new Date(endDate);
  const now = new Date();
  const daysLeft = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 0) return 'ended';
  if (daysLeft <= 7) return 'ending_soon';
  return null;
}

/** Format badge color mappings */
const formatConfig: Record<Format, { label: string; classes: string }> = {
  virtual: { label: 'Virtual', classes: 'bg-green-900/60 text-green-300 border-green-700' },
  in_person: { label: 'In Person', classes: 'bg-blue-900/60 text-blue-300 border-blue-700' },
  hybrid: { label: 'Hybrid', classes: 'bg-purple-900/60 text-purple-300 border-purple-700' },
};

export interface HackathonCardProps {
  hackathon: HackathonSummary;
}

/**
 * HackathonCard component displays a summary of a hackathon event.
 * Renders as a clickable card linking to the hackathon detail page.
 *
 * - Title truncated to 80 chars with ellipsis
 * - Date range formatted with Intl.DateTimeFormat
 * - Format badge (colored pill)
 * - Up to 3 tags as chips
 * - Organizer name if present
 * - Dark theme styling with hover lift effect
 */
export default function HackathonCard({ hackathon }: HackathonCardProps) {
  const { slug, title, startDate, endDate, format, tags, organizer } = hackathon;
  const displayTitle = truncateTitle(title);
  const dateRange = formatDateRange(startDate, endDate);
  const displayTags = tags.slice(0, 3);
  const badge = formatConfig[format];
  const deadlineStatus = getDeadlineStatus(endDate);

  return (
    <a
      href={`/hackathons/${slug}`}
      className="group block rounded-lg border border-gray-700 bg-gray-800 p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/30 hover:border-gray-600"
    >
      {/* Format badge + deadline badge */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}
        >
          {badge.label}
        </span>
        {deadlineStatus === 'ending_soon' && (
          <span className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium bg-orange-900/60 text-orange-300 border-orange-700">
            Ending Soon
          </span>
        )}
        {deadlineStatus === 'ended' && (
          <span className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium bg-gray-700/60 text-gray-400 border-gray-600">
            Ended
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="mt-3 text-lg font-semibold text-gray-100 group-hover:text-white leading-snug">
        {displayTitle}
      </h3>

      {/* Date range */}
      <p className="mt-2 text-sm text-gray-400">
        <svg
          className="inline-block mr-1.5 h-4 w-4 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        {dateRange}
      </p>

      {/* Tags */}
      {displayTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {displayTags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Organizer */}
      {organizer && (
        <p className="mt-3 text-xs text-gray-500">
          by {organizer}
        </p>
      )}
    </a>
  );
}

export { truncateTitle, formatDateRange, getDeadlineStatus };
