// POST /api/claim {session_id}: the welcome page, right after Stripe Checkout. Confirms the payment with Stripe,
// records the member (the webhook does too; whichever comes first) and signs this browser in.
import { json, isOpen, sameOrigin, stripe, memberFromSubscription, startSession, isActive, newLoginLink, sendEmail, signInEmail } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!isOpen(env)) return json({ error: 'Membership opens soon.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const { session_id: id } = await request.json().catch(() => ({}));
  if (!/^cs_[A-Za-z0-9_]+$/.test(id || '')) return json({ error: 'Unknown checkout' }, 400);
  let cs;
  try {
    cs = await stripe(env, 'GET', '/v1/checkout/sessions/' + id, { expand: ['subscription'] });
  } catch (e) { return json({ error: 'Unknown checkout' }, 404); }
  if (cs.status !== 'complete' || !cs.subscription) return json({ error: 'This checkout is not complete.' }, 409);
  // a checkout link signs someone in only within a day of paying, and only once
  if (Date.now() / 1000 - cs.created > 86400) return json({ error: 'This welcome link has expired. Sign in with your email instead.', expired: true }, 410);
  const once = 'claimed:' + id;
  if (await env.MEMBERS.get(once)) return json({ error: 'This welcome link was already used. Sign in with your email instead.', expired: true }, 410);
  await env.MEMBERS.put(once, '1', { expirationTtl: 2 * 86400 });
  const email = (cs.customer_details && cs.customer_details.email) || cs.customer_email;
  const m = await memberFromSubscription(env, cs.subscription, email);
  if (!isActive(m)) return json({ error: 'Your payment is still processing. We will email you as soon as it clears.' }, 409);
  const mail = signInEmail(await newLoginLink(env, m.email, new URL(request.url).origin), true);
  await sendEmail(env, m.email, mail.subject, mail.html, mail.text);
  return json({ email: m.email, plan: m.plan, founding: m.founding }, 200, { 'Set-Cookie': await startSession(env, m.email) });
}
