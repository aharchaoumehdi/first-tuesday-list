// POST /api/stripe-webhook: Stripe tells us about payments and subscription changes. Signed with STRIPE_WEBHOOK_SECRET.
// Events to send (Stripe → Developers → Webhooks): checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.
import { json, isOpen, verifyStripe, stripe, memberFromSubscription } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!isOpen(env)) return json({ error: 'not configured' }, 503);
  const raw = await request.text();
  if (!await verifyStripe(env, raw, request.headers.get('Stripe-Signature'))) return json({ error: 'bad signature' }, 400);
  const event = JSON.parse(raw);
  const o = event.data && event.data.object;
  try {
    if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
      const sub = await stripe(env, 'GET', '/v1/subscriptions/' + o.subscription);
      await memberFromSubscription(env, sub, (o.customer_details && o.customer_details.email) || o.customer_email);
    } else if (event.type && event.type.startsWith('customer.subscription.')) {
      // re-read it: events can arrive out of order, the subscription itself is current
      const sub = await stripe(env, 'GET', '/v1/subscriptions/' + o.id).catch(() => o);
      await memberFromSubscription(env, sub);
    }
  } catch (e) {
    console.error(event.type, e.message);
    return json({ error: 'retry' }, 500); // Stripe retries for three days
  }
  return json({ received: true });
}
