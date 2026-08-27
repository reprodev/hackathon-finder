/**
 * FilterPanel React component for hackathon queries.
 *
 * Provides date range (presets + custom), format (checkboxes), and tag (chips) filters.
 * Implements AND logic across filter types and OR within each type.
 * Collapsible on mobile, dark-themed, validates custom date ranges.
 *
 * Requirements satisfied: 3.1, 3.2, 3.4, 3.5, 6.2
 */

import { useState, useCallback, useEffect } from 'react';
import type { FilterCriteria, Format } from '../lib/types';
import { validateDateRange, getDateRangePreset, type DateRangePreset } from '../lib/filters';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FilterPanelProps {
  onFilterChange: (filters: FilterCriteria) => void;
  initialFilters?: FilterCriteria;
  availableTags?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TAGS = [
  'ai',
  'web3',
  'mobile',
  'blockchain',
  'healthcare',
  'education',
  'fintech',
  'gaming',
  'climate',
  'social-impact',
];

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: 'virtual', label: 'Virtual' },
  { value: 'in_person', label: 'In-Person' },
  { value: 'hybrid', label: 'Hybrid' },
];

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
];

// ─── Sub-Components ───────────────────────────────────────────────────────────

/** Date range filter with preset buttons and custom date inputs */
function DateRangeFilter({
  dateRange,
  activePreset,
  dateError,
  onPresetSelect,
  onCustomDateChange,
  onClearDate,
}: {
  dateRange?: { start: string; end: string };
  activePreset: DateRangePreset | null;
  dateError: string | null;
  onPresetSelect: (preset: DateRangePreset) => void;
  onCustomDateChange: (field: 'start' | 'end', value: string) => void;
  onClearDate: () => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Date Range</h3>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onPresetSelect(preset.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activePreset === preset.value
                ? 'bg-cyan-500 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {preset.label}
          </button>
        ))}
        {(activePreset || dateRange) && (
          <button
            type="button"
            onClick={onClearDate}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            aria-label="Clear date filter"
          >
            Clear
          </button>
        )}
      </div>

      {/* Custom date inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="filter-date-start" className="block text-xs text-gray-400 mb-1">
            Start
          </label>
          <input
            id="filter-date-start"
            type="date"
            value={activePreset ? '' : dateRange?.start ?? ''}
            onChange={(e) => onCustomDateChange('start', e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
        </div>
        <div>
          <label htmlFor="filter-date-end" className="block text-xs text-gray-400 mb-1">
            End
          </label>
          <input
            id="filter-date-end"
            type="date"
            value={activePreset ? '' : dateRange?.end ?? ''}
            onChange={(e) => onCustomDateChange('end', e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
        </div>
      </div>

      {/* Validation error */}
      {dateError && (
        <p className="text-xs text-red-400" role="alert">
          {dateError}
        </p>
      )}
    </div>
  );
}

/** Format filter with checkboxes */
function FormatFilter({
  selectedFormats,
  onToggle,
}: {
  selectedFormats: Format[];
  onToggle: (format: Format) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Format</h3>
      <div className="space-y-2">
        {FORMAT_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={selectedFormats.includes(option.value)}
              onChange={() => onToggle(option.value)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-0"
            />
            <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Tag filter with selectable chips */
function TagFilter({
  availableTags,
  selectedTags,
  onToggle,
}: {
  availableTags: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-300">Tags</h3>
      <div className="flex flex-wrap gap-2">
        {availableTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-cyan-500 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
              aria-pressed={isSelected}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main FilterPanel ─────────────────────────────────────────────────────────

export default function FilterPanel({
  onFilterChange,
  initialFilters,
  availableTags = DEFAULT_TAGS,
}: FilterPanelProps) {
  // Internal filter state
  const [selectedFormats, setSelectedFormats] = useState<Format[]>(
    initialFilters?.format ?? []
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    initialFilters?.tags ?? []
  );
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | undefined>(
    initialFilters?.dateRange
  );
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Emit filter changes to parent
  const emitFilters = useCallback(
    (formats: Format[], tags: string[], range?: { start: string; end: string }) => {
      const filters: FilterCriteria = {};
      if (formats.length > 0) filters.format = formats;
      if (tags.length > 0) filters.tags = tags;
      if (range) filters.dateRange = range;
      onFilterChange(filters);
    },
    [onFilterChange]
  );

  // Sync initial filters on mount
  useEffect(() => {
    if (initialFilters) {
      setSelectedFormats(initialFilters.format ?? []);
      setSelectedTags(initialFilters.tags ?? []);
      setDateRange(initialFilters.dateRange);
    }
  }, [initialFilters]);

  // ─── Date Range Handlers ──────────────────────────────────────────────────

  const handlePresetSelect = useCallback(
    (preset: DateRangePreset) => {
      if (activePreset === preset) {
        // Toggle off
        setActivePreset(null);
        setDateRange(undefined);
        setDateError(null);
        emitFilters(selectedFormats, selectedTags, undefined);
      } else {
        const range = getDateRangePreset(preset);
        setActivePreset(preset);
        setDateRange(range);
        setDateError(null);
        emitFilters(selectedFormats, selectedTags, range);
      }
    },
    [activePreset, selectedFormats, selectedTags, emitFilters]
  );

  const handleCustomDateChange = useCallback(
    (field: 'start' | 'end', value: string) => {
      setActivePreset(null);
      const newRange = {
        start: field === 'start' ? value : (dateRange?.start ?? ''),
        end: field === 'end' ? value : (dateRange?.end ?? ''),
      };
      setDateRange(newRange);

      // Validate if both dates are provided
      if (newRange.start && newRange.end) {
        const validation = validateDateRange(newRange.start, newRange.end);
        if (!validation.valid) {
          setDateError(validation.error ?? 'Invalid date range');
          return; // Don't emit invalid filters
        }
      }

      setDateError(null);
      // Only emit if at least one date is provided
      if (newRange.start || newRange.end) {
        emitFilters(selectedFormats, selectedTags, newRange);
      } else {
        emitFilters(selectedFormats, selectedTags, undefined);
      }
    },
    [dateRange, selectedFormats, selectedTags, emitFilters]
  );

  const handleClearDate = useCallback(() => {
    setActivePreset(null);
    setDateRange(undefined);
    setDateError(null);
    emitFilters(selectedFormats, selectedTags, undefined);
  }, [selectedFormats, selectedTags, emitFilters]);

  // ─── Format Handlers ──────────────────────────────────────────────────────

  const handleFormatToggle = useCallback(
    (format: Format) => {
      const newFormats = selectedFormats.includes(format)
        ? selectedFormats.filter((f) => f !== format)
        : [...selectedFormats, format];
      setSelectedFormats(newFormats);
      emitFilters(newFormats, selectedTags, dateRange);
    },
    [selectedFormats, selectedTags, dateRange, emitFilters]
  );

  // ─── Tag Handlers ─────────────────────────────────────────────────────────

  const handleTagToggle = useCallback(
    (tag: string) => {
      const newTags = selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag];
      setSelectedTags(newTags);
      emitFilters(selectedFormats, newTags, dateRange);
    },
    [selectedTags, selectedFormats, dateRange, emitFilters]
  );

  // ─── Clear All ────────────────────────────────────────────────────────────

  const handleClearAll = useCallback(() => {
    setSelectedFormats([]);
    setSelectedTags([]);
    setDateRange(undefined);
    setActivePreset(null);
    setDateError(null);
    onFilterChange({});
  }, [onFilterChange]);

  // ─── Computed ─────────────────────────────────────────────────────────────

  const hasActiveFilters =
    selectedFormats.length > 0 || selectedTags.length > 0 || !!dateRange;

  const activeFilterCount =
    (selectedFormats.length > 0 ? 1 : 0) +
    (selectedTags.length > 0 ? 1 : 0) +
    (dateRange ? 1 : 0);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <aside
      className="rounded-lg border border-gray-800 bg-gray-900/50"
      aria-label="Filter hackathons"
    >
      {/* Mobile toggle header */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between px-4 py-3 md:hidden"
        aria-expanded={!isCollapsed}
        aria-controls="filter-panel-content"
      >
        <span className="text-sm font-medium text-gray-200">
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-xs text-white">
              {activeFilterCount}
            </span>
          )}
        </span>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${!isCollapsed ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Filter content — hidden on mobile when collapsed, always visible on md+ */}
      <div
        id="filter-panel-content"
        className={`space-y-6 px-4 pb-4 ${isCollapsed ? 'hidden md:block' : 'block'} md:pt-4`}
      >
        {/* Header with Clear All (visible on desktop) */}
        <div className="hidden md:flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Filters</h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Date Range Section */}
        <DateRangeFilter
          dateRange={dateRange}
          activePreset={activePreset}
          dateError={dateError}
          onPresetSelect={handlePresetSelect}
          onCustomDateChange={handleCustomDateChange}
          onClearDate={handleClearDate}
        />

        {/* Divider */}
        <hr className="border-gray-800" />

        {/* Format Section */}
        <FormatFilter
          selectedFormats={selectedFormats}
          onToggle={handleFormatToggle}
        />

        {/* Divider */}
        <hr className="border-gray-800" />

        {/* Tags Section */}
        <TagFilter
          availableTags={availableTags}
          selectedTags={selectedTags}
          onToggle={handleTagToggle}
        />

        {/* Clear All button (mobile) */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="mt-4 w-full rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors md:hidden"
          >
            Clear All Filters
          </button>
        )}
      </div>
    </aside>
  );
}
