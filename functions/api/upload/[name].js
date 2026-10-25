// PUT /api/upload/<name>: the daily refresh (and the monthly brief job) put member data here, keyless:
// the request carries GitHub's OIDC token for the run, which proves the repository and branch.
//   sale-YYYY-MM-DD.json         member fields; header X-Current: 1 makes it the current sale
//   *.xlsx / *.csv / *.pdf       member downloads; header X-Latest: xlsx | csv | brief makes it the "latest" one
import { json, verifyGithub } from '../../../lib/members.js';

const TYPES = { json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', pdf: 'application/pdf' };

export async function onRequestPut({ request, env, params }) {
  if (!env.MEMBERS) return json({ error: 'KV binding MEMBERS is missing' }, 503);
  const who = await verifyGithub(request);
  if (!who) return json({ error: 'Not allowed' }, 403);
  const name = params.name, ext = (name.match(/\.(\w+)$/) || [])[1];
  if (!/^[\w.\-]+$/.test(name) || !TYPES[ext]) return json({ error: 'Bad file name' }, 400);
  const body = await request.arrayBuffer();
  if (body.byteLength > 20e6) return json({ error: 'Too large' }, 413);
  const sale = (name.match(/^sale-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1];
  if (sale) {
    const data = JSON.parse(new TextDecoder().decode(body));
    if (data.sale !== sale || typeof data.rows !== 'object') return json({ error: 'Not a member sale file' }, 400);
    await env.MEMBERS.put('data:sale:' + sale, JSON.stringify(data));
    if (request.headers.get('X-Current') === '1') await env.MEMBERS.put('data:current', sale);
  } else {
    await env.MEMBERS.put('file:' + name, body, { metadata: { type: TYPES[ext], by: who.repository, at: new Date().toISOString() } });
    const latest = request.headers.get('X-Latest');
    if (['xlsx', 'csv', 'brief'].includes(latest)) await env.MEMBERS.put('data:latest:' + latest, name);
  }
  return json({ ok: true, name, bytes: body.byteLength, by: who.repository });
}
