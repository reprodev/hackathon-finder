/**
 * GET /sitemap.xml
 *
 * Dynamic sitemap generation that queries D1 for all published hackathons
 * and generates a valid XML sitemap with detail page URLs.
 *
 * Requirements satisfied: 8.3
 */

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals, url }) => {
  const db = locals.runtime.env.DB;
  const baseUrl = url.origin;

  // Query all hackathon slugs and their last-updated timestamps
  const result = await db
    .prepare('SELECT slug, updated_at FROM hackathons ORDER BY updated_at DESC')
    .all();
  const hackathons = result.results ?? [];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc></url>
  <url><loc>${baseUrl}/hackathons</loc></url>
  ${hackathons.map((h) => `<url><loc>${baseUrl}/hackathons/${h.slug}</loc><lastmod>${h.updated_at}</lastmod></url>`).join('\n  ')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
};
