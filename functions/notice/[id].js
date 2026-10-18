// GET /notice/<id>: the county clerk's notice PDF, downloaded under the
// property's address so every saved file has a unique, readable name.
// Only notices listed in /data/notices.json are fetched (no open proxy).
const COUNTY = 'cclerk.hctx.net';

export async function onRequestGet({ params, request, env }) {
  const list = await env.ASSETS.fetch(new URL('/data/notices.json', request.url)).then(r => r.json());
  const n = list[params.id];
  if (!n) return new Response('Notice not found', { status: 404 });
  const src = new URL(n.u);
  if (src.hostname !== COUNTY) return new Response('Notice not found', { status: 404 });

  let pdf;
  try {
    pdf = await fetch(src, { headers: { 'User-Agent': 'FirstTuesdayList/1.0 (+https://firsttuesdaylist.com)' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  } catch (e) { pdf = null; }
  // if the county is down or answers with something other than a PDF, send the visitor there instead
  if (!pdf || !pdf.ok || !/pdf/i.test(pdf.headers.get('content-type') || '')) return Response.redirect(n.u, 302);

  const ascii = n.f.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  return new Response(pdf.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n.f)}`,
      'Cache-Control': 'public, max-age=86400',
      'X-Robots-Tag': 'noindex'
    }
  });
}
