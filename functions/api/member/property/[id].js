// GET /api/member/property/<id>: one property's member fields, for its page. Members only.
import { json, currentMember } from '../../../../lib/members.js';

export async function onRequestGet({ request, env, params }) {
  if (!await currentMember(env, request)) return json({ error: 'Members only' }, 401);
  const sale = await env.MEMBERS.get('data:current');
  const data = sale && await env.MEMBERS.get('data:sale:' + sale, 'json');
  const row = data && data.rows[params.id];
  if (!row) return json({ error: 'Not in the current sale' }, 404);
  return json({ sale: data.sale, updated: data.updated, row }, 200, { 'Cache-Control': 'private, no-store' });
}
