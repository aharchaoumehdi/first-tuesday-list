// POST /api/logout: ends this browser's session.
import { json, sameOrigin, endSession } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': await endSession(env, request) });
}
