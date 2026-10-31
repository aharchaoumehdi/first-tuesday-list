// GET /compare?ids=A,B,C : serves the static compare.html, with its title and Open Graph tags rewritten for those
// properties, so a link pasted into iMessage, WhatsApp, Slack or email shows "Compare 3 properties: 3643 Raintree
// Village Dr, ..." and the first property's aerial photo instead of the generic text. Public fields only.
const okId = id => /^[A-Z]{2,6}-\d{4}-\d{1,7}$/.test(id);
const TYPE = { single_family: 'single family', condo_townhome: 'condo / townhome', multifamily: 'multifamily', commercial: 'commercial', vacant_land: 'vacant land' };

export async function onRequestGet(ctx) {
  const res = await ctx.next();
  const url = new URL(ctx.request.url);
  const ids = [...new Set((url.searchParams.get('ids') || '').split(',').map(s => s.trim().toUpperCase()).filter(okId))].slice(0, 4);
  if (!ids.length || !res.ok) return res;
  try {
    const asset = p => ctx.env.ASSETS.fetch(new URL(p, url.origin)).then(r => r.json());
    const cur = await asset('/data/current.json');
    const data = await asset('/data/sale-' + cur.current_sale + '.json');
    const by = Object.fromEntries(data.rows.map(r => [r.id, r]));
    const rows = ids.map(id => by[id]).filter(Boolean);
    if (!rows.length) return res;
    const title = `Compare ${rows.length === 1 ? '1 property' : rows.length + ' properties'}: ${rows.map(r => r.addr).join(' · ')} · First Tuesday List`;
    const desc = `${rows.length} Harris County ${rows.length === 1 ? 'property' : 'properties'} going to foreclosure auction ${cur.label_day}: `
      + rows.map(r => `${r.addr}, ${r.city} (${TYPE[r.type] || 'other'})`).join('; ') + '. Side by side: type, flood zone, notice, sale window and the county notices.';
    const image = rows[0].photo ? url.origin + rows[0].photo : url.origin + '/assets/og.png';
    const set = v => ({ element(e) { e.setAttribute('content', v); } });
    return new HTMLRewriter()
      .on('title', { element(e) { e.setInnerContent(title); } })
      .on('meta[name="description"]', set(desc))
      .on('meta[property="og:title"]', set(title))
      .on('meta[property="og:description"]', set(desc))
      .on('meta[property="og:image"]', set(image))
      .transform(res);
  } catch (e) {
    return res;   // the page still works; it just keeps the generic preview text
  }
}
