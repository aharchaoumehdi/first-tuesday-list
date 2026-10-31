// POST /api/brief/send: sends the weekly Brief to every active subscriber, keyless like /api/upload: the request
// carries the GitHub OIDC token of an ftl-ops or website run on main (the run that Claude's approval started).
//   {issue: "2026-11-04", subject, html, text?, test?: ["a@b.com"]}
// An issue goes out once: a second call for the same issue does nothing. "test" sends only to those addresses
// (they must be subscribers) and doesn't count as sending the issue.
import { json, verifyGithub, normEmail } from '../../../lib/members.js';
import { activeSubs, sendToAll } from '../../../lib/newsletter.js';

export async function onRequestPost({ request, env }) {
  if (!env.MEMBERS) return json({ error: 'KV binding MEMBERS is missing' }, 503);
  const who = await verifyGithub(request);
  if (!who) return json({ error: 'Not allowed' }, 403);
  const b = await request.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.issue || '') || !b.subject || !b.html || b.html.length > 400000) return json({ error: 'Need issue, subject and html' }, 400);
  let subs = await activeSubs(env);
  if (Array.isArray(b.test)) {
    const only = new Set(b.test.map(normEmail));
    subs = subs.filter(s => only.has(s.email));
  } else {
    const done = await env.MEMBERS.get('brief:sent:' + b.issue, 'json');
    if (done) return json({ ok: true, already: true, ...done });
  }
  if (!subs.length) return json({ ok: true, sent: 0, failed: 0, note: 'no active subscribers matched' });
  const r = await sendToAll(env, b.subject, b.html, b.text, subs);
  if (!Array.isArray(b.test) && r.sent) {
    await env.MEMBERS.put('brief:sent:' + b.issue, JSON.stringify({ at: new Date().toISOString(), sent: r.sent, failed: r.failed, by: who.repository }));
  }
  return json({ ok: r.failed === 0, test: Array.isArray(b.test), ...r }, r.sent || !r.failed ? 200 : 502);
}
