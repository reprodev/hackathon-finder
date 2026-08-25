import { describe, it, expect } from 'vitest';
import {
  merge,
  mergeTags,
  pickLongerText,
  pickHigherPrecedenceFormat,
  type ExistingHackathon,
  type NormalizedHackathon,
} from '../../workers/aggregator/deduplicator';

function makeExisting(overrides: Partial<ExistingHackathon> = {}): ExistingHackathon {
  return {
    id: 'existing-id-1',
    slug: 'existing-hackathon',
    title: 'Existing Hackathon',
    description: 'Short description',
    startDate: '2024-06-01T00:00:00Z',
    endDate: null,
    location: null,
    format: 'virtual',
    organizer: null,
    prizes: null,
    sourceUrl: 'https://devpost.com/existing',
    sources: ['devpost'],
    tags: ['ai', 'web'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastSeenAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeIncoming(overrides: Partial<NormalizedHackathon> = {}): NormalizedHackathon {
  return {
    title: 'Existing Hackathon',
    description: 'A much longer description that provides more detail about the hackathon event',
    startDate: '2024-06-01T00:00:00Z',
    endDate: '2024-06-03T00:00:00Z',
    location: 'San Francisco, CA',
    format: 'in_person',
    organizer: 'MLH',
    prizes: '$10,000 in prizes',
    tags: ['ml', 'web', 'cloud'],
    sourceUrl: 'https://mlh.io/events/existing',
    sourceName: 'mlh',
    ...overrides,
  };
}

describe('Deduplication Engine - merge()', () => {
  describe('Source merging', () => {
    it('should combine sources from both records into a union', () => {
      const existing = makeExisting({ sources: ['devpost'] });
      const incoming = makeIncoming({ sourceName: 'mlh' });

      const result = merge(existing, incoming);

      expect(result.sources).toContain('devpost');
      expect(result.sources).toContain('mlh');
      expect(result.sources).toHaveLength(2);
    });

    it('should not duplicate sources if same source appears again', () => {
      const existing = makeExisting({ sources: ['devpost', 'mlh'] });
      const incoming = makeIncoming({ sourceName: 'mlh' });

      const result = merge(existing, incoming);

      expect(result.sources).toEqual(['devpost', 'mlh']);
    });

    it('should handle existing record with multiple sources', () => {
      const existing = makeExisting({ sources: ['devpost', 'hackerearth'] });
      const incoming = makeIncoming({ sourceName: 'mlh' });

      const result = merge(existing, incoming);

      expect(result.sources).toContain('devpost');
      expect(result.sources).toContain('hackerearth');
      expect(result.sources).toContain('mlh');
      expect(result.sources).toHaveLength(3);
    });
  });

  describe('Description merging (prefer longer)', () => {
    it('should keep the longer description from incoming', () => {
      const existing = makeExisting({ description: 'Short' });
      const incoming = makeIncoming({
        description: 'This is a much longer description that should be preferred',
      });

      const result = merge(existing, incoming);

      expect(result.description).toBe(
        'This is a much longer description that should be preferred'
      );
    });

    it('should keep the longer description from existing', () => {
      const existing = makeExisting({
        description: 'This is a long existing description with lots of detail',
      });
      const incoming = makeIncoming({ description: 'Brief' });

      const result = merge(existing, incoming);

      expect(result.description).toBe(
        'This is a long existing description with lots of detail'
      );
    });

    it('should keep incoming description when existing is null', () => {
      const existing = makeExisting({ description: null });
      const incoming = makeIncoming({ description: 'New description' });

      const result = merge(existing, incoming);

      expect(result.description).toBe('New description');
    });

    it('should keep existing description when incoming is null', () => {
      const existing = makeExisting({ description: 'Existing desc' });
      const incoming = makeIncoming({ description: null });

      const result = merge(existing, incoming);

      expect(result.description).toBe('Existing desc');
    });

    it('should return null when both descriptions are null', () => {
      const existing = makeExisting({ description: null });
      const incoming = makeIncoming({ description: null });

      const result = merge(existing, incoming);

      expect(result.description).toBeNull();
    });
  });

  describe('Tag merging (union, deduplicated, max 20)', () => {
    it('should combine tags from both records', () => {
      const existing = makeExisting({ tags: ['ai', 'web'] });
      const incoming = makeIncoming({ tags: ['ml', 'cloud'] });

      const result = merge(existing, incoming);

      expect(result.tags).toContain('ai');
      expect(result.tags).toContain('web');
      expect(result.tags).toContain('ml');
      expect(result.tags).toContain('cloud');
    });

    it('should deduplicate tags (case-insensitive)', () => {
      const existing = makeExisting({ tags: ['AI', 'Web'] });
      const incoming = makeIncoming({ tags: ['ai', 'cloud'] });

      const result = merge(existing, incoming);

      // Should keep the first occurrence (from existing)
      expect(result.tags).toContain('AI');
      expect(result.tags).toContain('Web');
      expect(result.tags).toContain('cloud');
      expect(result.tags).toHaveLength(3);
    });

    it('should cap merged tags at 20', () => {
      const existing = makeExisting({
        tags: Array.from({ length: 15 }, (_, i) => `tag-existing-${i}`),
      });
      const incoming = makeIncoming({
        tags: Array.from({ length: 15 }, (_, i) => `tag-incoming-${i}`),
      });

      const result = merge(existing, incoming);

      expect(result.tags.length).toBeLessThanOrEqual(20);
    });

    it('should handle empty tags on one side', () => {
      const existing = makeExisting({ tags: [] });
      const incoming = makeIncoming({ tags: ['ai', 'ml'] });

      const result = merge(existing, incoming);

      expect(result.tags).toEqual(['ai', 'ml']);
    });
  });

  describe('Format precedence (in_person > hybrid > virtual)', () => {
    it('should prefer in_person over virtual', () => {
      const existing = makeExisting({ format: 'virtual' });
      const incoming = makeIncoming({ format: 'in_person' });

      const result = merge(existing, incoming);

      expect(result.format).toBe('in_person');
    });

    it('should prefer in_person over hybrid', () => {
      const existing = makeExisting({ format: 'hybrid' });
      const incoming = makeIncoming({ format: 'in_person' });

      const result = merge(existing, incoming);

      expect(result.format).toBe('in_person');
    });

    it('should prefer hybrid over virtual', () => {
      const existing = makeExisting({ format: 'virtual' });
      const incoming = makeIncoming({ format: 'hybrid' });

      const result = merge(existing, incoming);

      expect(result.format).toBe('hybrid');
    });

    it('should keep in_person when existing is in_person and incoming is virtual', () => {
      const existing = makeExisting({ format: 'in_person' });
      const incoming = makeIncoming({ format: 'virtual' });

      const result = merge(existing, incoming);

      expect(result.format).toBe('in_person');
    });

    it('should keep hybrid when both are hybrid', () => {
      const existing = makeExisting({ format: 'hybrid' });
      const incoming = makeIncoming({ format: 'hybrid' });

      const result = merge(existing, incoming);

      expect(result.format).toBe('hybrid');
    });
  });

  describe('Other field merging', () => {
    it('should keep existing organizer when both are non-null', () => {
      const existing = makeExisting({ organizer: 'Devpost Org' });
      const incoming = makeIncoming({ organizer: 'MLH Org' });

      const result = merge(existing, incoming);

      expect(result.organizer).toBe('Devpost Org');
    });

    it('should use incoming organizer when existing is null', () => {
      const existing = makeExisting({ organizer: null });
      const incoming = makeIncoming({ organizer: 'MLH Org' });

      const result = merge(existing, incoming);

      expect(result.organizer).toBe('MLH Org');
    });

    it('should keep existing endDate when both are non-null', () => {
      const existing = makeExisting({ endDate: '2024-06-02T00:00:00Z' });
      const incoming = makeIncoming({ endDate: '2024-06-03T00:00:00Z' });

      const result = merge(existing, incoming);

      expect(result.endDate).toBe('2024-06-02T00:00:00Z');
    });

    it('should use incoming endDate when existing is null', () => {
      const existing = makeExisting({ endDate: null });
      const incoming = makeIncoming({ endDate: '2024-06-03T00:00:00Z' });

      const result = merge(existing, incoming);

      expect(result.endDate).toBe('2024-06-03T00:00:00Z');
    });

    it('should keep existing location when both are non-null', () => {
      const existing = makeExisting({ location: 'New York' });
      const incoming = makeIncoming({ location: 'San Francisco' });

      const result = merge(existing, incoming);

      expect(result.location).toBe('New York');
    });

    it('should use incoming location when existing is null', () => {
      const existing = makeExisting({ location: null });
      const incoming = makeIncoming({ location: 'San Francisco' });

      const result = merge(existing, incoming);

      expect(result.location).toBe('San Francisco');
    });

    it('should prefer longer prizes text', () => {
      const existing = makeExisting({ prizes: '$5k' });
      const incoming = makeIncoming({ prizes: '$10,000 in cash prizes and mentorship' });

      const result = merge(existing, incoming);

      expect(result.prizes).toBe('$10,000 in cash prizes and mentorship');
    });

    it('should use incoming prizes when existing is null', () => {
      const existing = makeExisting({ prizes: null });
      const incoming = makeIncoming({ prizes: '$10,000' });

      const result = merge(existing, incoming);

      expect(result.prizes).toBe('$10,000');
    });
  });

  describe('Preserved fields', () => {
    it('should preserve existing id, slug, createdAt, title, startDate, sourceUrl', () => {
      const existing = makeExisting({
        id: 'keep-this-id',
        slug: 'keep-this-slug',
        title: 'Original Title',
        startDate: '2024-06-01T00:00:00Z',
        sourceUrl: 'https://devpost.com/original',
        createdAt: '2024-01-01T00:00:00Z',
      });
      const incoming = makeIncoming();

      const result = merge(existing, incoming);

      expect(result.id).toBe('keep-this-id');
      expect(result.slug).toBe('keep-this-slug');
      expect(result.title).toBe('Original Title');
      expect(result.startDate).toBe('2024-06-01T00:00:00Z');
      expect(result.sourceUrl).toBe('https://devpost.com/original');
      expect(result.createdAt).toBe('2024-01-01T00:00:00Z');
    });

    it('should update updatedAt and lastSeenAt to current time', () => {
      const existing = makeExisting({
        updatedAt: '2024-01-01T00:00:00Z',
        lastSeenAt: '2024-01-01T00:00:00Z',
      });
      const incoming = makeIncoming();

      const result = merge(existing, incoming);

      // updatedAt and lastSeenAt should be recent (within the last few seconds)
      const resultTime = new Date(result.updatedAt).getTime();
      const now = Date.now();
      expect(resultTime).toBeGreaterThan(now - 5000);
      expect(resultTime).toBeLessThanOrEqual(now);

      expect(result.lastSeenAt).toBe(result.updatedAt);
    });
  });
});

describe('Helper functions', () => {
  describe('pickLongerText()', () => {
    it('should return null when both are null', () => {
      expect(pickLongerText(null, null)).toBeNull();
    });

    it('should return a when b is null', () => {
      expect(pickLongerText('hello', null)).toBe('hello');
    });

    it('should return b when a is null', () => {
      expect(pickLongerText(null, 'world')).toBe('world');
    });

    it('should return the longer string', () => {
      expect(pickLongerText('short', 'much longer string')).toBe('much longer string');
    });

    it('should return a when both are the same length', () => {
      expect(pickLongerText('abc', 'xyz')).toBe('abc');
    });
  });

  describe('mergeTags()', () => {
    it('should combine unique tags', () => {
      expect(mergeTags(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should deduplicate case-insensitively', () => {
      expect(mergeTags(['AI', 'web'], ['ai', 'ML'])).toEqual(['AI', 'web', 'ML']);
    });

    it('should cap at 20 tags', () => {
      const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
      expect(mergeTags(many, ['extra'])).toHaveLength(20);
    });

    it('should handle empty arrays', () => {
      expect(mergeTags([], [])).toEqual([]);
      expect(mergeTags(['a'], [])).toEqual(['a']);
      expect(mergeTags([], ['b'])).toEqual(['b']);
    });
  });

  describe('pickHigherPrecedenceFormat()', () => {
    it('should return in_person over virtual', () => {
      expect(pickHigherPrecedenceFormat('virtual', 'in_person')).toBe('in_person');
    });

    it('should return in_person over hybrid', () => {
      expect(pickHigherPrecedenceFormat('hybrid', 'in_person')).toBe('in_person');
    });

    it('should return hybrid over virtual', () => {
      expect(pickHigherPrecedenceFormat('virtual', 'hybrid')).toBe('hybrid');
    });

    it('should return in_person when both are in_person', () => {
      expect(pickHigherPrecedenceFormat('in_person', 'in_person')).toBe('in_person');
    });

    it('should return virtual when both are virtual', () => {
      expect(pickHigherPrecedenceFormat('virtual', 'virtual')).toBe('virtual');
    });
  });
});
