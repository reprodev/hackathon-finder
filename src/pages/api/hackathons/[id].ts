import type { APIRoute } from 'astro';
import { getHackathonBySlug, getHackathonById } from '../../../lib/db/queries';
import type { HackathonDetailResponse, ErrorResponse } from '../../../lib/types';

export const GET: APIRoute = async ({ params, locals }) => {
  const db = locals.runtime.env.DB;
  const { id } = params;

  if (!id) {
    const error: ErrorResponse = { error: 'Missing hackathon identifier' };
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Try to find by slug first (URLs use slugs)
    let hackathon = await getHackathonBySlug(db, id);

    // If not found by slug, try by ID
    if (!hackathon) {
      hackathon = await getHackathonById(db, id);
    }

    if (!hackathon) {
      const error: ErrorResponse = { error: 'Hackathon not found' };
      return new Response(JSON.stringify(error), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response: HackathonDetailResponse = { data: hackathon };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    const error: ErrorResponse = { error: 'Service temporarily unavailable' };
    return new Response(JSON.stringify(error), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};