/**
 * Slug generation utility for hackathon titles.
 * Produces URL-safe, lowercase, hyphen-separated slugs.
 * Handles Unicode normalization, special characters, and length constraints.
 */

const MAX_SLUG_LENGTH = 100;

/**
 * Generate a URL-safe slug from a title string.
 *
 * - Normalizes Unicode (NFD decomposition, strip diacritics)
 * - Converts to lowercase
 * - Replaces non-alphanumeric characters with hyphens
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 * - Caps length at 100 characters (breaks at word boundary when possible)
 *
 * @param title - The hackathon title to slugify
 * @returns A URL-safe slug string, or "untitled" for empty/whitespace input
 */
export function generateSlug(title: string): string {
  if (!title || !title.trim()) {
    return 'untitled';
  }

  let slug = title
    // Normalize Unicode: decompose accented characters (e.g., é → e + combining accent)
    .normalize('NFD')
    // Remove combining diacritical marks (accents, tildes, etc.)
    .replace(/[\u0300-\u036f]/g, '')
    // Convert to lowercase
    .toLowerCase()
    // Replace ampersands with empty string (strip them rather than "and")
    .replace(/&/g, '')
    // Replace any non-alphanumeric character (including spaces) with a hyphen
    .replace(/[^a-z0-9]+/g, '-')
    // Collapse consecutive hyphens into one
    .replace(/-{2,}/g, '-')
    // Remove leading and trailing hyphens
    .replace(/^-+|-+$/g, '');

  // Truncate to max length, breaking at a word boundary if possible
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.substring(0, MAX_SLUG_LENGTH);
    // Try to break at the last hyphen to avoid cutting a word
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > MAX_SLUG_LENGTH * 0.6) {
      slug = slug.substring(0, lastHyphen);
    }
    // Clean up any trailing hyphen from the cut
    slug = slug.replace(/-+$/, '');
  }

  return slug || 'untitled';
}

/**
 * Generate a slug with a collision-avoidance suffix.
 * Appends a short random hex string to ensure uniqueness.
 *
 * @param title - The hackathon title to slugify
 * @param suffixLength - Number of random hex characters to append (default: 6)
 * @returns A slug with a unique suffix appended
 */
export function generateUniqueSlug(title: string, suffixLength: number = 6): string {
  const baseSlug = generateSlug(title);
  const suffix = generateRandomSuffix(suffixLength);
  const combined = `${baseSlug}-${suffix}`;

  // Ensure the combined slug still fits within max length
  if (combined.length > MAX_SLUG_LENGTH) {
    const maxBase = MAX_SLUG_LENGTH - suffixLength - 1; // -1 for the connecting hyphen
    let truncatedBase = baseSlug.substring(0, maxBase);
    // Break at word boundary
    const lastHyphen = truncatedBase.lastIndexOf('-');
    if (lastHyphen > maxBase * 0.6) {
      truncatedBase = truncatedBase.substring(0, lastHyphen);
    }
    truncatedBase = truncatedBase.replace(/-+$/, '');
    return `${truncatedBase}-${suffix}`;
  }

  return combined;
}

/**
 * Generate a random hex suffix for collision avoidance.
 * Uses crypto.getRandomValues when available, falls back to Math.random.
 *
 * @param length - Number of hex characters
 * @returns A random hex string of the specified length
 */
function generateRandomSuffix(length: number): string {
  try {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, length);
  } catch {
    // Fallback for environments without crypto
    let result = '';
    for (let i = 0; i < length; i++) {
      result += Math.floor(Math.random() * 16).toString(16);
    }
    return result;
  }
}

export { MAX_SLUG_LENGTH };
