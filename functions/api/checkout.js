// POST /api/checkout {plan: "monthly" | "yearly", email?} → {url} of a Stripe Checkout page.
// The founding price applies automatically while founding seats are left.
import { json, isOpen, sameOrigin, priceFor, stripe, foundingTaken, FOUNDING_SEATS, normEmail, validEmail } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!isOpen(env)) return json({ error: 'Membership opens soon.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const body = await request.json().catch(() => ({}));
  const cycle = body.plan === 'yearly' ? 'yearly' : 'monthly';
  const founding = await foundingTaken(env) < FOUNDING_SEATS;
  const plan = (founding ? 'founding_' : '') + cycle;
  const origin = new URL(request.url).origin;
  const email = normEmail(body.email);
  try {
    const session = await stripe(env, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: await priceFor(env, plan), quantity: 1 }],
      success_url: origin + '/welcome?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/pricing?canceled=1',
      customer_email: validEmail(email) ? email : undefined,
      allow_promotion_codes: 'true',
      billing_address_collection: env.STRIPE_TAX === 'on' ? 'required' : 'auto',
      automatic_tax: env.STRIPE_TAX === 'on' ? { enabled: 'true' } : undefined,
      subscription_data: { metadata: { plan } },
      custom_text: { submit: { message: 'By subscribing you agree to the First Tuesday List Terms of Use (firsttuesdaylist.com/terms). Cancel anytime from your account.' } }
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e.message);
    return json({ error: 'Checkout is unavailable right now. Please try again in a minute.' }, 502);
  }
}
