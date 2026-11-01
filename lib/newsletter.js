// The free list's subscribers and the weekly Brief, sent with Resend (replaces beehiiv).
//
// In the same KV namespace as membership (MEMBERS):
//   sub:<email>          {email, status: active | unsubscribed, token, source, created, unsubscribed_at}
//   unsub:<token>        email (the unsubscribe link in every email; never expires)
//   brief:sent:<issue>   {at, sent, failed, by}: an issue goes out once, whatever retries happen
//   rate:sub:<ip>        sign-ups per IP and hour
//
// Settings: RESEND_API_KEY (already set for sign-in emails), BRIEF_FROM (optional sender).
import { SITE, normEmail, validEmail } from './members.js';

export const MAILING_ADDRESS = '25007 Stella Falls Ln, The Woodlands, TX 77375';
const FROM = env => env.BRIEF_FROM || 'First Tuesday List <brief@firsttuesdaylist.com>';
const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function getSub(env, email) {
  return email ? env.MEMBERS.get('sub:' + email, 'json') : null;
}

// Adds or re-activates a subscriber. Returns {sub, isNew}: isNew is false for someone already on the list.
export async function subscribe(env, rawEmail, source) {
  const email = normEmail(rawEmail);
  if (!validEmail(email)) return null;
  const old = await getSub(env, email);
  if (old && old.status === 'active') return { sub: old, isNew: false };
  const sub = { email, status: 'active', token: old?.token || newToken(), source: String(source || '').slice(0, 80) || 'site',
    created: old?.created || new Date().toISOString(), resubscribed: old ? new Date().toISOString() : undefined };
  await env.MEMBERS.put('sub:' + email, JSON.stringify(sub));
  await env.MEMBERS.put('unsub:' + sub.token, email);
  return { sub, isNew: true };
}

export async function unsubscribe(env, token) {
  const email = token && /^[0-9a-f]{48}$/.test(token) ? await env.MEMBERS.get('unsub:' + token) : null;
  const sub = email ? await getSub(env, email) : null;
  if (!sub) return null;
  if (sub.status !== 'unsubscribed') {
    sub.status = 'unsubscribed'; sub.unsubscribed_at = new Date().toISOString();
    await env.MEMBERS.put('sub:' + email, JSON.stringify(sub));
  }
  return sub;
}

export async function activeSubs(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.MEMBERS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const s = await env.MEMBERS.get(k.name, 'json');
      if (s && s.status === 'active') out.push(s);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

const unsubUrl = sub => `${SITE}/api/unsubscribe?t=${sub.token}`;

// CAN-SPAM: who we are, a postal address and a working unsubscribe link in every email
function footer(sub) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:18px 12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280">
You get this because you signed up for the free list at <a href="${SITE}" style="color:#13294B">firsttuesdaylist.com</a>.<br>
<a href="${unsubUrl(sub)}" style="color:#13294B">Unsubscribe</a> in one click · First Tuesday List · ${MAILING_ADDRESS}</td></tr></table>`;
}

const message = (env, sub, subject, html, text) => ({
  from: FROM(env), to: [sub.email], subject, reply_to: 'leads@firsttuesdaylist.com',
  html: html.includes('</body>') ? html.replace('</body>', footer(sub) + '</body>') : html + footer(sub),
  text: (text ? text + '\n\n' : '') + `--\nUnsubscribe: ${unsubUrl(sub)}\nFirst Tuesday List · ${MAILING_ADDRESS}`,
  headers: { 'List-Unsubscribe': `<${unsubUrl(sub)}>, <mailto:leads@firsttuesdaylist.com?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
});

async function resend(env, path, body) {
  if (!env.RESEND_API_KEY) {
    if (env.DEV === '1') { console.log(`[dev email] ${path}: ${JSON.stringify(body).slice(0, 400)}`); return { ok: true }; }
    return { ok: false, error: 'RESEND_API_KEY is not set' };
  }
  const r = await fetch('https://api.resend.com' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.ok ? { ok: true } : { ok: false, error: `${r.status} ${(await r.text()).slice(0, 300)}` };
}

// One email to every active subscriber, 100 per Resend batch call. Returns {sent, failed, errors}.
export async function sendToAll(env, subject, html, text, subs) {
  let sent = 0, failed = 0;
  const errors = [];
  for (let i = 0; i < subs.length; i += 100) {
    const chunk = subs.slice(i, i + 100);
    const r = await resend(env, '/emails/batch', chunk.map(s => message(env, s, subject, html, text)));
    if (r.ok) sent += chunk.length; else { failed += chunk.length; errors.push(r.error); }
  }
  return { sent, failed, errors };
}

// The welcome email: the spreadsheet link right away, as the sign-up form promises
export async function sendWelcome(env, sub) {
  const xlsx = `${SITE}/free-list/latest.xlsx`;
  const html = `<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">
<p style="margin:0 0 12px">Hi,</p>
<p style="margin:0 0 12px">Thanks for signing up. Here's the spreadsheet of every Harris County property scheduled for the next first-Tuesday foreclosure auction:</p>
<p style="margin:0 0 16px"><a href="${xlsx}" style="display:inline-block;background:#D2141C;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px">Download the spreadsheet</a></p>
<p style="margin:0 0 12px">The same list is on the map, with each property's sale time, flood zone and the county notice: <a href="${SITE}/map" style="color:#13294B">firsttuesdaylist.com/map</a></p>
<p style="margin:0 0 12px">Every Wednesday you'll get the First Tuesday Brief: what's new, what got postponed or cancelled, and the ZIP codes to watch.</p>
<p style="margin:0 0 12px">Questions? Just reply. This comes straight to me.</p>
<p style="margin:0 0 18px">Mehdi<br>First Tuesday List</p>
<p style="margin:0;font-size:12px;color:#777">Compiled from public records. Not verified. Do your own title and lien research before bidding.</p>
</body></html>`;
  const text = `Thanks for signing up. Here's the spreadsheet of every Harris County property scheduled for the next first-Tuesday foreclosure auction:\n${xlsx}\n\nThe map: ${SITE}/map\n\nEvery Wednesday you'll get the First Tuesday Brief: what's new, what got postponed or cancelled, and the ZIP codes to watch.\n\nQuestions? Just reply.\n\nMehdi\nFirst Tuesday List\n\nCompiled from public records. Not verified. Do your own title and lien research before bidding.`;
  const r = await resend(env, '/emails', message(env, sub, 'Your Harris County foreclosure auction spreadsheet', html, text));
  return r.ok;
}
