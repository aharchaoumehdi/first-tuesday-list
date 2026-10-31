// POST /api/subscribe {email, source, website, zips?, areas?, shortlist?, compare?}: join the free list. Sends the
// welcome email with the spreadsheet. zips/areas start ZIP alerts; shortlist and compare (notice ids) email that list
// or comparison right away. Someone already on the list gets the new areas or list added, not a second welcome.
// "website" is a hidden field people never fill: a form that fills it is a bot, and gets the same answer.
import { json, sameOrigin } from '../../lib/members.js';
import { subscribe, sendWelcome, sendShortlist, sendComparison, signupExtras } from '../../lib/newsletter.js';

// the current sale's public rows (free fields), for the shortlist and comparison emails
async function saleRows(env, request) {
  try {
    const get = p => env.ASSETS.fetch(new URL(p, request.url)).then(r => r.ok ? r.json() : null);
    const cur = await get('/data/current.json');
    const sale = cur && await get('/data/sale-' + cur.current_sale + '.json');
    return sale ? { cur, by: Object.fromEntries(sale.rows.map(r => [r.id, r])) } : null;
  } catch (e) { return null; }
}

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

  const extra = signupExtras(body);
  const sale = extra.shortlist.length || extra.compare.length ? await saleRows(env, request) : null;
  const pick = ids => sale ? ids.map(id => sale.by[id]).filter(Boolean) : [];
  const saved = pick(extra.shortlist), compared = pick(extra.compare);
  const r = await subscribe(env, body.email, body.source, {
    zips: extra.zips, areas: extra.areas,
    shortlist: saved.map(x => ({ id: x.id, sale: sale.cur.current_sale, addr: x.addr, city: x.city, zip: x.zip }))
  });
  if (!r) return json({ error: 'Please enter a valid email address.' }, 400);

  // what they asked for on the page goes out now; the welcome email follows for someone new
  const label = sale ? sale.cur.label_year || sale.cur.label : '';
  const sentList = saved.length ? await sendShortlist(env, r.sub, saved, label) : null;
  const sentCompare = compared.length ? await sendComparison(env, r.sub, compared, label) : null;
  if (r.isNew && !await sendWelcome(env, r.sub, extra)) {
    return json({ ok: true, message: "You're in. The email is slow to arrive: the spreadsheet is also at firsttuesdaylist.com/free-list/latest.xlsx" });
  }
  if (r.isNew) return done;
  if (extra.zips.length) return json({ ok: true, message: "You're already on the list. These areas are added to your alerts." });
  if (sentList || sentCompare) return json({ ok: true, message: "You're already on the list. It's on its way to your inbox." });
  return json({ ok: true, message: "You're already on the list. The spreadsheet link is in your welcome email." });
}
