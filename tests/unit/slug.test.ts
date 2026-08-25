import { describe, it, expect } from 'vitest';
import { generateSlug, generateUniqueSlug, MAX_SLUG_LENGTH } from '../../src/lib/slug';

describe('generateSlug', () => {
  describe('basic slug generation', () => {
    it('converts a simple title to a slug', () => {
      expect(generateSlug('AI Hackathon 2024')).toBe('ai-hackathon-2024');
    });

    it('converts to lowercase', () => {
      expect(generateSlug('My AWESOME Hackathon')).toBe('my-awesome-hackathon');
    });

    it('replaces spaces with hyphens', () => {
      expect(generateSlug('hello world')).toBe('hello-world');
    });

    it('handles numbers correctly', () => {
      expect(generateSlug('Hack 42 Event')).toBe('hack-42-event');
    });
  });

  describe('special character handling', () => {
    it('strips ampersands', () => {
      expect(generateSlug('Machine Learning & NLP Challenge!')).toBe(
        'machine-learning-nlp-challenge'
      );
    });

    it('removes punctuation', () => {
      expect(generateSlug('Hello, World! (2024)')).toBe('hello-world-2024');
    });

    it('handles multiple special characters in a row', () => {
      expect(generateSlug('code---jam!!!event')).toBe('code-jam-event');
    });

    it('handles slashes and backslashes', () => {
      expect(generateSlug('Web3/DeFi Hackathon')).toBe('web3-defi-hackathon');
    });

    it('handles at symbols and hashes', () => {
      expect(generateSlug('#BuildWithAI @Google')).toBe('buildwithai-google');
    });

    it('handles plus signs', () => {
      expect(generateSlug('C++ Coding Challenge')).toBe('c-coding-challenge');
    });
  });

  describe('Unicode normalization', () => {
    it('normalizes accented characters', () => {
      expect(generateSlug('Café Coding Night')).toBe('cafe-coding-night');
    });

    it('handles umlauts', () => {
      expect(generateSlug('München Hackathon')).toBe('munchen-hackathon');
    });

    it('handles tildes and cedillas', () => {
      expect(generateSlug('São Paulo Hackathón')).toBe('sao-paulo-hackathon');
    });

    it('handles Nordic characters', () => {
      expect(generateSlug('Malmö Coding Ångström')).toBe('malmo-coding-angstrom');
    });

    it('strips non-Latin characters that cannot be decomposed', () => {
      // Characters like Chinese/Japanese that don't decompose to ASCII
      expect(generateSlug('AI 黑客松 Hackathon')).toBe('ai-hackathon');
    });
  });

  describe('empty and whitespace input handling', () => {
    it('returns "untitled" for empty string', () => {
      expect(generateSlug('')).toBe('untitled');
    });

    it('returns "untitled" for whitespace-only string', () => {
      expect(generateSlug('   ')).toBe('untitled');
    });

    it('returns "untitled" for tab and newline only', () => {
      expect(generateSlug('\t\n\r')).toBe('untitled');
    });

    it('returns "untitled" when all characters are stripped', () => {
      // Only non-Latin characters that get fully removed
      expect(generateSlug('你好世界')).toBe('untitled');
    });
  });

  describe('maximum length handling', () => {
    it('truncates slugs longer than 100 characters', () => {
      const longTitle = 'a '.repeat(60); // 120 chars when slugified
      const slug = generateSlug(longTitle);
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    });

    it('breaks at word boundary when truncating', () => {
      const longTitle =
        'the-incredible-amazing-fantastic-wonderful-spectacular-unbelievable-extraordinary-magnificent-brilliant-awesome-event';
      const slug = generateSlug(longTitle);
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
      // Should not end with a partial word (hyphen)
      expect(slug).not.toMatch(/-$/);
    });

    it('handles a very long single word', () => {
      const longWord = 'a'.repeat(150);
      const slug = generateSlug(longWord);
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    });

    it('does not truncate slugs at or below 100 characters', () => {
      const title = 'short-title';
      const slug = generateSlug(title);
      expect(slug).toBe('short-title');
    });
  });

  describe('edge cases', () => {
    it('collapses multiple spaces into a single hyphen', () => {
      expect(generateSlug('hello    world')).toBe('hello-world');
    });

    it('trims leading and trailing spaces', () => {
      expect(generateSlug('  hello world  ')).toBe('hello-world');
    });

    it('handles title with only special characters', () => {
      expect(generateSlug('!@#$%^&*()')).toBe('untitled');
    });

    it('is deterministic - same input produces same output', () => {
      const title = 'AI Hackathon 2024';
      expect(generateSlug(title)).toBe(generateSlug(title));
    });

    it('handles single character title', () => {
      expect(generateSlug('A')).toBe('a');
    });

    it('handles numeric-only title', () => {
      expect(generateSlug('12345')).toBe('12345');
    });
  });
});

describe('generateUniqueSlug', () => {
  it('appends a suffix to the base slug', () => {
    const slug = generateUniqueSlug('AI Hackathon 2024');
    expect(slug).toMatch(/^ai-hackathon-2024-[a-f0-9]{6}$/);
  });

  it('respects custom suffix length', () => {
    const slug = generateUniqueSlug('AI Hackathon 2024', 8);
    expect(slug).toMatch(/^ai-hackathon-2024-[a-f0-9]{8}$/);
  });

  it('generates different slugs on successive calls (with high probability)', () => {
    const slug1 = generateUniqueSlug('Test Event');
    const slug2 = generateUniqueSlug('Test Event');
    // Extremely unlikely to collide with 6 hex chars (1 in 16M)
    expect(slug1).not.toBe(slug2);
  });

  it('stays within max length even with long titles', () => {
    const longTitle = 'a '.repeat(60);
    const slug = generateUniqueSlug(longTitle);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });

  it('still ends with the hex suffix for long titles', () => {
    const longTitle = 'a '.repeat(60);
    const slug = generateUniqueSlug(longTitle);
    // Should end with -<6 hex chars>
    expect(slug).toMatch(/-[a-f0-9]{6}$/);
  });

  it('handles empty input with suffix', () => {
    const slug = generateUniqueSlug('');
    expect(slug).toMatch(/^untitled-[a-f0-9]{6}$/);
  });
});
