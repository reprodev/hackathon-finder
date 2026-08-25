import { describe, it, expect } from 'vitest';
import { truncateTitle, formatDateRange } from '../../src/components/HackathonCard';

describe('truncateTitle', () => {
  it('should return title unchanged when 80 chars or fewer', () => {
    const title = 'Short Title';
    expect(truncateTitle(title)).toBe('Short Title');
  });

  it('should return title unchanged at exactly 80 characters', () => {
    const title = 'A'.repeat(80);
    expect(truncateTitle(title)).toBe(title);
    expect(truncateTitle(title).length).toBe(80);
  });

  it('should truncate to 80 chars with ellipsis when longer', () => {
    const title = 'B'.repeat(100);
    const result = truncateTitle(title);
    expect(result.length).toBe(81); // 80 chars + 1 ellipsis character
    expect(result).toBe('B'.repeat(80) + '…');
  });

  it('should handle title at 81 characters (just over boundary)', () => {
    const title = 'C'.repeat(81);
    const result = truncateTitle(title);
    expect(result).toBe('C'.repeat(80) + '…');
  });

  it('should handle empty string', () => {
    expect(truncateTitle('')).toBe('');
  });

  it('should allow custom maxLength', () => {
    const title = 'Hello World Custom';
    expect(truncateTitle(title, 5)).toBe('Hello…');
  });
});

describe('formatDateRange', () => {
  it('should format single date when no end date', () => {
    const result = formatDateRange('2024-06-15T09:00:00Z', null);
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('should format date range within same year', () => {
    const result = formatDateRange('2024-06-15T09:00:00Z', '2024-06-17T18:00:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('17');
    expect(result).toContain('2024');
  });

  it('should format date range spanning different years', () => {
    const result = formatDateRange('2024-12-30T00:00:00Z', '2025-01-02T00:00:00Z');
    expect(result).toContain('2024');
    expect(result).toContain('2025');
  });

  it('should format same day as single date', () => {
    const result = formatDateRange('2024-06-15T09:00:00Z', '2024-06-15T18:00:00Z');
    // Same day should not show a range
    expect(result).not.toContain(' - ');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('should handle date-only ISO strings', () => {
    const result = formatDateRange('2024-06-15', null);
    expect(result).toContain('2024');
  });
});
