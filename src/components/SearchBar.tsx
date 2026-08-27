import { useState, useEffect, useRef } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  initialQuery?: string;
  disabled?: boolean;
  error?: string;
}

export default function SearchBar({
  onSearch,
  initialQuery = "",
  disabled = false,
  error,
}: SearchBarProps) {
  const [value, setValue] = useState(initialQuery);
  const [debouncedValue, setDebouncedValue] = useState(initialQuery);
  const isFirstRender = useRef(true);

  // Debounce the input value (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, 300);

    return () => clearTimeout(timer);
  }, [value]);

  // Emit search when debounced value changes (skip first render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onSearch(debouncedValue);
  }, [debouncedValue, onSearch]);

  const handleClear = () => {
    setValue("");
  };

  return (
    <div className="w-full">
      <div className="relative">
        {/* Search icon */}
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <svg
            className="h-5 w-5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>

        {/* Input */}
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder="Search hackathons by name, tag, or topic..."
          aria-label="Search hackathons"
          aria-invalid={!!error}
          aria-describedby={error ? "search-error" : undefined}
          className={`block w-full rounded-lg border bg-gray-800 py-3 pl-10 pr-10 text-sm text-white placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${
            error
              ? "border-red-500 focus:ring-red-500"
              : "border-gray-700 hover:border-gray-600 focus:border-cyan-400"
          }`}
        />

        {/* Clear button */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p id="search-error" className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
