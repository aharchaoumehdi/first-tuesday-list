// GET /api/member/sale: the member fields of every property in the current sale, for the map. Members only.
import { json, currentMember } from '../../../lib/members.js';

export async function onRequestGet({ request, env }) {
  if (!await currentMember(env, request)) return json({ error: 'Members only' }, 401);
  const sale = await env.MEMBERS.get('data:current');
  const data = sale && await env.MEMBERS.get('data:sale:' + sale);
  if (!data) return json({ error: 'No member data yet' }, 404);
  return new Response(data, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}
