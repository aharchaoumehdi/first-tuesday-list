// The free list's subscribers and the weekly Brief, sent with Resend (replaces beehiiv).
//
// In the same KV namespace as membership (MEMBERS):
//   sub:<email>          {email, status: active | unsubscribed, token, source, created, unsubscribed_at}
//   unsub:<token>        email (the unsubscribe link in every email; never expires)
//   brief:sent:<issue>   {at, sent, failed, by}: an issue goes out once, whatever retries happen
//   rate:sub:<ip>        sign-ups per IP and hour
//   alerts:seen:<sale>   notice ids already alerted for that sale; alerts:last  {at, sale, count, fresh, sent} of the last run
//
// A subscriber can also watch areas and save properties (the same sub:<email> record):
//   zips, areas, alerts   ZIP alerts: one email on the days a new notice is filed in those ZIPs
//   shortlist             [{id, sale, addr, city, zip, gone?}]: one email if a saved property leaves its sale's list
//
// Settings: RESEND_API_KEY (already set for sign-in emails), BRIEF_FROM (optional sender).
import { SITE, normEmail, validEmail } from './members.js';

export const MAILING_ADDRESS = '25007 Stella Falls Ln, The Woodlands, TX 77375';
const FROM = env => env.BRIEF_FROM || 'First Tuesday List <brief@firsttuesdaylist.com>';
const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');

const ZIP = /^77\d{3}$/, NOTICE = /^FRCL-\d{4}-\d{3,7}$/;
const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];

// What a sign-up form may add: ZIPs and area names (alerts), saved properties (shortlist), compared properties.
// Older forms only say it in "source" ("shortlist:A,B", "compare:A,B"), so that is read too.
export function signupExtras(body) {
  const list = (v, ok, max) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(ok))].slice(0, max);
  const fromSource = kind => String(body.source || '').startsWith(kind + ':') ? String(body.source).slice(kind.length + 1).split(',') : [];
  const ids = kind => list(Array.isArray(body[kind]) && body[kind].length ? body[kind] : fromSource(kind), x => NOTICE.test(x), kind === 'compare' ? 4 : 50);
  return { zips: list(body.zips, x => ZIP.test(x), 150), areas: list(body.areas, x => x && x.length <= 40, 8), shortlist: ids('shortlist'), compare: ids('compare') };
}

export async function getSub(env, email) {
  return email ? env.MEMBERS.get('sub:' + email, 'json') : null;
}

// Adds or re-activates a subscriber. Returns {sub, isNew}: isNew is false for someone already on the list.
// extra: {zips, areas} start or add to their ZIP alerts; {shortlist: [{id, sale, addr, city, zip}]} adds saved properties.
export async function subscribe(env, rawEmail, source, extra = {}) {
  const email = normEmail(rawEmail);
  if (!validEmail(email)) return null;
  const old = await getSub(env, email);
  const isNew = !(old && old.status === 'active');
  const sub = !isNew ? old : { email, status: 'active', token: old?.token || newToken(), source: String(source || '').slice(0, 80) || 'site',
    created: old?.created || new Date().toISOString(), resubscribed: old ? new Date().toISOString() : undefined };
  let changed = isNew;
  if (extra.zips && extra.zips.length) {
    sub.zips = union(sub.zips, extra.zips).slice(0, 300);
    sub.areas = union(sub.areas, extra.areas).slice(0, 24);
    sub.alerts = true; changed = true;
  }
  if (extra.shortlist && extra.shortlist.length) {
    const have = new Set((sub.shortlist || []).map(x => x.id + '@' + x.sale));
    sub.shortlist = [...(sub.shortlist || []), ...extra.shortlist.filter(x => !have.has(x.id + '@' + x.sale))].slice(-100);
    changed = true;
  }
  if (changed) await env.MEMBERS.put('sub:' + email, JSON.stringify(sub));
  if (isNew) await env.MEMBERS.put('unsub:' + sub.token, email);
  return { sub, isNew };
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

// Many different emails, 100 per Resend batch call. Returns {sent, failed, errors}.
async function sendMany(env, messages) {
  let sent = 0, failed = 0;
  const errors = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await resend(env, '/emails/batch', chunk);
    if (r.ok) sent += chunk.length; else { failed += chunk.length; errors.push(r.error); }
  }
  return { sent, failed, errors };
}

// One email to every active subscriber
export async function sendToAll(env, subject, html, text, subs) {
  return sendMany(env, subs.map(s => message(env, s, subject, html, text)));
}

// The welcome email: the spreadsheet link right away, as the sign-up form promises (and the alert areas, if any)
export async function sendWelcome(env, sub, extra = {}) {
  const watch = extra.zips && extra.zips.length ? (extra.areas && extra.areas.length ? extra.areas : extra.zips).join(', ') : '';
  const xlsx = `${SITE}/free-list/latest.xlsx`;
  const html = `<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">
<p style="margin:0 0 12px">Hi,</p>
<p style="margin:0 0 12px">Thanks for signing up. Here's the spreadsheet of every Harris County property scheduled for the next first-Tuesday foreclosure auction:</p>
<p style="margin:0 0 16px"><a href="${xlsx}" style="display:inline-block;background:#D2141C;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px">Download the spreadsheet</a></p>
<p style="margin:0 0 12px">The same list is on the map, with each property's sale time, flood zone and the county notice: <a href="${SITE}/map" style="color:#13294B">firsttuesdaylist.com/map</a></p>
<p style="margin:0 0 12px">Every Wednesday you'll get the First Tuesday Brief: what's new, what got postponed or cancelled, and the ZIP codes to watch.</p>
${watch ? `<p style="margin:0 0 12px">You'll also get an email the day a new foreclosure is filed in ${esc(watch)}. To change your areas, just reply.</p>` : ''}
<p style="margin:0 0 12px">Questions? Just reply. This comes straight to me.</p>
<p style="margin:0 0 18px">Mehdi<br>First Tuesday List</p>
<p style="margin:0;font-size:12px;color:#777">Compiled from public records. Not verified. Do your own title and lien research before bidding.</p>
</body></html>`;
  const text = `Thanks for signing up. Here's the spreadsheet of every Harris County property scheduled for the next first-Tuesday foreclosure auction:\n${xlsx}\n\nThe map: ${SITE}/map\n\nEvery Wednesday you'll get the First Tuesday Brief: what's new, what got postponed or cancelled, and the ZIP codes to watch.\n\n${watch ? `You'll also get an email the day a new foreclosure is filed in ${watch}. To change your areas, just reply.\n\n` : ''}Questions? Just reply.\n\nMehdi\nFirst Tuesday List\n\nCompiled from public records. Not verified. Do your own title and lien research before bidding.`;
  const r = await resend(env, '/emails', message(env, sub, 'Your Harris County foreclosure auction spreadsheet', html, text));
  return r.ok;
}

// ---------- alerts, shortlists and comparisons ----------

const TYPES = { single_family: 'Single family', condo_townhome: 'Condo / townhome', multifamily: 'Multifamily', commercial: 'Commercial', vacant_land: 'Vacant land' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DISCLAIMER = 'Compiled from public records. Not verified. Do your own title and lien research before bidding.';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// one property as an email row and a text line (free fields only)
const propHtml = (r, label) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB">
<a href="${SITE}/property/${esc(r.id)}" style="color:#13294B;font-weight:bold;text-decoration:none">${esc(r.addr)}</a><br>
<span style="font-size:13px;color:#555">${esc(r.city)}, TX ${esc(r.zip)} · ${TYPES[r.type] || 'Other'}${r.notice ? ' · ' + (r.notice === 'hoa' ? 'HOA lien' : 'Mortgage foreclosure') : ''}<br>
Sale ${esc(label)}${r.window ? ' · ' + esc(r.window) : ''}${r.zone ? ' · Flood zone ' + esc(r.zone) + (r.sfha ? ' (high risk)' : '') : ''}</span></td></tr>`;
const propText = (r, label) => `- ${r.addr}, ${r.city} TX ${r.zip} (${TYPES[r.type] || 'Other'}), sale ${label}${r.window ? ' ' + r.window : ''}${r.zone ? ', flood zone ' + r.zone : ''}: ${SITE}/property/${r.id}`;
const table = rows => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows.join('')}</table>`;
const button = (href, label) => `<p style="margin:0 0 16px"><a href="${href}" style="display:inline-block;background:#D2141C;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px">${esc(label)}</a></p>`;
const page = inner => `<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">
${inner}
<p style="margin:0 0 12px">Members see the value, the loan, and the estimated balance, equity and rent for each one: <a href="${SITE}/pricing" style="color:#13294B">firsttuesdaylist.com/pricing</a></p>
<p style="margin:0;font-size:12px;color:#777">${DISCLAIMER}</p>
</body></html>`;

// The properties a visitor saved, right after they ask for it on the site
export async function sendShortlist(env, sub, rows, label) {
  const html = page(`<p style="margin:0 0 12px">Here's your shortlist for the ${esc(label)} sale. We'll email you if any of these comes off the list before the sale (most often that means it was postponed or cancelled).</p>
${table(rows.map(r => propHtml(r, label)))}
${button(SITE + '/map', 'Open the map')}`);
  const text = `Your shortlist for the ${label} sale. We'll email you if any of these comes off the list before the sale.\n\n${rows.map(r => propText(r, label)).join('\n')}\n\nMap: ${SITE}/map\n\n${DISCLAIMER}`;
  return (await resend(env, '/emails', message(env, sub, `Your shortlist: ${plural(rows.length, 'property', 'properties')} for the ${label} sale`, html, text))).ok;
}

// A comparison the visitor made, with the link that opens it again (and that they can forward)
export async function sendComparison(env, sub, rows, label) {
  const link = `${SITE}/compare?ids=${rows.map(r => encodeURIComponent(r.id)).join(',')}`;
  const html = page(`<p style="margin:0 0 12px">Here's the comparison you made on First Tuesday List. The link opens it side by side, and you can forward it.</p>
${button(link, 'Open the comparison')}
${table(rows.map(r => propHtml(r, label)))}`);
  const text = `The comparison you made on First Tuesday List:\n${link}\n\n${rows.map(r => propText(r, label)).join('\n')}\n\n${DISCLAIMER}`;
  return (await resend(env, '/emails', message(env, sub, `Your comparison: ${rows.map(r => r.addr).join(' · ').slice(0, 120)}`, html, text))).ok;
}

const SHOW = 15;  // properties listed in one alert; the rest are a click away on the map
function alertMessage(env, sub, label, fresh, gone) {
  const zips = [...new Set(fresh.map(r => r.zip))];
  const where = zips.length <= 3 ? zips.join(', ') : `${zips.length} of your ZIP codes`;
  const subject = fresh.length ? `${plural(fresh.length, 'new foreclosure', 'new foreclosures')} filed in ${where}`
    : `${plural(gone.length, 'property', 'properties')} on your shortlist left the ${label} list`;
  const mapLink = `${SITE}/map?zips=${zips.join(',')}`;
  let html = '', text = '';
  if (fresh.length) {
    html += `<p style="margin:0 0 12px">New foreclosure notices were filed with the Harris County Clerk in the areas you watch, for the ${esc(label)} sale:</p>
${table(fresh.slice(0, SHOW).map(r => propHtml(r, label)))}
${button(mapLink, fresh.length > SHOW ? `See all ${fresh.length} on the map` : 'See them on the map')}`;
    text += `New foreclosure notices filed in the areas you watch, for the ${label} sale:\n\n${fresh.slice(0, SHOW).map(r => propText(r, label)).join('\n')}\n${fresh.length > SHOW ? `...and ${fresh.length - SHOW} more\n` : ''}Map: ${mapLink}\n\n`;
  }
  if (gone.length) {
    html += `<p style="margin:0 0 8px"><strong>${gone.length === 1 ? 'A property' : 'Properties'} on your shortlist ${gone.length === 1 ? 'is' : 'are'} no longer on the ${esc(label)} list.</strong> Most often that means the sale was postponed or cancelled. Check the county notice before you plan around it.</p>
${table(gone.map(x => `<tr><td style="padding:8px 0;border-bottom:1px solid #E5E7EB"><strong>${esc(x.addr || x.id)}</strong><br><span style="font-size:13px;color:#555">${esc(x.city || '')}${x.zip ? ', TX ' + esc(x.zip) : ''} · ${esc(x.id)}</span></td></tr>`))}`;
    text += `No longer on the ${label} list (most often postponed or cancelled):\n${gone.map(x => `- ${x.addr || x.id}${x.city ? ', ' + x.city : ''} (${x.id})`).join('\n')}\n\n`;
  }
  html += `<p style="margin:0 0 12px;font-size:13px;color:#555">You get this because you asked for alerts${sub.areas && sub.areas.length ? ' for ' + esc(sub.areas.join(', ')) : ''} or saved properties on firsttuesdaylist.com. To change your areas, just reply.</p>`;
  return message(env, sub, subject, page(html), text + DISCLAIMER);
}

// The daily run: new notices in each subscriber's ZIPs, and saved properties that left their sale's list.
// rows: today's public sale file (free fields). The very first run only records what is already there.
export async function runAlerts(env, { sale, label, rows }, { dry = false } = {}) {
  rows = rows.filter(r => r && NOTICE.test(String(r.id || '')));
  const ids = new Set(rows.map(r => r.id));
  const seenKey = 'alerts:seen:' + sale;
  const seen = await env.MEMBERS.get(seenKey, 'json');
  const last = await env.MEMBERS.get('alerts:last', 'json');
  const before = new Set(seen || []);
  const fresh = seen ? rows.filter(r => !before.has(r.id)) : last ? rows : [];
  // a list that suddenly shrank is more likely a bad build than mass cancellations: no "left the list" emails then
  const trustGone = Boolean(last && last.sale === sale && rows.length >= last.count * 0.8);
  const today = new Date().toISOString().slice(0, 10);
  const messages = [], changed = [];
  for (const sub of await activeSubs(env)) {
    const mine = sub.alerts && sub.zips && sub.zips.length ? fresh.filter(r => sub.zips.includes(r.zip)) : [];
    const gone = trustGone ? (sub.shortlist || []).filter(x => x.sale === sale && !x.gone && !ids.has(x.id)) : [];
    if (!mine.length && !gone.length) continue;
    messages.push(alertMessage(env, sub, label || sale, mine, gone));
    if (gone.length) { gone.forEach(x => { x.gone = today; }); changed.push(sub); }
  }
  const summary = { sale, count: rows.length, fresh: fresh.length, first_run: !seen && !last, emails: messages.length };
  if (dry) return { dry: true, ...summary, sent: 0, failed: 0, errors: [] };
  const r = await sendMany(env, messages);
  for (const sub of changed) await env.MEMBERS.put('sub:' + sub.email, JSON.stringify(sub));
  await env.MEMBERS.put(seenKey, JSON.stringify([...new Set([...before, ...ids])]));
  await env.MEMBERS.put('alerts:last', JSON.stringify({ at: new Date().toISOString(), ...summary, sent: r.sent, failed: r.failed }));
  return { ...summary, ...r };
}
