// POST /api/alerts/send: the daily ZIP alerts and shortlist status emails, keyless like /api/brief/send: the request
// carries the GitHub OIDC token of the website's daily data refresh on main (tools/send_alerts.py).
//   {sale: "2026-11-03", label: "Nov 3, 2026", rows: [{id, addr, city, zip, type, notice, window, zone, sfha}], dry?}
// rows are the public sale file's free fields. New notices are the ids this sale hasn't alerted yet; the very first run
// only records the list. A saved property that leaves its sale's list gets one email to the people who saved it.
import { json, verifyGithub } from '../../../lib/members.js';
import { runAlerts } from '../../../lib/newsletter.js';

export async function onRequestPost({ request, env }) {
  if (!env.MEMBERS) return json({ error: 'KV binding MEMBERS is missing' }, 503);
  const who = await verifyGithub(request);
  if (!who) return json({ error: 'Not allowed' }, 403);
  const b = await request.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.sale || '') || !Array.isArray(b.rows) || !b.rows.length) return json({ error: 'Need sale and rows' }, 400);
  const r = await runAlerts(env, b, { dry: b.dry === true });
  return json({ ok: r.failed === 0, ...r }, r.failed && !r.sent ? 502 : 200);
}
