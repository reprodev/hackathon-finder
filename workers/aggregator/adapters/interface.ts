/**
 * Source adapter interface and base types for the hackathon aggregation worker.
 *
 * Each external event source (Devpost, MLH, HackerEarth) implements the
 * EventSourceAdapter interface to provide a uniform fetching contract.
 */

/**
 * Raw hackathon event data as returned by an external source before normalization.
 */
export interface RawHackathonEvent {
  /** Hackathon title */
  title: string;
  /** Full description of the event */
  description?: string;
  /** Start date in ISO 8601 format */
  startDate: string;
  /** End date in ISO 8601 format */
  endDate?: string;
  /** Physical location or "Online" / "Virtual" */
  location?: string;
  /** Organization or person hosting the hackathon */
  organizer?: string;
  /** Prize information (free-form text) */
  prizes?: string;
  /** Tags or categories associated with the event */
  tags?: string[];
  /** Canonical URL to the event on the source platform */
  url: string;
  /** Name of the source platform (e.g., "devpost", "mlh", "hackerearth") */
  source: string;
}

/**
 * Common interface that all event source adapters must implement.
 *
 * Each adapter is responsible for fetching raw hackathon data from a single
 * external source and reporting its own health status.
 */
export interface EventSourceAdapter {
  /** Human-readable name identifying this source (e.g., "Devpost") */
  readonly name: string;
  /** Whether this adapter is currently enabled for fetching */
  readonly enabled: boolean;

  /**
   * Fetch hackathon events from the external source.
   * @returns Array of raw hackathon events in the source's native shape
   * @throws If the source is unreachable or returns an unrecoverable error
   */
  fetch(): Promise<RawHackathonEvent[]>;

  /**
   * Check whether the external source is reachable and responding.
   * @returns true if the source is healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;
}
