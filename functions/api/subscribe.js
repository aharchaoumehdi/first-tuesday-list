// POST /api/subscribe {email, source, website}: join the free list. Sends the welcome email with the spreadsheet.
// "website" is a hidden field people never fill: a form that fills it is a bot, and gets the same answer.
import { json, sameOrigin } from '../../lib/members.js';
import { subscribe, sendWelcome } from '../../lib/newsletter.js';

export async function onRequestPost({ request, env }) {
  if (!env.MEMBERS) return json({ error: 'Sign-up is not available right now. Write to leads@firsttuesdaylist.com.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const body = await request.json().catch(() => ({}));
  const done = json({ ok: true, message: "You're in. The spreadsheet is on its way to your inbox." });
  if (body.website) return done;
  // at most 10 sign-ups an hour from one address on the internet
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown', rate = 'rate:sub:' + ip;
  const n = parseInt(await env.MEMBERS.get(rate) || '0', 10);
  if (n >= 10) return json({ error: 'Too many sign-ups from here. Try again in an hour.' }, 429);
  await env.MEMBERS.put(rate, String(n + 1), { expirationTtl: 3600 });
  const r = await subscribe(env, body.email, body.source);
  if (!r) return json({ error: 'Please enter a valid email address.' }, 400);
  if (r.isNew && !await sendWelcome(env, r.sub)) {
    return json({ ok: true, message: "You're in. The email is slow to arrive: the spreadsheet is also at firsttuesdaylist.com/free-list/latest.xlsx" });
  }
  return r.isNew ? done : json({ ok: true, message: "You're already on the list. The spreadsheet link is in your welcome email." });
}
