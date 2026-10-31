// GET  /api/unsubscribe?t=<token>: the link in every email. Unsubscribes and says so on a plain page.
// POST /api/unsubscribe?t=<token>: one-click unsubscribe from the mail app (List-Unsubscribe-Post).
import { SITE } from '../../lib/members.js';
import { unsubscribe } from '../../lib/newsletter.js';

const page = (title, text) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · First Tuesday List</title><link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/assets/site.css"></head>
<body><main class="wrap" style="padding:80px 20px;text-align:center;max-width:560px"><h1 class="disp" style="font-size:44px;margin:0 0 12px">${title}</h1>
<p style="font-size:17px;color:#3A4A63">${text}</p><p><a class="btn btn-navy" href="${SITE}">Back to the site</a></p></main></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const sub = await unsubscribe(env, new URL(request.url).searchParams.get('t'));
  return sub ? page("You're unsubscribed", `${sub.email} won't get the Brief anymore. Changed your mind? Sign up again on the home page.`)
    : page('Link not recognized', 'This unsubscribe link is not valid. Reply to any of our emails with "unsubscribe" and we will take you off the list.');
}

export async function onRequestPost({ request, env }) {
  const sub = await unsubscribe(env, new URL(request.url).searchParams.get('t'));
  return new Response(sub ? 'Unsubscribed' : 'Unknown link', { status: sub ? 200 : 404 });
}
