// GET /api/status: is membership open, how many founding seats are left, and who is signed in.
import { json, isOpen, currentMember, sessionEmail, foundingTaken, FOUNDING_SEATS, PLANS } from '../../lib/members.js';

export async function onRequestGet({ request, env }) {
  const open = isOpen(env);
  const left = open ? Math.max(0, FOUNDING_SEATS - await foundingTaken(env)) : FOUNDING_SEATS;
  const m = open ? await currentMember(env, request) : null;
  const signedIn = Boolean(m) || (open && Boolean(await sessionEmail(env, request)));
  return json({
    open, founding_left: left, founding: left > 0,
    prices: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, p.amount / 100])),
    member: m ? { email: m.email, plan: m.plan, founding: m.founding, period_end: m.period_end, cancel_at_period_end: m.cancel_at_period_end, since: m.since } : null,
    signed_in: signedIn
  });
}
