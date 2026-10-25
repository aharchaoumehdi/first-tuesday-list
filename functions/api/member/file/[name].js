// GET /api/member/file/<name>: member downloads (spreadsheet, research brief). Members only.
// "latest-xlsx", "latest-csv" and "latest-brief" follow the newest upload of each.
import { json, currentMember } from '../../../../lib/members.js';

export async function onRequestGet({ request, env, params }) {
  if (!await currentMember(env, request)) return json({ error: 'Members only' }, 401);
  let name = params.name;
  const latest = { 'latest-xlsx': 'xlsx', 'latest-csv': 'csv', 'latest-brief': 'brief' }[name];
  if (latest) name = await env.MEMBERS.get('data:latest:' + latest);
  const f = name && /^[\w.\-]+$/.test(name) ? await env.MEMBERS.getWithMetadata('file:' + name, 'arrayBuffer') : null;
  if (!f || !f.value) return json({ error: 'Not available yet' }, 404);
  return new Response(f.value, {
    headers: {
      'Content-Type': (f.metadata && f.metadata.type) || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex'
    }
  });
}
