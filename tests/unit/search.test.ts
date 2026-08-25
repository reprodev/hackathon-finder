import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeFtsQuery,
  buildFilterConditions,
  mapRowToSummary,
  searchHackathons,
  SearchQueryTooLongError,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  DEFAULT_PAGE_SIZE,
} from '../../src/lib/search';

// ─── sanitizeFtsQuery ─────────────────────────────────────────────────────────

describe('sanitizeFtsQuery', () => {
  it('wraps single word in quotes with wildcard', () => {
    expect(sanitizeFtsQuery('hello')).toBe('"hello"*');
  });

  it('wraps multiple words as separate quoted tokens with wildcards', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello"* "world"*');
  });

  it('removes single and double quotes', () => {
    expect(sanitizeFtsQuery("he'llo")).toBe('"hello"*');
    expect(sanitizeFtsQuery('he"llo')).toBe('"hello"*');
  });

  it('removes brackets and parentheses', () => {
    expect(sanitizeFtsQuery('hello(world)[test]{done}')).toBe('"helloworldtestdone"*');
  });

  it('removes FTS5 boolean operators (AND, OR, NOT, NEAR)', () => {
    expect(sanitizeFtsQuery('AI AND hackathon')).toBe('"AI"* "hackathon"*');
    expect(sanitizeFtsQuery('OR something NOT here')).toBe('"something"* "here"*');
    expect(sanitizeFtsQuery('NEAR test')).toBe('"test"*');
  });

  it('removes wildcards and boost characters', () => {
    expect(sanitizeFtsQuery('hello* ^world')).toBe('"hello"* "world"*');
  });

  it('returns empty string for input that is only special characters', () => {
    expect(sanitizeFtsQuery('*** ^^^ ()')).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeFtsQuery('  hello  ')).toBe('"hello"*');
  });

  it('handles empty string', () => {
    expect(sanitizeFtsQuery('')).toBe('');
  });
});

// ─── buildFilterConditions ────────────────────────────────────────────────────

describe('buildFilterConditions', () => {
  it('returns empty conditions for undefined filters', () => {
    const result = buildFilterConditions(undefined);
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual([]);
  });

  it('returns empty conditions for empty filter object', () => {
    const result = buildFilterConditions({});
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual([]);
  });

  it('builds format filter with IN clause', () => {
    const result = buildFilterConditions({ format: ['virtual', 'hybrid'] });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toBe('h.format IN (?, ?)');
    expect(result.params).toEqual(['virtual', 'hybrid']);
  });

  it('builds single format filter', () => {
    const result = buildFilterConditions({ format: ['in_person'] });
    expect(result.conditions[0]).toBe('h.format IN (?)');
    expect(result.params).toEqual(['in_person']);
  });

  it('builds date range start filter', () => {
    const result = buildFilterConditions({ dateRange: { start: '2024-01-01', end: '' } });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toBe('h.start_date >= ?');
    expect(result.params).toEqual(['2024-01-01']);
  });

  it('builds date range end filter', () => {
    const result = buildFilterConditions({ dateRange: { start: '', end: '2024-12-31' } });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toBe('h.start_date <= ?');
    expect(result.params).toEqual(['2024-12-31']);
  });

  it('builds full date range filter', () => {
    const result = buildFilterConditions({ dateRange: { start: '2024-01-01', end: '2024-12-31' } });
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[0]).toBe('h.start_date >= ?');
    expect(result.conditions[1]).toBe('h.start_date <= ?');
    expect(result.params).toEqual(['2024-01-01', '2024-12-31']);
  });

  it('builds tags filter with EXISTS/json_each subqueries', () => {
    const result = buildFilterConditions({ tags: ['ai', 'web3'] });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toContain('json_each');
    expect(result.conditions[0]).toContain(' OR ');
    expect(result.params).toEqual(['ai', 'web3']);
  });

  it('combines multiple filter types with separate conditions', () => {
    const result = buildFilterConditions({
      format: ['virtual'],
      dateRange: { start: '2024-06-01', end: '2024-06-30' },
      tags: ['blockchain'],
    });
    // format (1) + dateRange start (1) + dateRange end (1) + tags (1) = 4 conditions
    expect(result.conditions).toHaveLength(4);
    expect(result.params).toEqual(['virtual', '2024-06-01', '2024-06-30', 'blockchain']);
  });

  it('ignores empty format array', () => {
    const result = buildFilterConditions({ format: [] });
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual([]);
  });

  it('ignores empty tags array', () => {
    const result = buildFilterConditions({ tags: [] });
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual([]);
  });
});

// ─── mapRowToSummary ──────────────────────────────────────────────────────────

describe('mapRowToSummary', () => {
  it('maps a complete row to HackathonSummary', () => {
    const row = {
      id: 'abc123',
      slug: 'ai-hackathon-2024',
      title: 'AI Hackathon 2024',
      start_date: '2024-06-15',
      end_date: '2024-06-17',
      format: 'virtual',
      tags: '["ai","ml","python"]',
      organizer: 'TechCorp',
    };
    const result = mapRowToSummary(row);
    expect(result).toEqual({
      id: 'abc123',
      slug: 'ai-hackathon-2024',
      title: 'AI Hackathon 2024',
      startDate: '2024-06-15',
      endDate: '2024-06-17',
      format: 'virtual',
      tags: ['ai', 'ml', 'python'],
      organizer: 'TechCorp',
    });
  });

  it('truncates title to 80 characters with ellipsis', () => {
    const longTitle = 'A'.repeat(100);
    const row = {
      id: '1',
      slug: 'long-title',
      title: longTitle,
      start_date: '2024-01-01',
      end_date: null,
      format: 'hybrid',
      tags: '[]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.title).toHaveLength(81); // 80 chars + ellipsis char
    expect(result.title).toBe('A'.repeat(80) + '\u2026');
  });

  it('does not truncate title of exactly 80 characters', () => {
    const title80 = 'B'.repeat(80);
    const row = {
      id: '2',
      slug: 'exact-80',
      title: title80,
      start_date: '2024-01-01',
      end_date: null,
      format: 'in_person',
      tags: '[]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.title).toBe(title80);
    expect(result.title).toHaveLength(80);
  });

  it('limits tags to a maximum of 3', () => {
    const row = {
      id: '3',
      slug: 'many-tags',
      title: 'Many Tags Event',
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '["a","b","c","d","e"]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.tags).toEqual(['a', 'b', 'c']);
    expect(result.tags).toHaveLength(3);
  });

  it('handles null end_date', () => {
    const row = {
      id: '4',
      slug: 'no-end',
      title: 'No End Date',
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '[]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.endDate).toBeNull();
  });

  it('handles null organizer', () => {
    const row = {
      id: '5',
      slug: 'no-org',
      title: 'No Organizer',
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '[]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.organizer).toBeNull();
  });

  it('handles empty tags JSON array', () => {
    const row = {
      id: '6',
      slug: 'empty-tags',
      title: 'Empty Tags',
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '[]',
      organizer: null,
    };
    const result = mapRowToSummary(row);
    expect(result.tags).toEqual([]);
  });
});

// ─── searchHackathons ─────────────────────────────────────────────────────────

describe('searchHackathons', () => {
  /**
   * Create a mock D1Database that tracks SQL calls and returns canned results.
   */
  function createMockDb(options?: {
    total?: number;
    rows?: Record<string, unknown>[];
  }): D1Database {
    const total = options?.total ?? 0;
    const rows = options?.rows ?? [];

    const mockFirst = vi.fn().mockResolvedValue({ total });
    const mockAll = vi.fn().mockResolvedValue({ results: rows });

    let callCount = 0;
    const mockBind = vi.fn().mockImplementation((..._args: unknown[]) => {
      callCount++;
      // First call is count query, second is data query
      if (callCount % 2 === 1) {
        return { first: mockFirst, all: mockAll, bind: mockBind };
      }
      return { first: mockFirst, all: mockAll, bind: mockBind };
    });

    const mockPrepare = vi.fn().mockImplementation((_sql: string) => {
      return { bind: mockBind, first: mockFirst, all: mockAll };
    });

    return {
      prepare: mockPrepare,
    } as unknown as D1Database;
  }

  it('throws SearchQueryTooLongError for queries exceeding 200 characters', async () => {
    const db = createMockDb();
    const longQuery = 'a'.repeat(201);

    await expect(searchHackathons(db, longQuery)).rejects.toThrow(SearchQueryTooLongError);
    await expect(searchHackathons(db, longQuery)).rejects.toThrow(
      'Query exceeds maximum length of 200 characters (got 201)'
    );
  });

  it('does not throw for query of exactly 200 characters', async () => {
    const db = createMockDb({ total: 0, rows: [] });
    const query200 = 'a'.repeat(200);

    await expect(searchHackathons(db, query200)).resolves.toBeDefined();
  });

  it('returns unfiltered results for empty query (< 2 chars)', async () => {
    const mockRows = [
      {
        id: '1',
        slug: 'test-hack',
        title: 'Test Hack',
        start_date: '2024-01-01',
        end_date: null,
        format: 'virtual',
        tags: '["ai"]',
        organizer: null,
      },
    ];
    const db = createMockDb({ total: 1, rows: mockRows });

    const result = await searchHackathons(db, '');
    expect(result.total).toBe(1);
    expect(result.hackathons).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('returns unfiltered results for single character query', async () => {
    const db = createMockDb({ total: 5, rows: [] });
    const result = await searchHackathons(db, 'a');
    expect(result.total).toBe(5);
  });

  it('uses FTS5 search for queries >= 2 characters', async () => {
    const db = createMockDb({ total: 2, rows: [] });
    await searchHackathons(db, 'ai hackathon');

    // Should call prepare with FTS5 MATCH query
    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const sqlStatements = prepareCalls.map((call) => call[0] as string);

    // At least one SQL statement should contain MATCH and bm25
    const hasFtsQuery = sqlStatements.some(
      (sql) => sql.includes('MATCH') && sql.includes('bm25')
    );
    expect(hasFtsQuery).toBe(true);
  });

  it('does not use FTS5 for empty query', async () => {
    const db = createMockDb({ total: 0, rows: [] });
    await searchHackathons(db, '');

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const sqlStatements = prepareCalls.map((call) => call[0] as string);

    const hasFtsQuery = sqlStatements.some((sql) => sql.includes('MATCH'));
    expect(hasFtsQuery).toBe(false);
  });

  it('applies default pagination (page 1, pageSize 12)', async () => {
    const db = createMockDb({ total: 0, rows: [] });
    const result = await searchHackathons(db, '');

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(12);
  });

  it('applies custom pagination', async () => {
    const db = createMockDb({ total: 50, rows: [] });
    const result = await searchHackathons(db, '', undefined, { page: 3, pageSize: 10 });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it('calculates hasMore correctly when more results exist', async () => {
    const mockRows = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      slug: `hack-${i}`,
      title: `Hackathon ${i}`,
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '[]',
      organizer: null,
    }));
    const db = createMockDb({ total: 25, rows: mockRows });
    const result = await searchHackathons(db, '');

    expect(result.hasMore).toBe(true);
  });

  it('calculates hasMore as false when on last page', async () => {
    const mockRows = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      slug: `hack-${i}`,
      title: `Hackathon ${i}`,
      start_date: '2024-01-01',
      end_date: null,
      format: 'virtual',
      tags: '[]',
      organizer: null,
    }));
    // total=17, page 2 with pageSize 12 => offset=12, 5 items returned, 12+5=17 == total
    const db = createMockDb({ total: 17, rows: mockRows });
    const result = await searchHackathons(db, '', undefined, { page: 2, pageSize: 12 });

    expect(result.hasMore).toBe(false);
  });

  it('applies filters alongside empty query', async () => {
    const db = createMockDb({ total: 3, rows: [] });
    await searchHackathons(db, '', { format: ['virtual'] });

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const sqlStatements = prepareCalls.map((call) => call[0] as string);

    const hasFormatFilter = sqlStatements.some((sql) => sql.includes('h.format IN'));
    expect(hasFormatFilter).toBe(true);
  });

  it('applies filters alongside FTS5 search', async () => {
    const db = createMockDb({ total: 2, rows: [] });
    await searchHackathons(db, 'machine learning', { format: ['hybrid'] });

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const sqlStatements = prepareCalls.map((call) => call[0] as string);

    const hasBothFtsAndFilter = sqlStatements.some(
      (sql) => sql.includes('MATCH') && sql.includes('h.format IN')
    );
    expect(hasBothFtsAndFilter).toBe(true);
  });

  it('falls back to unfiltered when sanitized query is empty', async () => {
    const db = createMockDb({ total: 10, rows: [] });
    // Query with only special characters that get stripped
    await searchHackathons(db, '***');

    const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const sqlStatements = prepareCalls.map((call) => call[0] as string);

    const hasFtsQuery = sqlStatements.some((sql) => sql.includes('MATCH'));
    expect(hasFtsQuery).toBe(false);
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Search constants', () => {
  it('MAX_QUERY_LENGTH is 200', () => {
    expect(MAX_QUERY_LENGTH).toBe(200);
  });

  it('MIN_QUERY_LENGTH is 2', () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it('DEFAULT_PAGE_SIZE is 12', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(12);
  });
});
