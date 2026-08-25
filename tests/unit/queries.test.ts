import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getHackathons,
  getHackathonBySlug,
  upsertHackathon,
  getAggregationLogs,
  updateRefreshMetadata,
  getRefreshMetadata,
} from '../../src/lib/db/queries';

// Mock drizzle-orm/d1 to verify query construction without a real D1 instance
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => mockOrm),
}));

// Build a chainable mock ORM that captures calls and returns controlled results
function createChainableMock(returnValue: any = []) {
  const mock: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'from', 'where', 'orderBy', 'limit', 'offset',
    'values', 'onConflictDoUpdate', 'set',
  ];
  for (const method of methods) {
    mock[method] = vi.fn(() => mock);
  }
  // Make the mock thenable so await resolves to returnValue
  mock.then = (resolve: any) => resolve(returnValue);
  return mock;
}

let mockOrm: any;

beforeEach(() => {
  vi.clearAllMocks();
  mockOrm = createChainableMock();
});

const fakeDb = {} as D1Database;

describe('getHackathons', () => {
  it('returns hackathons with default pagination', async () => {
    const fakeRows = [
      {
        id: '1',
        slug: 'test-hack',
        title: 'Test Hackathon',
        startDate: '2024-06-01',
        endDate: '2024-06-03',
        format: 'virtual',
        tags: '["ai", "web"]',
        organizer: 'TestOrg',
      },
    ];

    // First call for COUNT, second for rows
    let callCount = 0;
    mockOrm.then = (resolve: any) => {
      callCount++;
      if (callCount === 1) return resolve([{ count: 1 }]);
      return resolve(fakeRows);
    };

    const result = await getHackathons(fakeDb);

    expect(result.total).toBe(1);
    expect(result.hackathons).toHaveLength(1);
    expect(result.hackathons[0].title).toBe('Test Hackathon');
    expect(result.hackathons[0].tags).toEqual(['ai', 'web']);
  });

  it('truncates title to 80 characters with ellipsis', async () => {
    const longTitle = 'A'.repeat(100);
    const fakeRows = [
      {
        id: '2',
        slug: 'long-title',
        title: longTitle,
        startDate: '2024-06-01',
        endDate: null,
        format: 'in_person',
        tags: '[]',
        organizer: null,
      },
    ];

    let callCount = 0;
    mockOrm.then = (resolve: any) => {
      callCount++;
      if (callCount === 1) return resolve([{ count: 1 }]);
      return resolve(fakeRows);
    };

    const result = await getHackathons(fakeDb);

    expect(result.hackathons[0].title.length).toBeLessThanOrEqual(81); // 80 + ellipsis char
    expect(result.hackathons[0].title).toContain('…');
  });

  it('limits tags to 3 for card display', async () => {
    const fakeRows = [
      {
        id: '3',
        slug: 'many-tags',
        title: 'Many Tags Hack',
        startDate: '2024-07-01',
        endDate: null,
        format: 'hybrid',
        tags: '["ai", "web", "mobile", "cloud", "iot"]',
        organizer: null,
      },
    ];

    let callCount = 0;
    mockOrm.then = (resolve: any) => {
      callCount++;
      if (callCount === 1) return resolve([{ count: 1 }]);
      return resolve(fakeRows);
    };

    const result = await getHackathons(fakeDb);

    expect(result.hackathons[0].tags).toHaveLength(3);
    expect(result.hackathons[0].tags).toEqual(['ai', 'web', 'mobile']);
  });
});

describe('getHackathonBySlug', () => {
  it('returns hackathon detail when found', async () => {
    const fakeRow = {
      id: '1',
      slug: 'test-hack',
      title: 'Test Hackathon',
      description: 'A description',
      startDate: '2024-06-01',
      endDate: '2024-06-03',
      location: 'Virtual',
      format: 'virtual',
      organizer: 'TestOrg',
      prizes: '$10k',
      tags: '["ai"]',
      sourceUrl: 'https://example.com',
      sources: '["devpost"]',
      updatedAt: '2024-06-01T00:00:00Z',
      createdAt: '2024-06-01T00:00:00Z',
      lastSeenAt: '2024-06-01T00:00:00Z',
    };

    mockOrm.then = (resolve: any) => resolve([fakeRow]);

    const result = await getHackathonBySlug(fakeDb, 'test-hack');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('1');
    expect(result!.slug).toBe('test-hack');
    expect(result!.tags).toEqual(['ai']);
    expect(result!.sources).toEqual(['devpost']);
  });

  it('returns null when not found', async () => {
    mockOrm.then = (resolve: any) => resolve([]);

    const result = await getHackathonBySlug(fakeDb, 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('upsertHackathon', () => {
  it('calls insert with onConflictDoUpdate', async () => {
    const hackathon = {
      id: '1',
      slug: 'test-hack',
      title: 'Test Hackathon',
      description: 'desc',
      startDate: '2024-06-01',
      endDate: '2024-06-03',
      location: 'Virtual',
      format: 'virtual' as const,
      organizer: 'TestOrg',
      prizes: '$10k',
      sourceUrl: 'https://example.com',
      sources: ['devpost'],
      tags: ['ai'],
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
      lastSeenAt: '2024-06-01T00:00:00Z',
    };

    await upsertHackathon(fakeDb, hackathon);

    expect(mockOrm.insert).toHaveBeenCalled();
    expect(mockOrm.values).toHaveBeenCalled();
    expect(mockOrm.onConflictDoUpdate).toHaveBeenCalled();
  });
});

describe('getAggregationLogs', () => {
  it('returns logs ordered by timestamp desc with default limit', async () => {
    const fakeLogs = [
      { id: '1', timestamp: '2024-06-01T12:00:00Z', sourceName: 'devpost', status: 'success', eventsFound: 10, eventsCreated: 5, eventsUpdated: 3, errorMessage: null, errorType: null, durationMs: 1500 },
    ];

    mockOrm.then = (resolve: any) => resolve(fakeLogs);

    const result = await getAggregationLogs(fakeDb);

    expect(result).toHaveLength(1);
    expect(mockOrm.orderBy).toHaveBeenCalled();
    expect(mockOrm.limit).toHaveBeenCalled();
  });

  it('accepts custom limit', async () => {
    mockOrm.then = (resolve: any) => resolve([]);

    await getAggregationLogs(fakeDb, 5);

    expect(mockOrm.limit).toHaveBeenCalled();
  });
});

describe('updateRefreshMetadata', () => {
  it('calls insert with onConflictDoUpdate for singleton row', async () => {
    await updateRefreshMetadata(fakeDb, {
      lastRefreshAt: '2024-06-01T12:00:00Z',
      nextRefreshAt: '2024-06-01T13:00:00Z',
    });

    expect(mockOrm.insert).toHaveBeenCalled();
    expect(mockOrm.values).toHaveBeenCalled();
    expect(mockOrm.onConflictDoUpdate).toHaveBeenCalled();
  });
});

describe('getRefreshMetadata', () => {
  it('returns metadata when singleton row exists', async () => {
    const fakeMetadata = {
      id: 'singleton',
      lastRefreshAt: '2024-06-01T12:00:00Z',
      nextRefreshAt: '2024-06-01T13:00:00Z',
      intervalMinutes: 60,
      allSourcesFailed: false,
    };

    mockOrm.then = (resolve: any) => resolve([fakeMetadata]);

    const result = await getRefreshMetadata(fakeDb);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('singleton');
    expect(result!.intervalMinutes).toBe(60);
  });

  it('returns null when no metadata exists', async () => {
    mockOrm.then = (resolve: any) => resolve([]);

    const result = await getRefreshMetadata(fakeDb);

    expect(result).toBeNull();
  });
});
