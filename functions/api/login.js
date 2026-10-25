// POST /api/login {email}: email a one-time sign-in link (members only; the answer is the same either way).
// GET  /api/login?t=<token>: the link itself. Signs the browser in and opens the member home.
import { json, isOpen, sameOrigin, normEmail, validEmail, getMember, isActive, newLoginLink, useLoginLink, sendEmail, signInEmail, startSession } from '../../lib/members.js';

export async function onRequestPost({ request, env }) {
  if (!isOpen(env)) return json({ error: 'Membership opens soon.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);
  const email = normEmail((await request.json().catch(() => ({}))).email);
  if (!validEmail(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  const done = json({ ok: true, message: 'If that email belongs to a member, a sign-in link is on its way. It expires in 20 minutes.' });
  // at most one email a minute and five an hour per address
  const rate = 'rate:' + email, n = parseInt(await env.MEMBERS.get(rate) || '0', 10);
  if (n >= 5 || await env.MEMBERS.get(rate + ':1m')) return done;
  if (!isActive(await getMember(env, email))) return done;
  await env.MEMBERS.put(rate, String(n + 1), { expirationTtl: 3600 });
  await env.MEMBERS.put(rate + ':1m', '1', { expirationTtl: 60 });
  const mail = signInEmail(await newLoginLink(env, email, new URL(request.url).origin), false);
  if (!await sendEmail(env, email, mail.subject, mail.html, mail.text)) {
    return json({ error: 'We could not send the email. Write to leads@firsttuesdaylist.com and we will sort it out.' }, 502);
  }
  return done;
}

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  if (!isOpen(env)) return Response.redirect(origin + '/pricing', 302);
  const email = await useLoginLink(env, new URL(request.url).searchParams.get('t'));
  if (!email || !isActive(await getMember(env, email))) return Response.redirect(origin + '/signin?expired=1', 302);
  return new Response(null, { status: 302, headers: { Location: origin + '/members', 'Set-Cookie': await startSession(env, email), 'Cache-Control': 'no-store' } });
}
