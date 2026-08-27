import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async () => {
  const db = env.DB as D1Database;

  try {
    await db.prepare('SELECT 1').first();
    return new Response(JSON.stringify({ status: 'ok', database: 'connected' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ status: 'error', database: 'disconnected' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
