// Interactive Google map of every property in the current sale.
// FTLMap.mount(element, { layout: 'home' | 'full', height: 620 })
window.FTLMap = (function () {
  const TYPE = { single_family: ['Single family', '#1E5BD8'], condo_townhome: ['Condo / townhome', '#8A4FD1'], multifamily: ['Multifamily', '#F28C1B'], commercial: ['Commercial', '#D2141C'], vacant_land: ['Vacant land', '#3E9B47'] };
  const typeInfo = t => TYPE[t] || ['Other', '#8A97AA'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FAV = d => 'https://www.google.com/s2/favicons?sz=64&domain=' + d;
  // Rent lens: HUD's public Small Area Fair Market Rents by ZIP and bedroom count (area-level, never one home's rent).
  // Low to high: gold, sage, teal, deep teal, navy. Five steps, cut at this sale's 20/40/60/80th percentiles.
  const RAMP = ['#E8B53A', '#93BF73', '#2E9E8F', '#1F6688', '#13294B'];
  const RENT_TYPES = { single_family: 1, condo_townhome: 1 }; // members get an estimate for whole homes only
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const kfmt = v => '$' + +(v / 1000).toFixed(2) + 'k';
  let rentLoading = null;
  const loadRent = () => rentLoading || (rentLoading = fetch('/data/hud-rent.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const STAR = '<svg class="sl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.9l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/></svg>';
  let mapsLoading = null;

  function loadMaps() {
    const key = (window.FTL_CONFIG || {}).mapsKey;
    if (!key) return Promise.reject(new Error('no key'));
    if (window.google && window.google.maps) return Promise.resolve();
    if (!mapsLoading) mapsLoading = new Promise((ok, fail) => {
      window.__ftlMapsReady = ok;
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&loading=async&callback=__ftlMapsReady';
      s.async = true; s.onerror = fail; document.head.appendChild(s);
    });
    return mapsLoading;
  }
  // the compare boxes and tray (assets/compare.js); the map works without them if it fails to load
  function loadCompare() {
    if (window.FTLCompare) return Promise.resolve();
    return new Promise(ok => { const s = document.createElement('script'); s.src = '/assets/compare.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
  }
  function loadClusterer() {
    if (window.markerClusterer) return Promise.resolve();
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  }
  const links = r => {
    const a = r.addr.replace('#', '');
    return {
      zillow: 'https://www.zillow.com/homes/' + [a, r.city, 'TX', r.zip].join(',-').replace(/\s+/g, '-') + '_rb/',
      realtor: 'https://www.realtor.com/realestateandhomes-search/' + [a, r.city, 'TX', r.zip].join('_').replace(/\s+/g, '-'),
      redfin: 'https://www.google.com/search?q=' + encodeURIComponent('site:redfin.com ' + r.addr + ' ' + r.city + ' TX ' + r.zip),
      street: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + r.lat + ',' + r.lon,
      directions: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.addr + ', ' + r.city + ', TX ' + r.zip)
    };
  };

  async function mount(root, opts) {
    const o = Object.assign({ layout: 'home', height: 620 }, opts || {});
    const cmpReady = loadCompare();
    const cur = await fetch('/data/current.json').then(r => r.json());
    const data = await fetch('/data/sale-' + cur.current_sale + '.json').then(r => r.json());
    const stats = await fetch('/data/stats-' + cur.current_sale + '.json').then(r => r.json());
    const RENT = await loadRent();
    const rows = data.rows.filter(r => r.lat != null);
    // the visitor's shortlist (site.js): save stars on the list and the card, a filter chip, a mark on saved pins
    const SL = window.FTL && FTL.shortlist;
    if (SL) SL.know(data.rows, cur.current_sale);
    const saved = id => Boolean(SL && SL.has(id));
    const saveStar = r => SL ? `<button class="sl-star" type="button" data-sl="${esc(r.id)}" data-sl-addr="${esc(r.addr)}" aria-pressed="${saved(r.id)}" aria-label="${saved(r.id) ? 'Remove' : 'Save'} ${esc(r.addr)} ${saved(r.id) ? 'from' : 'to'} my shortlist">${STAR}</button>` : '';
    // members get each property's numbers (from /api/member/sale, never from the public data files)
    const ST = window.FTL && FTL.status ? await FTL.status : { open: false, member: null };
    const M = ST.member ? await fetch('/api/member/sale', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => d && d.rows).catch(() => null) : null;
    const mem = id => (M && M[id]) || {};
    const usd = v => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
    const joinText = ST.open ? 'Become a member' : 'Join the waitlist';
    const P = new URLSearchParams(location.search);
    // /map?zips=77084,77449 shows only those ZIPs (links from the ZIP alert widget and its confirmation)
    const zipsParam = (P.get('zips') || '').split(',').filter(z => /^\d{5}$/.test(z));
    const full = o.layout === 'full';
    // /map?lens=rent&br=3 opens the rent lens (the home page's Rent by ZIP links here)
    const S = { type: 'all', newOnly: false, dry: false, q: (P.get('q') || '').trim().toLowerCase(), mode: full && RENT && P.get('lens') === 'rent' ? 'rent' : 'type', sel: null,
      br: Math.min(4, Math.max(1, parseInt(P.get('br'), 10) || 3)), zips: zipsParam.length ? zipsParam : null, byEquity: Boolean(M), eq100: false, midValue: false, notOcc: false, saved: false };
    const isNew = r => r.first >= stats.new_since;
    const rentOf = (zip, br = S.br) => (RENT && RENT.zips[zip] ? RENT.zips[zip][br] : null);
    // the five legend steps for the chosen bedroom count, rounded to $50 so the legend reads cleanly
    let cuts = [];
    const setCuts = () => {
      const v = rows.map(r => rentOf(r.zip)).filter(x => x != null).sort((a, b) => a - b);
      cuts = v.length ? [...new Set([0.2, 0.4, 0.6, 0.8].map(p => Math.round(v[Math.floor(v.length * p)] / 50) * 50))] : [];
    };
    const tierOf = x => x == null ? -1 : cuts.filter(c => x >= c).length;
    const rentColor = zip => { const t = tierOf(rentOf(zip)); return t < 0 ? '#8A97AA' : RAMP[Math.round(t * (RAMP.length - 1) / Math.max(1, cuts.length))]; };
    const colorOf = r => S.mode === 'new' ? (isNew(r) ? '#D2141C' : '#7C8797') : S.mode === 'rent' ? rentColor(r.zip) : typeInfo(r.type)[1];
    const cityOf = {}; rows.forEach(r => { (cityOf[r.zip] = cityOf[r.zip] || {})[r.city] = (cityOf[r.zip][r.city] || 0) + 1; });
    const zipCity = z => Object.entries(cityOf[z] || {}).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
    setCuts();
    await cmpReady;
    const C = window.FTLCompare;
    const cmpBox = (r, cls) => C ? C.box(r, cls) : '';

    root.classList.add('fm');
    root.classList.add(full ? 'fm-full' : 'fm-home');
    const panel = `<div class="fm-panel">
      <div class="fm-count"><span class="disp" style="font-size:22px;font-weight:800">${esc(cur.label || '')} sale map</span><span class="mono" style="font-size:13px;font-weight:600"><span data-k="count">${rows.length}</span> / ${data.rows.length}</span></div>
      <div class="fm-inview"><span data-k="inview"></span><button class="chip" data-k="all" hidden>Show all</button></div>
      ${window.FTLAlerts ? `<div class="fm-zips" data-k="zipsf" hidden></div>
      <button type="button" class="fm-watch" data-k="watch"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Watch this area<small data-k="watchz"></small></button>` : ''}
      <label class="sr" for="fmq-${o.layout}">Find an address, ZIP or city</label>
      <input id="fmq-${o.layout}" type="search" placeholder="Find an address, ZIP or city" data-k="q">
      <div class="fm-chips" data-k="types"></div>
      <div class="fm-chips"><button class="chip" data-k="new" aria-pressed="false">New this week</button><button class="chip" data-k="dry" aria-pressed="false">Outside flood zone</button>
      ${SL ? `<button class="chip fm-saved" data-k="saved" aria-pressed="false" title="Show only the properties on my shortlist">${STAR}My shortlist <span data-k="savedN"></span></button>` : ''}</div>
      <div class="fm-lens" role="group" aria-label="Color the pins by"><span class="fm-lens-l">Pin color</span>
      <button class="chip" data-mode="type" aria-pressed="true">Type</button><button class="chip" data-mode="new" aria-pressed="false" title="Color pins by new vs earlier">New</button>
      ${RENT ? `<button class="chip fm-lens-rent" data-mode="rent" aria-pressed="false" title="Color pins by what their ZIP rents for (HUD)"><span class="fm-swatch" aria-hidden="true"></span>Rent</button>` : ''}</div>
      <div class="fm-rent" data-k="rent" hidden></div>
      ${M ? `<div class="fm-chips fm-member"><span class="tag tag-member">Member</span><button class="chip" data-k="byEquity">Sort: equity ↓</button><button class="chip" data-k="eq100">Equity over $100k</button>
      <button class="chip" data-k="midValue">Value $150k–$500k</button><button class="chip" data-k="notOcc">Not owner-occupied</button></div>`
      : `<a class="fm-member-lock" href="/pricing"><span class="ico-lock"></span>Sort by equity, filter by value and occupancy: <strong>${joinText}</strong></a>`}
      <div class="fm-legend" data-k="legend"></div></div>`;
    const stage = `<div class="fm-stage" style="${full ? '' : 'height:' + o.height + 'px'}"><div class="fm-map" data-k="map"></div>
      <div class="fm-nokey" data-k="nokey"><div class="card" style="max-width:440px">The live map needs the Google Maps key. The property list still works.</div></div></div>`;
    const card = `<div class="fm-card" data-k="card"></div>`;
    root.innerHTML = full
      ? `<div class="fm-side">${panel}<div class="fm-list" data-k="list"></div></div>${stage}${card}`
      : `${panel}${stage}${card}<div class="fm-strip"><div class="t" data-k="stripTitle"></div><div class="row" data-k="strip"></div></div>`;
    if (!full) root.querySelector('.fm-card').style.bottom = '124px';
    const $ = k => root.querySelector(`[data-k="${k}"]`);

    let map, clusterer, markers = {}, sv, clustered = true;
    const memberOk = r => { if (!M) return true; const m = mem(r.id);
      return (!S.eq100 || m.equity >= 100000) && (!S.midValue || (m.value >= 150000 && m.value <= 500000)) && (!S.notOcc || m.occ === false); };
    const visible = () => rows.filter(r => (S.type === 'all' || r.type === S.type) && (!S.newOnly || isNew(r)) && (!S.dry || !r.sfha) && (!S.saved || saved(r.id)) && memberOk(r) && (!S.zips || S.zips.includes(r.zip))
      && (!S.q || (r.addr + ' ' + r.city + ' ' + r.zip + ' ' + r.id).toLowerCase().includes(S.q)));
    const eqOf = r => { const e = mem(r.id).equity; return e == null ? -Infinity : e; };
    const ordered = v => v.slice().sort((a, b) => (S.byEquity && M ? eqOf(b) - eqOf(a) : 0) || (isNew(b) - isNew(a)) || a.zip.localeCompare(b.zip) || a.addr.localeCompare(b.addr));
    const numLine = r => { const m = mem(r.id);
      return M ? `<span class="fm-num"><span>${usd(m.value)}</span><span class="e">${m.equity == null ? 'Equity —' : 'Eq. ' + usd(m.equity) + (m.share != null ? ' · ' + Math.round(m.share * 100) + '%' : '')}</span></span>` : ''; };
    // The list and photo strip show only what the map currently shows.
    const inView = v => { const b = map && map.getBounds(); return b ? v.filter(r => b.contains({ lat: r.lat, lng: r.lon })) : v; };
    // on wide screens the home map's filter panel covers its left side
    const pad = () => full || innerWidth <= 820 ? 40 : { top: 30, right: 30, bottom: 30, left: 340 };
    function fitTo(v) {
      if (!map || !v.length) return;
      if (v.length === 1) { map.setCenter({ lat: v[0].lat, lng: v[0].lon }); map.setZoom(16); return; }
      const b = new google.maps.LatLngBounds(); v.forEach(r => b.extend({ lat: r.lat, lng: r.lon }));
      map.fitBounds(b, pad());
    }

    function select(id, pan) {
      S.sel = id; render();
      const r = rows.find(x => x.id === id);
      if (map && r && pan) { map.panTo({ lat: r.lat, lng: r.lon }); if (map.getZoom() < 15) map.setZoom(16); }
    }
    function step(d) {
      const v = ordered(visible()); if (!v.length) return;
      const i = Math.max(0, v.findIndex(r => r.id === S.sel));
      select(v[(i + d + v.length) % v.length].id, true);
    }
    function streetView(r) {
      if (!map) { window.open(links(r).street, '_blank', 'noopener'); return; }
      const target = new google.maps.LatLng(r.lat, r.lon);
      // nearest first: Google's "best" image near a lot can be a freeway overpass
      const find = (radius, preference) => new Promise(ok => sv.getPanorama({ location: target, radius, preference, source: google.maps.StreetViewSource.OUTDOOR }, (res, status) => ok(status === 'OK' ? res : null)));
      find(60, google.maps.StreetViewPreference.NEAREST).then(res => res || find(120, google.maps.StreetViewPreference.BEST)).then(res => {
        if (!res) { window.open(links(r).street, '_blank', 'noopener'); return; }
        const p = map.getStreetView();
        p.setPano(res.location.pano);
        p.setPov({ heading: google.maps.geometry.spherical.computeHeading(res.location.latLng, target), pitch: 4 });
        p.setZoom(1); p.setVisible(true);
      });
    }
    // The ZIP's HUD rent (public, area-level) and, behind the lock, this home's own estimate and gross yield (members).
    function rentBox(r) {
      const z = rentOf(r.zip);
      if (z == null) return '';
      const home = RENT_TYPES[r.type], m = mem(r.id);
      const own = !home ? `<div class="fm-rentnote">HUD rents describe homes. Members get no rent estimate for ${esc(typeInfo(r.type)[0].toLowerCase())} property.</div>`
        : M ? `<div class="fm-rentown"><span>This home${m.rent_beds ? ' · ' + m.rent_beds + ' BR' : ''}</span><b>${m.rent ? money(m.rent) + '/mo' : 'Rent —'}${m.rent_yield != null ? ' · ' + (m.rent_yield * 100).toFixed(1) + '% gross yield' : ''}</b></div>`
        : `<a class="lock fm-rentlock" href="/pricing"><span class="t">This home's estimated rent and gross yield</span><span class="b"><span class="redact"><i></i></span><span class="redact"><i style="width:38px;--d:.22s"></i></span><strong>Members</strong></span></a>`;
      return `<div class="fm-rentbox"><div class="r1"><span class="dot" style="background:${rentColor(r.zip)}"></span><span>Typical rent in ${esc(r.zip)}</span>
        <b class="mono">${money(z)}/mo</b></div><div class="r2">for ${S.br} BR · HUD FY2027 area rent, not this home's${S.mode !== 'rent' ? ` · <button type="button" class="fm-linkbtn" data-a="lens">See the rent map</button>` : ''}</div>${own}</div>`;
    }
    function renderCard() {
      const el = $('card'); const r = rows.find(x => x.id === S.sel);
      if (!r) { el.style.display = 'none'; return; }
      const L = links(r), v = ordered(visible()), pos = v.findIndex(x => x.id === r.id);
      el.innerHTML = `<div class="ph">${r.photo ? `<img src="${esc(r.photo)}" alt="Aerial photo of ${esc(r.addr)}">` : ''}<span class="lbl">Aerial · HCAD 2026 · lot outlined</span>
        ${SL ? `<button class="sl-pill" type="button" data-sl="${esc(r.id)}" data-sl-addr="${esc(r.addr)}" data-on="On my shortlist" data-off="Save to shortlist" aria-pressed="${saved(r.id)}">${STAR}<span class="sl-t">${saved(r.id) ? 'On my shortlist' : 'Save to shortlist'}</span></button>` : ''}
        <button class="x" aria-label="Close">×</button></div>
        <div class="fm-body">
        <div class="cmp-row"><div><div style="font-weight:800;font-size:17px">${esc(r.addr)}</div><div style="font-size:12px;color:var(--muted)">${esc(r.city)}, TX ${esc(r.zip)} · ${typeInfo(r.type)[0]} · ${esc(r.id)}</div></div>${cmpBox(r)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${isNew(r) ? '<span class="tag tag-new">New this week</span>' : ''}<span class="tag ${r.sfha ? 'tag-flood' : 'tag-plain'}">Flood zone ${esc(r.zone || '—')}${r.sfha ? ' (SFHA)' : ''}</span><span class="tag tag-plain">${r.notice === 'hoa' ? 'HOA lien' : 'Mortgage foreclosure'}</span></div>
        <div style="font-size:13px"><strong>${esc(cur.label_day || '')} · ${esc(r.window || '')}</strong><br><span style="color:var(--muted)">${esc((r.location || '').split(',').slice(0, 2).join(','))}</span></div>
        ${rentBox(r)}
        ${M ?(m => `<div class="fm-nums"><div><span>Value</span><b>${usd(m.value)}</b></div><div><span>Est. balance</span><b>${usd(m.balance)}</b></div>
          <div class="t"><span>Est. equity</span><b>${usd(m.equity)}${m.share != null ? ' · ' + Math.round(m.share * 100) + '%' : ''}</b></div>
          <div><span>Beds · sq ft · built</span><b>${m.beds ?? '—'} · ${m.sqft ? m.sqft.toLocaleString('en-US') : '—'} · ${m.year ?? '—'}</b></div></div>`)(mem(r.id))
        : `<div class="lock"><span>Value, estimated equity, loan, beds and sq ft come with membership. <a href="/pricing" style="font-weight:700">${joinText}</a></span></div>`}
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><a class="btn btn-red" href="/property/${esc(r.id)}" style="min-height:36px;font-size:13px">Full details</a><button class="btn btn-navy" data-a="sv" style="min-height:36px;font-size:13px">Street View here</button>
        ${r.notice_url ? `<a class="btn btn-ghost" style="min-height:36px;font-size:13px" href="/notice/${esc(r.id)}" download title="Downloads the county clerk's official notice, named with this address">Save notice PDF</a>` : ''}
        <a class="btn btn-ghost" style="min-height:36px;font-size:13px" href="${L.directions}" target="_blank" rel="noopener">Directions</a></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:11px;font-weight:700;color:var(--muted)">See it on</span>
        <a class="ext" href="${L.zillow}" target="_blank" rel="noopener"><img src="${FAV('zillow.com')}" alt="">Zillow</a><a class="ext" href="${L.realtor}" target="_blank" rel="noopener"><img src="${FAV('realtor.com')}" alt="">Realtor.com</a><a class="ext" href="${L.redfin}" target="_blank" rel="noopener"><img src="${FAV('redfin.com')}" alt="">Redfin</a></div>
        <div class="fm-nav"><button class="arrow" data-a="prev" aria-label="Previous property">‹</button><span style="flex:1;text-align:center;font-size:12px;color:var(--muted)">Property ${pos + 1} of ${v.length}</span><button class="arrow" data-a="next" aria-label="Next property">›</button></div>
        </div>`;
      el.style.display = 'block';
      el.querySelector('.x').onclick = () => { S.sel = null; render(); };
      el.querySelector('[data-a=sv]').onclick = () => streetView(r);
      el.querySelector('[data-a=prev]').onclick = () => step(-1);
      el.querySelector('[data-a=next]').onclick = () => step(1);
      const lensBtn = el.querySelector('[data-a=lens]');
      if (lensBtn) lensBtn.onclick = () => setMode('rent');
    }
    // the rent lens panel: bedroom choice, the focus ZIP's rent, the legend and the source
    function renderRent() {
      const box = $('rent'); if (!box) return;
      box.hidden = S.mode !== 'rent';
      if (S.mode !== 'rent') return;
      const v = visible(), iv = inView(v);
      const sel = rows.find(x => x.id === S.sel);
      const qz = /^\d{5}$/.test(S.q) && rentOf(S.q) != null ? S.q : null;
      const counts = {}; iv.forEach(r => { counts[r.zip] = (counts[r.zip] || 0) + 1; });
      const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const zip = sel ? sel.zip : qz || (busiest && busiest[0]);
      const zr = iv.map(r => rentOf(r.zip)).filter(x => x != null);
      const nz = Object.keys(counts).length;
      const lo = zr.length ? Math.min(...zr) : null, hi = zr.length ? Math.max(...zr) : null;
      const steps = [null, ...cuts];
      const tiers = steps.map((c, i) => {
        const next = steps[i + 1];
        const label = i === 0 ? '< ' + kfmt(next) : next == null ? kfmt(c) + '+' : kfmt(c) + '–' + kfmt(next).slice(1);
        const n = v.filter(r => tierOf(rentOf(r.zip)) === i).length;
        return `<li><i style="background:${RAMP[Math.round(i * (RAMP.length - 1) / Math.max(1, cuts.length))]}"></i><span>${label}</span><small>${n}</small></li>`;
      }).join('');
      box.innerHTML = `<div class="fm-rent-h"><span class="disp">Rent lens</span><span class="fm-seg" role="group" aria-label="Bedrooms">${[1, 2, 3, 4].map(b => `<button class="chip" data-br="${b}" aria-pressed="${S.br === b}">${b} BR</button>`).join('')}</span></div>
        ${zip ? `<div class="fm-rent-zip"><span class="dot" style="background:${rentColor(zip)}"></span><span>Typical rent in <strong>${esc(zip)}</strong>${zipCity(zip) ? ' <span class="c">' + esc(zipCity(zip)) + '</span>' : ''}: <b class="mono">${money(rentOf(zip))}/mo</b> for ${S.br} BR <span class="c">(HUD FY2027)</span></span></div>` : ''}
        <div class="fm-rent-cap"><span>Pin color: the ZIP's ${S.br} BR rent</span>${zr.length > 1 && nz > 1 ? `<span>In view: ${kfmt(lo)}–${kfmt(hi).slice(1)} · ${nz} ZIPs</span>` : ''}</div>
        <ul class="fm-ramp" aria-label="Pin colors: HUD rent for ${S.br} BR, per month, with the number of properties">${tiers}</ul>
        <div class="fm-rent-src">Pins show their ZIP's rent, not the home's. Source: <a href="${esc(RENT.url)}" target="_blank" rel="noopener">HUD Small Area Fair Market Rents FY2027</a>, utilities included.</div>
        ${M ? '' : `<a class="fm-member-lock" href="/pricing"><span class="ico-lock"></span><span>Each home's estimated rent and gross yield: <strong>${joinText}</strong></span></a>`}`;
      box.querySelectorAll('[data-br]').forEach(b => b.onclick = () => { S.br = +b.dataset.br; setCuts(); syncUrl(); render(); });
    }
    function syncUrl() {
      if (!full || !history.replaceState) return;
      const u = new URL(location.href);
      if (S.mode === 'rent') { u.searchParams.set('lens', 'rent'); u.searchParams.set('br', S.br); } else { u.searchParams.delete('lens'); u.searchParams.delete('br'); }
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
    function setMode(mode) { S.mode = mode; syncUrl(); render(); }
    function renderList() {
      const v = visible(), iv = ordered(inView(v)), zoomed = iv.length < v.length;
      $('inview').textContent = !map ? '' : iv.length ? (zoomed ? `${iv.length} in this map view` : `All ${v.length} in view`) : 'None in this map view';
      $('all').hidden = !zoomed;
      $('all').textContent = `Show all ${v.length}`;
      watchLabel(v, iv);
      if (full) {
        $('list').innerHTML = iv.slice(0, 250).map(r => `<div class="fm-row"><button class="fm-item ${S.sel === r.id ? 'sel' : ''}" data-id="${r.id}">
          <img loading="lazy" src="${esc(r.photo)}" alt=""><span style="min-width:0;display:flex;flex-direction:column;gap:3px"><strong style="font-size:14px">${esc(r.addr)}</strong>
          <span style="font-size:12px;color:var(--muted)">${esc(r.city)} ${esc(r.zip)} · ${typeInfo(r.type)[0]}</span>
          ${numLine(r)}${S.mode === 'rent' && rentOf(r.zip) != null ? `<span class="fm-zr"><span class="dot" style="background:${rentColor(r.zip)}"></span>ZIP ${esc(r.zip)} · ${S.br} BR · ${money(rentOf(r.zip))}/mo</span>` : ''}<span>${isNew(r) ? '<span class="tag tag-new">New</span> ' : ''}${r.sfha ? '<span class="tag tag-flood">Flood ' + esc(r.zone) + '</span>' : ''}</span></span></button>${saveStar(r)}${cmpBox(r)}</div>`).join('')
          + (iv.length > 250 ? `<div style="padding:10px 14px;font-size:12px;color:var(--muted)">Showing 250 of ${iv.length}. Zoom in, search or filter to narrow.</div>` : '')
          + (!iv.length ? `<div style="padding:16px 14px;font-size:14px;color:var(--muted)">${S.saved && SL && !SL.count() ? 'Your shortlist is empty. Tap the star on any property to save it.' : 'No properties in this part of the map. Zoom out or press Show all.'}</div>` : '');
        $('list').querySelectorAll('.fm-item').forEach(b => b.onclick = () => select(b.dataset.id, true));
      } else {
        const i = Math.max(0, iv.findIndex(r => r.id === S.sel));
        const start = Math.max(0, i - 2);
        $('stripTitle').textContent = !iv.length ? 'None in this map view' : zoomed ? `${iv.length} in this map view` : `Browse ${v.length} properties`;
        $('strip').innerHTML = iv.slice(start, start + 30).map(r => `<button class="fm-th ${S.sel === r.id ? 'sel' : ''}" data-id="${r.id}"><img loading="lazy" src="${esc(r.photo)}" alt=""><span>${esc(r.addr)}</span><small>${esc(r.city)} · ${isNew(r) ? 'New' : typeInfo(r.type)[0]}</small></button>`).join('')
          || '<div style="font-size:13px;color:var(--muted);padding:8px 0">Zoom out or press Show all to see properties here.</div>';
        $('strip').querySelectorAll('.fm-th').forEach(b => b.onclick = () => select(b.dataset.id, true));
      }
    }
    // "Watch this area": the ZIPs the visitor is looking at. A few ZIPs in view (or in the filtered set) become the alert;
    // a county-wide view opens the widget with the busiest ZIPs in view as suggestions instead.
    const zipCounts = list => { const c = {}; list.forEach(r => { c[r.zip] = (c[r.zip] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(x => x[0]); };
    let watchPlan = { areas: [], picks: null };
    function watchLabel(v, iv) {
      if (!$('watch')) return;
      const inv = zipCounts(map ? iv : v), filt = zipCounts(v);
      watchPlan = inv.length && inv.length <= 8 ? { areas: inv, picks: null, why: 'in view' }
        : filt.length && filt.length <= 8 ? { areas: filt, picks: null, why: 'filtered' }
        : { areas: [], picks: inv.slice(0, 8), why: 'busy' };
      const a = watchPlan.areas;
      $('watchz').textContent = a.length ? ' · ' + (a.length <= 2 ? a.join(', ') : a.length + ' ZIPs') : '';
      $('watch').setAttribute('aria-label', a.length ? `Get email alerts for new foreclosures in ${a.join(', ')}` : 'Get email alerts for new foreclosures in an area you pick');
      const zf = $('zipsf');
      zf.hidden = !S.zips;
      if (S.zips) zf.innerHTML = `<span>Your areas: ${esc(S.zips.length <= 4 ? S.zips.join(', ') : S.zips.length + ' ZIPs')}</span><button class="chip" data-k="zipsx" style="min-height:26px">All ZIPs</button>`;
      const x = $('zipsx'); if (x) x.onclick = () => { S.zips = null; history.replaceState(null, '', location.pathname + location.hash); render(); fitTo(visible()); };
    }
    if ($('watch')) $('watch').onclick = () => FTLAlerts.open({ areas: watchPlan.areas, picks: watchPlan.picks,
      picksLabel: watchPlan.why === 'busy' ? 'Busiest in this view' : 'Busiest ZIPs' });

    // saved pins carry a small star; the chip shows how many are saved
    function markSaved() {
      if (!SL) return;
      $('savedN').textContent = SL.count() ? '(' + SL.count() + ')' : '';
      if (map) rows.forEach(r => { const m = markers[r.id]; if (m) m.content.classList.toggle('saved', saved(r.id)); });
    }
    function render() {
      const v = visible();
      markSaved();
      $('count').textContent = v.length;
      $('new').setAttribute('aria-pressed', S.newOnly); $('dry').setAttribute('aria-pressed', S.dry);
      if (SL) $('saved').setAttribute('aria-pressed', S.saved);
      if (M) ['byEquity', 'eq100', 'midValue', 'notOcc'].forEach(k => $(k).setAttribute('aria-pressed', S[k]));
      root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', S.mode === b.dataset.mode));
      root.classList.toggle('fm-rentlens', S.mode === 'rent');
      const opts = [['all', 'All', '#0E1A2B'], ...Object.entries(TYPE).map(([k, t]) => [k, t[0].replace(' / townhome', ''), t[1]])];
      $('types').innerHTML = opts.map(([k, l, c]) => `<button class="chip" data-t="${k}" aria-pressed="${S.type === k}"><span class="dot" style="background:${c}"></span>${l}</button>`).join('');
      $('types').querySelectorAll('button').forEach(b => b.onclick = () => { S.type = b.dataset.t; render(); });
      const L = S.mode === 'new' ? [['New this week', '#D2141C'], ['Earlier notice', '#7C8797']] : Object.values(TYPE);
      $('legend').innerHTML = L.map(([l, c]) => `<span><span class="dot" style="background:${c}"></span>${l}</span>`).join('');
      $('legend').hidden = S.mode === 'rent';
      renderList();
      renderCard();
      renderRent();
      if (map) {
        const ms = v.map(r => { const m = markers[r.id]; m.content.style.setProperty('--c', colorOf(r)); m.content.classList.toggle('sel', r.id === S.sel); m.content.classList.toggle('cmp', Boolean(C && C.has(r.id))); m.zIndex = r.id === S.sel ? 999 : null; return m; });
        markSaved();
        if (S.mode === 'rent') {
          // every pin on its own (no clusters), so the colors read as a rent map of the county
          if (clustered) { clusterer.clearMarkers(); clustered = false; }
          const on = new Set(v.map(r => r.id));
          Object.entries(markers).forEach(([id, m]) => { const want = on.has(id) ? map : null; if (m.map !== want) m.map = want; });
        } else {
          if (!clustered) { Object.values(markers).forEach(m => { m.map = null; }); clustered = true; }
          clusterer.clearMarkers(); clusterer.addMarkers(ms);
        }
      }
    }
    $('q').value = S.q;
    let qTimer;
    $('q').addEventListener('input', e => {
      S.q = e.target.value.trim().toLowerCase(); render();
      // zoom the map to what the search found, so the list shows all of it
      clearTimeout(qTimer); qTimer = setTimeout(() => fitTo(S.q ? visible() : rows), 450);
    });
    $('all').onclick = () => fitTo(visible());
    $('new').onclick = () => { S.newOnly = !S.newOnly; render(); };
    $('dry').onclick = () => { S.dry = !S.dry; render(); };
    if (SL) {
      $('saved').onclick = () => { S.saved = !S.saved; render(); if (S.saved && SL.count()) fitTo(visible()); };
      // a save or remove only redraws what it changes, so keyboard focus stays on the star that was pressed
      window.addEventListener('ftl:shortlist', () => { if (S.saved) render(); else markSaved(); });
    }
    if (M) ['byEquity', 'eq100', 'midValue', 'notOcc'].forEach(k => { $(k).onclick = () => { S[k] = !S[k]; render(); }; });
    root.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
    // ticking a compare box (here, in the pin card or in another tab) marks that pin
    if (C) C.onChange(v => { const ids = new Set(v.map(x => x.id)); Object.entries(markers).forEach(([id, m]) => m.content.classList.toggle('cmp', ids.has(id))); });
    render();

    try {
      await Promise.all([loadMaps(), loadClusterer()]);
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      await google.maps.importLibrary('geometry'); await google.maps.importLibrary('streetView');
      map = new Map($('map'), { center: { lat: 29.83, lng: -95.4 }, zoom: full ? 10 : 9.6, mapId: (window.FTL_CONFIG || {}).mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'], position: google.maps.ControlPosition.TOP_RIGHT },
        zoomControl: true, zoomControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM }, cameraControl: false,
        streetViewControl: true, fullscreenControl: true, clickableIcons: false, gestureHandling: full ? 'greedy' : 'cooperative' });
      // "Show all" sits next to the + / − buttons, so a zoomed-in visitor can always get back to the whole county
      const home = document.createElement('button');
      home.className = 'fm-home-btn'; home.type = 'button'; home.title = 'Zoom out to every property';
      home.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Show all';
      home.onclick = () => fitTo(visible());
      map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(home);
      map.addListener('idle', () => { root.classList.toggle('fm-labels', map.getZoom() >= 15); root.classList.toggle('fm-far', map.getZoom() < 12); renderList(); renderRent(); });
      sv = new google.maps.StreetViewService();
      rows.forEach(r => {
        const el = document.createElement('div'); el.className = 'fm-pin';
        const num = (r.addr.match(/^\d+[A-Z]?/) || [''])[0];
        el.innerHTML = '<i></i>' + (num ? `<b>${esc(num)}</b>` : '');
        const m = new AdvancedMarkerElement({ position: { lat: r.lat, lng: r.lon }, content: el, title: r.addr + ', ' + r.city, gmpClickable: true });
        m.addEventListener('gmp-click', () => select(r.id, false));
        markers[r.id] = m;
      });
      clusterer = new markerClusterer.MarkerClusterer({ map, markers: [], algorithmOptions: { maxZoom: 13 } });
      render();
      // /map#FRCL-2026-7106 opens that property (links from the property pages)
      const want = decodeURIComponent(location.hash.slice(1));
      if (want && rows.some(r => r.id === want)) select(want, true);
      else if (S.q || S.zips) fitTo(visible());
    } catch (e) {
      $('nokey').style.display = 'flex';
    }
    // /map?zips=77084&alert=1 opens the alert sign-up for those ZIPs right away (links from emails and ZIP pages)
    if (P.get('alert') === '1' && $('watch') && !root.dataset.alertOpened) { root.dataset.alertOpened = '1'; $('watch').click(); }
    return { stats };
  }
  return { mount };
})();
