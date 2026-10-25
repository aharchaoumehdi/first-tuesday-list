// POST /api/portal → {url} of the member's Stripe billing page (card, invoices, cancel).
import { json, isOpen, sameOrigin, getMember, sessionEmail, stripe } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!isOpen(env)) return json({ error: 'Membership opens soon.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  // signed in is enough: a member whose card failed still needs billing to fix it
  const m = await getMember(env, await sessionEmail(env, request));
  if (!m || !m.customer) return json({ error: 'Please sign in first.' }, 401);
  try {
    const s = await stripe(env, 'POST', '/v1/billing_portal/sessions', { customer: m.customer, return_url: new URL(request.url).origin + '/members' });
    return json({ url: s.url });
  } catch (e) {
    console.error(e.message);
    return json({ error: 'Billing is unavailable right now. Please try again in a minute.' }, 502);
  }
}
