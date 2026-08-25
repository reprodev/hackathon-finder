import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

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
