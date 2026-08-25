import { describe, it, expect } from 'vitest';
import {
  normalize,
  validate,
  detectFormat,
  isValidISO8601,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS_COUNT,
} from '../../workers/aggregator/normalizer';
import type { RawHackathonEvent } from '../../workers/aggregator/adapters/interface';

/** Helper to create a valid raw event for testing */
function makeRawEvent(overrides: Partial<RawHackathonEvent> = {}): RawHackathonEvent {
  return {
    title: 'AI Hackathon 2024',
    description: 'Build something amazing with AI.',
    startDate: '2024-06-15T09:00:00Z',
    endDate: '2024-06-17T18:00:00Z',
    location: 'San Francisco, CA',
    organizer: 'TechCorp',
    prizes: '$10,000 grand prize',
    tags: ['ai', 'machine-learning', 'beginner-friendly'],
    url: 'https://devpost.com/hackathons/ai-2024',
    source: 'devpost',
    ...overrides,
  };
}

describe('normalize', () => {
  describe('title truncation', () => {
    it('should keep title unchanged when under 200 characters', () => {
      const raw = makeRawEvent({ title: 'Short Title' });
      const result = normalize(raw);
      expect(result.title).toBe('Short Title');
    });

    it('should truncate title to 200 characters when longer', () => {
      const longTitle = 'A'.repeat(250);
      const raw = makeRawEvent({ title: longTitle });
      const result = normalize(raw);
      expect(result.title.length).toBe(MAX_TITLE_LENGTH);
      expect(result.title).toBe('A'.repeat(200));
    });

    it('should trim whitespace from title', () => {
      const raw = makeRawEvent({ title: '  Padded Title  ' });
      const result = normalize(raw);
      expect(result.title).toBe('Padded Title');
    });

    it('should handle title at exactly 200 characters', () => {
      const exactTitle = 'B'.repeat(200);
      const raw = makeRawEvent({ title: exactTitle });
      const result = normalize(raw);
      expect(result.title).toBe(exactTitle);
      expect(result.title.length).toBe(200);
    });
  });

  describe('description truncation', () => {
    it('should keep description unchanged when under 5000 characters', () => {
      const raw = makeRawEvent({ description: 'Short description.' });
      const result = normalize(raw);
      expect(result.description).toBe('Short description.');
    });

    it('should truncate description to 5000 characters when longer', () => {
      const longDesc = 'X'.repeat(6000);
      const raw = makeRawEvent({ description: longDesc });
      const result = normalize(raw);
      expect(result.description!.length).toBe(MAX_DESCRIPTION_LENGTH);
    });

    it('should return null for empty description', () => {
      const raw = makeRawEvent({ description: '' });
      const result = normalize(raw);
      expect(result.description).toBeNull();
    });

    it('should return null for undefined description', () => {
      const raw = makeRawEvent({ description: undefined });
      const result = normalize(raw);
      expect(result.description).toBeNull();
    });

    it('should return null for whitespace-only description', () => {
      const raw = makeRawEvent({ description: '   ' });
      const result = normalize(raw);
      expect(result.description).toBeNull();
    });
  });

  describe('tags limiting', () => {
    it('should keep all tags when fewer than 20', () => {
      const raw = makeRawEvent({ tags: ['tag1', 'tag2', 'tag3'] });
      const result = normalize(raw);
      expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should limit tags to first 20 entries', () => {
      const manyTags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
      const raw = makeRawEvent({ tags: manyTags });
      const result = normalize(raw);
      expect(result.tags.length).toBe(MAX_TAGS_COUNT);
      expect(result.tags[0]).toBe('tag-0');
      expect(result.tags[19]).toBe('tag-19');
    });

    it('should trim tag whitespace', () => {
      const raw = makeRawEvent({ tags: ['  ai  ', ' ml ', 'web'] });
      const result = normalize(raw);
      expect(result.tags).toEqual(['ai', 'ml', 'web']);
    });

    it('should filter out empty tags', () => {
      const raw = makeRawEvent({ tags: ['ai', '', '  ', 'ml'] });
      const result = normalize(raw);
      expect(result.tags).toEqual(['ai', 'ml']);
    });

    it('should handle undefined tags', () => {
      const raw = makeRawEvent({ tags: undefined });
      const result = normalize(raw);
      expect(result.tags).toEqual([]);
    });
  });

  describe('field mapping', () => {
    it('should map all fields correctly for a complete event', () => {
      const raw = makeRawEvent();
      const result = normalize(raw);
      expect(result.title).toBe('AI Hackathon 2024');
      expect(result.description).toBe('Build something amazing with AI.');
      expect(result.startDate).toBe('2024-06-15T09:00:00Z');
      expect(result.endDate).toBe('2024-06-17T18:00:00Z');
      expect(result.location).toBe('San Francisco, CA');
      expect(result.organizer).toBe('TechCorp');
      expect(result.prizes).toBe('$10,000 grand prize');
      expect(result.sourceUrl).toBe('https://devpost.com/hackathons/ai-2024');
      expect(result.sourceName).toBe('devpost');
    });

    it('should set optional fields to null when not provided', () => {
      const raw = makeRawEvent({
        description: undefined,
        endDate: undefined,
        location: undefined,
        organizer: undefined,
        prizes: undefined,
      });
      const result = normalize(raw);
      expect(result.description).toBeNull();
      expect(result.endDate).toBeNull();
      expect(result.location).toBeNull();
      expect(result.organizer).toBeNull();
      expect(result.prizes).toBeNull();
    });
  });

  describe('Unicode handling', () => {
    it('should handle Unicode characters in title', () => {
      const raw = makeRawEvent({ title: 'Hackathón de Inteligencia Artificial 🤖' });
      const result = normalize(raw);
      expect(result.title).toBe('Hackathón de Inteligencia Artificial 🤖');
    });

    it('should handle CJK characters', () => {
      const raw = makeRawEvent({ title: 'ハッカソン2024' });
      const result = normalize(raw);
      expect(result.title).toBe('ハッカソン2024');
    });

    it('should truncate Unicode strings correctly by character count', () => {
      const emojiTitle = '🎉'.repeat(250);
      const raw = makeRawEvent({ title: emojiTitle });
      const result = normalize(raw);
      expect(result.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    });
  });
});

describe('detectFormat', () => {
  it('should return "virtual" for null location', () => {
    expect(detectFormat(null)).toBe('virtual');
  });

  it('should return "virtual" for undefined location', () => {
    expect(detectFormat(undefined)).toBe('virtual');
  });

  it('should return "virtual" for empty string', () => {
    expect(detectFormat('')).toBe('virtual');
  });

  it('should return "virtual" for whitespace-only string', () => {
    expect(detectFormat('   ')).toBe('virtual');
  });

  it('should return "virtual" for "Online"', () => {
    expect(detectFormat('Online')).toBe('virtual');
  });

  it('should return "virtual" for "Virtual"', () => {
    expect(detectFormat('Virtual')).toBe('virtual');
  });

  it('should return "virtual" for "Remote"', () => {
    expect(detectFormat('Remote')).toBe('virtual');
  });

  it('should return "virtual" for case-insensitive virtual keywords', () => {
    expect(detectFormat('ONLINE')).toBe('virtual');
    expect(detectFormat('virtual')).toBe('virtual');
    expect(detectFormat('REMOTE')).toBe('virtual');
  });

  it('should return "hybrid" for location containing "hybrid"', () => {
    expect(detectFormat('Hybrid')).toBe('hybrid');
    expect(detectFormat('hybrid event')).toBe('hybrid');
    expect(detectFormat('NYC (Hybrid)')).toBe('hybrid');
  });

  it('should return "hybrid" for locations combining virtual and physical', () => {
    expect(detectFormat('Online and San Francisco')).toBe('hybrid');
    expect(detectFormat('Virtual + NYC')).toBe('hybrid');
  });

  it('should return "in_person" for physical locations', () => {
    expect(detectFormat('San Francisco, CA')).toBe('in_person');
    expect(detectFormat('MIT Campus, Boston')).toBe('in_person');
    expect(detectFormat('London, UK')).toBe('in_person');
  });
});

describe('isValidISO8601', () => {
  it('should accept date-only format', () => {
    expect(isValidISO8601('2024-06-15')).toBe(true);
  });

  it('should accept datetime with Z timezone', () => {
    expect(isValidISO8601('2024-06-15T09:00:00Z')).toBe(true);
  });

  it('should accept datetime with offset timezone', () => {
    expect(isValidISO8601('2024-06-15T09:00:00+05:00')).toBe(true);
    expect(isValidISO8601('2024-06-15T09:00:00-08:00')).toBe(true);
  });

  it('should accept datetime with milliseconds', () => {
    expect(isValidISO8601('2024-06-15T09:00:00.123Z')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(isValidISO8601('')).toBe(false);
  });

  it('should reject non-date strings', () => {
    expect(isValidISO8601('not-a-date')).toBe(false);
    expect(isValidISO8601('June 15, 2024')).toBe(false);
    expect(isValidISO8601('15/06/2024')).toBe(false);
  });

  it('should reject invalid dates', () => {
    expect(isValidISO8601('2024-13-01')).toBe(false);
    expect(isValidISO8601('2024-00-01')).toBe(false);
  });
});

describe('validate', () => {
  it('should return valid for a complete normalized hackathon', () => {
    const raw = makeRawEvent();
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return error for empty title', () => {
    const raw = makeRawEvent({ title: '' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('title is required and must be non-empty');
  });

  it('should return error for whitespace-only title', () => {
    const raw = makeRawEvent({ title: '   ' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('title is required and must be non-empty');
  });

  it('should return error for empty startDate', () => {
    const raw = makeRawEvent({ startDate: '' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('startDate is required and must be non-empty');
  });

  it('should return error for invalid startDate', () => {
    const raw = makeRawEvent({ startDate: 'not-a-date' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('startDate must be a valid ISO 8601 date string');
  });

  it('should return error for empty sourceUrl', () => {
    const raw = makeRawEvent({ url: '' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('sourceUrl is required and must be non-empty');
  });

  it('should accumulate multiple errors', () => {
    const raw = makeRawEvent({ title: '', startDate: '', url: '' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it('should validate with a valid ISO 8601 date', () => {
    const raw = makeRawEvent({ startDate: '2024-12-25' });
    const normalized = normalize(raw);
    const result = validate(normalized);
    expect(result.valid).toBe(true);
  });
});
