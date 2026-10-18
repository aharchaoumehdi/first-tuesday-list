// Interactive Google map of every property in the current sale.
// FTLMap.mount(element, { layout: 'home' | 'full', height: 620 })
window.FTLMap = (function () {
  const TYPE = { single_family: ['Single family', '#1E5BD8'], condo_townhome: ['Condo / townhome', '#8A4FD1'], multifamily: ['Multifamily', '#F28C1B'], commercial: ['Commercial', '#D2141C'], vacant_land: ['Vacant land', '#3E9B47'] };
  const typeInfo = t => TYPE[t] || ['Other', '#8A97AA'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FAV = d => 'https://www.google.com/s2/favicons?sz=64&domain=' + d;
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
    const cur = await fetch('/data/current.json').then(r => r.json());
    const data = await fetch('/data/sale-' + cur.current_sale + '.json').then(r => r.json());
    const stats = await fetch('/data/stats-' + cur.current_sale + '.json').then(r => r.json());
    const rows = data.rows.filter(r => r.lat != null);
    const S = { type: 'all', newOnly: false, dry: false, q: '', mode: 'type', sel: null };
    const isNew = r => r.first >= stats.new_since;
    const colorOf = r => S.mode === 'new' ? (isNew(r) ? '#D2141C' : '#7C8797') : typeInfo(r.type)[1];
    const full = o.layout === 'full';

    root.classList.add('fm');
    root.classList.add(full ? 'fm-full' : 'fm-home');
    const panel = `<div class="fm-panel">
      <div class="fm-count"><span class="disp" style="font-size:22px;font-weight:800">Nov 3 sale map</span><span class="mono" style="font-size:13px;font-weight:600"><span data-k="count">${rows.length}</span> / ${data.rows.length}</span></div>
      <label class="sr" for="fmq-${o.layout}">Find an address, ZIP or city</label>
      <input id="fmq-${o.layout}" type="search" placeholder="Find an address, ZIP or city" data-k="q">
      <div class="fm-chips" data-k="types"></div>
      <div class="fm-chips"><button class="chip" data-k="new" aria-pressed="false">New this week</button><button class="chip" data-k="dry" aria-pressed="false">Outside flood zone</button>
      <span style="flex:1"></span><button class="chip" data-k="mode" aria-pressed="false" title="Color pins by new vs earlier">Color: type</button></div>
      <div class="fm-legend" data-k="legend"></div></div>`;
    const stage = `<div class="fm-stage" style="${full ? '' : 'height:' + o.height + 'px'}"><div class="fm-map" data-k="map"></div>
      <div class="fm-nokey" data-k="nokey"><div class="card" style="max-width:440px">The live map needs the Google Maps key. The property list still works.</div></div></div>`;
    const card = `<div class="fm-card" data-k="card"></div>`;
    root.innerHTML = full
      ? `<div class="fm-side">${panel}<div class="fm-list" data-k="list"></div></div>${stage}${card}`
      : `${panel}${stage}${card}<div class="fm-strip"><div class="t" data-k="stripTitle"></div><div class="row" data-k="strip"></div></div>`;
    if (!full) root.querySelector('.fm-card').style.bottom = '124px';
    const $ = k => root.querySelector(`[data-k="${k}"]`);

    let map, clusterer, markers = {}, sv;
    const visible = () => rows.filter(r => (S.type === 'all' || r.type === S.type) && (!S.newOnly || isNew(r)) && (!S.dry || !r.sfha)
      && (!S.q || (r.addr + ' ' + r.city + ' ' + r.zip + ' ' + r.id).toLowerCase().includes(S.q)));
    const ordered = v => v.slice().sort((a, b) => (isNew(b) - isNew(a)) || a.zip.localeCompare(b.zip) || a.addr.localeCompare(b.addr));

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
      sv.getPanorama({ location: target, radius: 80, source: google.maps.StreetViewSource.OUTDOOR }, (res, status) => {
        if (status !== 'OK') { window.open(links(r).street, '_blank', 'noopener'); return; }
        const p = map.getStreetView();
        p.setPano(res.location.pano);
        p.setPov({ heading: google.maps.geometry.spherical.computeHeading(res.location.latLng, target), pitch: 4 });
        p.setZoom(1); p.setVisible(true);
      });
    }
    function renderCard() {
      const el = $('card'); const r = rows.find(x => x.id === S.sel);
      if (!r) { el.style.display = 'none'; return; }
      const L = links(r), v = ordered(visible()), pos = v.findIndex(x => x.id === r.id);
      el.innerHTML = `<div class="ph">${r.photo ? `<img src="${esc(r.photo)}" alt="Aerial photo of ${esc(r.addr)}">` : ''}<span class="lbl">Aerial · HCAD 2026 · lot outlined</span>
        <button class="x" aria-label="Close">×</button></div>
        <div class="fm-body">
        <div><div style="font-weight:800;font-size:17px">${esc(r.addr)}</div><div style="font-size:12px;color:var(--muted)">${esc(r.city)}, TX ${esc(r.zip)} · ${typeInfo(r.type)[0]} · ${esc(r.id)}</div></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${isNew(r) ? '<span class="tag tag-new">New this week</span>' : ''}<span class="tag ${r.sfha ? 'tag-flood' : 'tag-plain'}">Flood zone ${esc(r.zone || '—')}${r.sfha ? ' (SFHA)' : ''}</span><span class="tag tag-plain">${r.notice === 'hoa' ? 'HOA lien' : 'Mortgage foreclosure'}</span></div>
        <div style="font-size:13px"><strong>Tue Nov 3 · ${esc(r.window || '')}</strong><br><span style="color:var(--muted)">${esc((r.location || '').split(',').slice(0, 2).join(','))}</span></div>
        <div class="lock">Value, estimated equity, loan, beds and sq ft come with membership. <a href="/pricing" style="font-weight:700">Join the waitlist</a></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="btn btn-navy" data-a="sv" style="min-height:36px;font-size:13px">Street View here</button>
        ${r.notice_url ? `<a class="btn btn-ghost" style="min-height:36px;font-size:13px" href="${esc(r.notice_url)}" target="_blank" rel="noopener">Notice PDF</a>` : ''}
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
    }
    function render() {
      const v = visible(), ov = ordered(v);
      $('count').textContent = v.length;
      $('new').setAttribute('aria-pressed', S.newOnly); $('dry').setAttribute('aria-pressed', S.dry);
      $('mode').textContent = S.mode === 'new' ? 'Color: new' : 'Color: type';
      const opts = [['all', 'All', '#0E1A2B'], ...Object.entries(TYPE).map(([k, t]) => [k, t[0].replace(' / townhome', ''), t[1]])];
      $('types').innerHTML = opts.map(([k, l, c]) => `<button class="chip" data-t="${k}" aria-pressed="${S.type === k}"><span class="dot" style="background:${c}"></span>${l}</button>`).join('');
      $('types').querySelectorAll('button').forEach(b => b.onclick = () => { S.type = b.dataset.t; render(); });
      const L = S.mode === 'new' ? [['New this week', '#D2141C'], ['Earlier notice', '#7C8797']] : Object.values(TYPE);
      $('legend').innerHTML = L.map(([l, c]) => `<span><span class="dot" style="background:${c}"></span>${l}</span>`).join('');
      if (full) {
        $('list').innerHTML = ov.slice(0, 250).map(r => `<button class="fm-item ${S.sel === r.id ? 'sel' : ''}" data-id="${r.id}">
          <img loading="lazy" src="${esc(r.photo)}" alt=""><span style="min-width:0;display:flex;flex-direction:column;gap:3px"><strong style="font-size:14px">${esc(r.addr)}</strong>
          <span style="font-size:12px;color:var(--muted)">${esc(r.city)} ${esc(r.zip)} · ${typeInfo(r.type)[0]}</span>
          <span>${isNew(r) ? '<span class="tag tag-new">New</span> ' : ''}${r.sfha ? '<span class="tag tag-flood">Flood ' + esc(r.zone) + '</span>' : ''}</span></span></button>`).join('')
          + (ov.length > 250 ? `<div style="padding:10px 14px;font-size:12px;color:var(--muted)">Showing 250 of ${ov.length}. Search or filter to narrow.</div>` : '');
        $('list').querySelectorAll('.fm-item').forEach(b => b.onclick = () => select(b.dataset.id, true));
      } else {
        const i = Math.max(0, ov.findIndex(r => r.id === S.sel));
        const start = Math.max(0, i - 2);
        $('stripTitle').textContent = S.newOnly ? 'New this week' : `Browse ${v.length} properties`;
        $('strip').innerHTML = ov.slice(start, start + 14).map(r => `<button class="fm-th ${S.sel === r.id ? 'sel' : ''}" data-id="${r.id}"><img loading="lazy" src="${esc(r.photo)}" alt=""><span>${esc(r.addr)}</span><small>${esc(r.city)} · ${isNew(r) ? 'New' : typeInfo(r.type)[0]}</small></button>`).join('');
        $('strip').querySelectorAll('.fm-th').forEach(b => b.onclick = () => select(b.dataset.id, true));
      }
      renderCard();
      if (map) {
        const ms = v.map(r => { const m = markers[r.id]; m.content.style.background = colorOf(r); m.content.classList.toggle('sel', r.id === S.sel); m.zIndex = r.id === S.sel ? 999 : null; return m; });
        clusterer.clearMarkers(); clusterer.addMarkers(ms);
      }
    }
    $('q').addEventListener('input', e => { S.q = e.target.value.trim().toLowerCase(); render(); });
    $('new').onclick = () => { S.newOnly = !S.newOnly; render(); };
    $('dry').onclick = () => { S.dry = !S.dry; render(); };
    $('mode').onclick = () => { S.mode = S.mode === 'new' ? 'type' : 'new'; render(); };
    render();

    try {
      await Promise.all([loadMaps(), loadClusterer()]);
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      await google.maps.importLibrary('geometry'); await google.maps.importLibrary('streetView');
      map = new Map($('map'), { center: { lat: 29.83, lng: -95.4 }, zoom: full ? 10 : 9.6, mapId: (window.FTL_CONFIG || {}).mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'], position: google.maps.ControlPosition.TOP_RIGHT },
        streetViewControl: true, fullscreenControl: true, clickableIcons: false, gestureHandling: full ? 'greedy' : 'cooperative' });
      sv = new google.maps.StreetViewService();
      rows.forEach(r => {
        const el = document.createElement('div'); el.className = 'fm-pin';
        const m = new AdvancedMarkerElement({ position: { lat: r.lat, lng: r.lon }, content: el, title: r.addr + ', ' + r.city, gmpClickable: true });
        m.addEventListener('gmp-click', () => select(r.id, false));
        markers[r.id] = m;
      });
      clusterer = new markerClusterer.MarkerClusterer({ map, markers: [], algorithmOptions: { maxZoom: 13 } });
      render();
    } catch (e) {
      $('nokey').style.display = 'flex';
    }
    return { stats };
  }
  return { mount };
})();
