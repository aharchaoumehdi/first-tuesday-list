// Membership plumbing shared by the /api functions: Stripe, sessions, sign-in emails, member data.
//
// Everything lives in one KV namespace bound as MEMBERS:
//   member:<email>        {email, customer, subscription, status, plan, founding, period_end, cancel_at_period_end, mode}
//   customer:<cus_...>    email (webhooks name the customer, not the email)
//   (mode is test or live, from the Stripe key; records of the other mode are ignored, so test data never counts)
//   session:<sha256>      email, 30-day TTL (the cookie holds the token, KV only its hash)
//   login:<sha256>        email, 20-minute TTL (one-time sign-in link)
//   founding:sub:<mode>:<sub_>  marks a founding subscription once; founding:count:<mode> counts them
//   data:current          the current sale date; data:sale:<date> the member fields of every property
//   file:<name>           member downloads (spreadsheet, brief), with their content type as metadata
//
// Settings (Cloudflare Pages → Settings → Variables and secrets):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   required to open membership
//   RESEND_API_KEY, EMAIL_FROM                 sign-in links by email
//   STRIPE_TAX=on                              collect sales tax with Stripe Tax (after registering in Stripe)
//   SALES=closed or a date and time            no new members until then (pricing shows "Opening soon"); members keep access
//   STRIPE_API                                 local tests only: a fake Stripe

export const SITE = 'https://firsttuesdaylist.com';
export const FOUNDING_SEATS = 100;
export const PLANS = {
  monthly: { amount: 4900, interval: 'month', lookup: 'ftl_member_monthly', label: '$49/month' },
  yearly: { amount: 49000, interval: 'year', lookup: 'ftl_member_yearly', label: '$490/year' },
  founding_monthly: { amount: 3900, interval: 'month', lookup: 'ftl_founding_monthly', label: '$39/month' },
  founding_yearly: { amount: 39000, interval: 'year', lookup: 'ftl_founding_yearly', label: '$390/year' }
};
const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const SESSION_DAYS = 30;

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const isOpen = env => Boolean(env.MEMBERS && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
// SALES=closed stops new checkouts (e.g. while Stripe is still in test mode); existing members keep access.
// SALES=<date and time> (e.g. 2026-10-28T06:00:00-05:00) keeps them closed until then and opens them on its own.
export const salesOpen = env => isOpen(env) && env.SALES !== 'closed' && !(Date.parse(env.SALES) > Date.now());
// Test and live Stripe data never mix: members, founding seats and the product are kept per mode
export const mode = env => (env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : 'test';

export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// Same-origin check for POSTs: the session cookie is SameSite=Lax already; this also stops other sites' forms.
export function sameOrigin(request) {
  const o = request.headers.get('Origin');
  return !o || o === new URL(request.url).origin;
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

// ---------- members ----------
export async function getMember(env, email) {
  const m = email ? await env.MEMBERS.get('member:' + email, 'json') : null;
  return m && (m.mode || 'test') === mode(env) ? m : null; // a test-mode record means nothing once Stripe is live
}
export function isActive(m) {
  return Boolean(m && ACTIVE.has(m.status) && (!m.period_end || m.period_end * 1000 > Date.now() - 3 * 864e5));
}
export async function saveMember(env, m) {
  await env.MEMBERS.put('member:' + m.email, JSON.stringify(m));
  if (m.customer) await env.MEMBERS.put('customer:' + m.customer, m.email);
}

// The member record from a Stripe subscription (the source of truth; webhooks and the welcome page both call this).
export async function memberFromSubscription(env, sub, email) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  email = normEmail(email || await env.MEMBERS.get('customer:' + customer));
  if (!email) {
    const c = await stripe(env, 'GET', '/v1/customers/' + customer);
    email = normEmail(c.email);
  }
  const item = sub.items && sub.items.data && sub.items.data[0];
  const lookup = item && item.price && item.price.lookup_key || '';
  const plan = Object.keys(PLANS).find(k => PLANS[k].lookup === lookup) || 'monthly';
  const old = await getMember(env, email) || {};
  const m = {
    email, customer, subscription: sub.id, status: sub.status, plan, founding: plan.startsWith('founding'),
    period_end: sub.current_period_end || (item && item.current_period_end) || null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end), since: old.since || new Date().toISOString().slice(0, 10),
    mode: mode(env)
  };
  await saveMember(env, m);
  const seat = `founding:sub:${mode(env)}:${sub.id}`;
  if (m.founding && !(await env.MEMBERS.get(seat))) {
    await env.MEMBERS.put(seat, '1');
    await env.MEMBERS.put('founding:count:' + mode(env), String(await foundingTaken(env) + 1));
  }
  return m;
}
export async function foundingTaken(env) {
  return parseInt(await env.MEMBERS.get('founding:count:' + mode(env)) || '0', 10);
}

// ---------- sessions ----------
export function cookieToken(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)ftl_s=([a-f0-9]{64})/);
  return m ? m[1] : null;
}
export async function sessionEmail(env, request) {
  const t = cookieToken(request);
  return t && env.MEMBERS ? env.MEMBERS.get('session:' + await sha256(t)) : null;
}
// The signed-in member, only while the subscription is active.
export async function currentMember(env, request) {
  if (!env.MEMBERS) return null;
  const m = await getMember(env, await sessionEmail(env, request));
  return isActive(m) ? m : null;
}
export async function startSession(env, email) {
  const t = token();
  await env.MEMBERS.put('session:' + await sha256(t), email, { expirationTtl: SESSION_DAYS * 86400 });
  return `ftl_s=${t}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export async function endSession(env, request) {
  const t = cookieToken(request);
  if (t && env.MEMBERS) await env.MEMBERS.delete('session:' + await sha256(t));
  return 'ftl_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}
export async function newLoginLink(env, email, origin) {
  const t = token();
  await env.MEMBERS.put('login:' + await sha256(t), email, { expirationTtl: 1200 });
  return `${origin}/api/login?t=${t}`;
}
export async function useLoginLink(env, t) {
  if (!/^[a-f0-9]{64}$/.test(t || '')) return null;
  const key = 'login:' + await sha256(t);
  const email = await env.MEMBERS.get(key);
  if (email) await env.MEMBERS.delete(key);
  return email;
}

// ---------- Stripe (REST over fetch; Workers can't run the Node SDK's HTTP client) ----------
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
export async function stripe(env, method, path, params) {
  const base = env.STRIPE_API || 'https://api.stripe.com';
  let url = base + path, body;
  if (params && method === 'GET') url += '?' + form(params);
  else if (params) body = form(params);
  const r = await fetch(url, {
    method, body,
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (data.error && data.error.message || r.status));
  return data;
}

// The Stripe price for a plan, found by lookup key and created the first time (so nothing needs setting up by hand).
export async function priceFor(env, plan) {
  const p = PLANS[plan];
  const found = await stripe(env, 'GET', '/v1/prices', { lookup_keys: [p.lookup], active: 'true' });
  if (found.data && found.data.length) return found.data[0].id;
  let product = await env.MEMBERS.get('stripe:product:' + mode(env));
  if (!product) {
    const prod = await stripe(env, 'POST', '/v1/products', {
      name: 'First Tuesday List membership',
      description: 'Values, loans, estimated equity, filters, the member spreadsheet and the Top 10 Research Brief for every Harris County foreclosure sale.'
    });
    product = prod.id;
    await env.MEMBERS.put('stripe:product:' + mode(env), product);
  }
  const price = await stripe(env, 'POST', '/v1/prices', {
    product, currency: 'usd', unit_amount: p.amount, recurring: { interval: p.interval }, lookup_key: p.lookup,
    nickname: (plan.startsWith('founding') ? 'Founding member ' : 'Member ') + p.label, tax_behavior: 'exclusive'
  });
  return price.id;
}

// Stripe-Signature: t=<time>,v1=<hmac>; HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret.
export async function verifyStripe(env, raw, header) {
  const parts = Object.fromEntries((header || '').split(',').map(p => p.split('=')));
  const sigs = (header || '').split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!parts.t || !sigs.length || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.t + '.' + raw));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

// ---------- email (Resend) ----------
export async function sendEmail(env, to, subject, html, text) {
  if (!env.RESEND_API_KEY) {
    if (env.DEV === '1') { console.log(`[dev email] to ${to}: ${subject}\n${text}`); return true; }
    return false;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'First Tuesday List <members@firsttuesdaylist.com>', to: [to], subject, html, text,
      reply_to: 'leads@firsttuesdaylist.com' })
  });
  return r.ok;
}

// The sign-in email, in the site's look (table layout: email clients ignore most CSS).
export function signInEmail(link, welcome) {
  const head = welcome ? "You're a member. Welcome." : 'Your sign-in link';
  const lead = welcome
    ? 'Thanks for joining First Tuesday List. Use this button to sign in on any device. Your values, loans, equity, the member spreadsheet and the Top 10 Research Brief are waiting.'
    : 'Press the button to sign in to First Tuesday List. The link works once and expires in 20 minutes.';
  const html = `<!doctype html><html><body style="margin:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#0E1A2B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F9"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E2E7EF">
<tr><td style="padding:22px 28px 14px"><img src="${SITE}/assets/logo.png" width="166" height="40" alt="First Tuesday List" style="display:block"></td></tr>
<tr><td style="height:4px;background:#D2141C;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:26px 28px 8px"><div style="font-family:'Arial Narrow',Arial,sans-serif;font-weight:bold;font-size:28px;text-transform:uppercase;color:#13294B;line-height:1.1">${head}</div>
<p style="font-size:15px;line-height:1.55;color:#24324A;margin:14px 0 22px">${lead}</p>
<a href="${link}" style="display:inline-block;background:#D2141C;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:10px">Sign in to First Tuesday List</a>
<p style="font-size:13px;color:#4A5568;margin:22px 0 0">If you didn't ask for this, ignore this email: nobody can sign in without the link.</p></td></tr>
<tr><td style="padding:22px 28px 26px;font-size:12px;color:#4A5568;line-height:1.5;border-top:1px solid #EEF1F6">Compiled from public records. Not verified. Do your own title and lien research before bidding.<br>First Tuesday List · Harris County, TX · <a href="${SITE}" style="color:#13294B">firsttuesdaylist.com</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${head}\n\n${lead}\n\n${link}\n\nIf you didn't ask for this, ignore this email.\n\nCompiled from public records. Not verified. Do your own title and lien research before bidding.`;
  return { subject: welcome ? 'Welcome to First Tuesday List' : 'Your First Tuesday List sign-in link', html, text };
}

// ---------- uploads from GitHub Actions (keyless: GitHub's OIDC token proves which repo is calling) ----------
const GH_ISSUER = 'https://token.actions.githubusercontent.com';
export const UPLOAD_AUDIENCE = 'firsttuesdaylist.com/upload';
const UPLOAD_REPOS = new Set(['aharchaoumehdi/first-tuesday-list', 'aharchaoumehdi/ftl-ops']);

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export async function verifyGithub(request) {
  try { return await checkGithubToken(request); } catch (e) { return null; } // a malformed token is just a refusal
}
async function checkGithubToken(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const [h, p, s] = m[1].split('.');
  if (!s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (header.alg !== 'RS256' || claims.iss !== GH_ISSUER || claims.aud !== UPLOAD_AUDIENCE) return null;
  if (!UPLOAD_REPOS.has(claims.repository) || claims.ref !== 'refs/heads/main') return null;
  const now = Date.now() / 1000;
  if (!(claims.exp > now) || claims.nbf > now + 60) return null;
  const jwks = await fetch(GH_ISSUER + '/.well-known/jwks', { cf: { cacheTtl: 3600 } }).then(r => r.json());
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(h + '.' + p));
  return ok ? claims : null;
}
