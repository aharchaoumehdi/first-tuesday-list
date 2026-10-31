// Area pages (/zip/<zip>, /city/<slug>, /areas): the area map, the list filters and the "find your ZIP" box.
// The page is complete without this script: the list, links and a static map preview are in the HTML.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE = { single_family: ['Single family', '#1E5BD8'], condo_townhome: ['Condo / townhome', '#8A4FD1'], multifamily: ['Multifamily', '#F28C1B'], commercial: ['Commercial', '#D2141C'], vacant_land: ['Vacant land', '#3E9B47'] };
  const typeInfo = t => TYPE[t] || ['Other', '#8A97AA'];

  // ---- the sign-up: a free alert for this ZIP or city (assets/zipalerts.js) ----
  document.querySelectorAll('[data-zip-alerts]').forEach(el => {
    if (!window.FTLAlerts) return;
    const areas = (el.dataset.areas || '').split(',').filter(Boolean);
    FTLAlerts.mount(el, { variant: 'hero', areas, title: a => a.length ? `Get alerts for ${a.length <= 2 ? a.join(', ') : a.slice(0, 2).join(', ') + ' + ' + (a.length - 2)}` : 'Get area alerts' });
  });

  // ---- list filters: chips toggle cards by data attributes ----
  const list = document.getElementById('areaList');
  const filter = document.querySelector('[data-k="filter"]');
  const countEl = document.querySelector('[data-k="shown"]');
  if (list && filter) {
    const items = [...list.querySelectorAll('[data-type]')];
    const groups = [...list.querySelectorAll('[data-group]')];
    let f = 'all';
    const ok = el => f === 'all' || (f === 'new' ? el.dataset.new === '1' : f === 'dry' ? el.dataset.sfha === '0' : f === 'hoa' ? el.dataset.notice === 'hoa' : el.dataset.type === f);
    function apply() {
      let n = 0;
      items.forEach(el => { const s = ok(el); el.hidden = !s; if (s) n++; });
      groups.forEach(g => { g.hidden = !g.querySelector('[data-type]:not([hidden])'); });
      filter.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === f));
      if (countEl) countEl.textContent = f === 'all' ? '' : `Showing ${n} of ${items.length}`;
    }
    filter.addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; f = b.dataset.f; apply(); });
  }

  // ---- /areas: filter the city and ZIP tiles as you type ----
  const find = document.querySelector('[data-k="find"]');
  if (find) {
    const tiles = [...document.querySelectorAll('[data-find]')];
    const none = document.querySelector('[data-k="nomatch"]');
    find.addEventListener('input', () => {
      const q = find.value.trim().toLowerCase();
      let n = 0;
      tiles.forEach(t => { const s = !q || t.dataset.find.includes(q); t.hidden = !s; if (s) n++; });
      if (none) none.hidden = n > 0;
    });
  }

  // ---- the area map: Google Maps when the key is there, the static preview otherwise ----
  const box = document.getElementById('areaMap');
  const pinsEl = document.getElementById('areaPins');
  if (!box || !pinsEl) return;
  const PIN_FIELDS = ['id', 'addr', 'city', 'zip', 'lat', 'lon', 'type', 'photo', 'window', 'zone', 'sfha', 'new'];
  const pins = JSON.parse(pinsEl.textContent).map(a => Object.fromEntries(PIN_FIELDS.map((k, i) => [k, a[i]])));
  const saleDay = box.dataset.day || '';
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
  const card = box.querySelector('.fm-card');
  let markers = {}, selected = null;
  function show(p) {
    if (selected && markers[selected]) markers[selected].content.classList.remove('sel');
    selected = p ? p.id : null;
    if (!p) { card.style.display = 'none'; return; }
    if (markers[p.id]) markers[p.id].content.classList.add('sel');
    const page = '/property/' + encodeURIComponent(p.id);
    card.innerHTML = `<div class="ph">${p.photo ? `<img src="${esc(p.photo)}" alt="Aerial photo of ${esc(p.addr)}">` : ''}<span class="lbl">Aerial · HCAD 2026 · lot outlined</span>
      <button class="x" aria-label="Close">×</button></div>
      <div class="fm-body"><div><a href="${page}" style="font-weight:800;font-size:17px;color:var(--ink);text-decoration:none">${esc(p.addr)}</a>
      <div style="font-size:12px;color:var(--muted)">${esc(p.city)}, TX ${esc(p.zip)} · ${typeInfo(p.type)[0]}</div></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${p.new ? '<span class="tag tag-new">New this week</span>' : ''}<span class="tag ${p.sfha ? 'tag-flood' : 'tag-plain'}">Flood zone ${esc(p.zone || '—')}</span><span class="tag tag-plain">${esc(saleDay)} · ${esc(p.window || '')}</span></div>
      <div class="lock"><span>Value, estimated equity and loan come with membership</span></div>
      <a class="btn btn-red" href="${page}" style="min-height:38px;font-size:14px">Full details</a></div>`;
    card.style.display = 'block';
    card.querySelector('.x').onclick = () => show(null);
  }
  // a key that this site may not use (wrong referrer, billing off): Google calls this; keep the static preview
  const prevAuthFail = window.gm_authFailure;
  window.gm_authFailure = function () {
    box.classList.remove('live');
    box.querySelector('.fm-map').hidden = true;
    box.querySelector('.a-static').hidden = false;
    const hint = box.querySelector('.a-maphint'); if (hint) hint.hidden = false;
    if (typeof prevAuthFail === 'function') prevAuthFail();
  };
  async function mountMap() {
    try {
      const big = pins.length > 150;
      await Promise.all([loadMaps(), big ? loadClusterer() : null]);
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      const el = box.querySelector('.fm-map');
      const map = new Map(el, { center: { lat: pins[0].lat, lng: pins[0].lon }, zoom: 13, mapId: (window.FTL_CONFIG || {}).mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'], position: google.maps.ControlPosition.TOP_LEFT },
        zoomControl: true, cameraControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'cooperative' });
      const ms = pins.map(p => {
        const pin = document.createElement('div'); pin.className = 'fm-pin'; pin.style.setProperty('--c', typeInfo(p.type)[1]);
        const num = (p.addr.match(/^\d+[A-Z]?/) || [''])[0];
        pin.innerHTML = '<i></i>' + (num ? `<b>${esc(num)}</b>` : '');
        const m = new AdvancedMarkerElement({ map: big ? null : map, position: { lat: p.lat, lng: p.lon }, content: pin, title: p.addr + ', ' + p.city, gmpClickable: true });
        m.addEventListener('gmp-click', () => show(p));
        markers[p.id] = m; return m;
      });
      if (big) new markerClusterer.MarkerClusterer({ map, markers: ms, algorithmOptions: { maxZoom: 13 } });
      if (pins.length === 1) map.setZoom(15);
      else { const b = new google.maps.LatLngBounds(); pins.forEach(p => b.extend({ lat: p.lat, lng: p.lon })); map.fitBounds(b, 36); }
      map.addListener('idle', () => box.classList.toggle('fm-labels', map.getZoom() >= 15));
      map.addListener('click', () => show(null));
      box.classList.add('live');
      box.querySelector('.a-static').hidden = true;
      const hint = box.querySelector('.a-maphint'); if (hint) hint.hidden = true;
    } catch (e) { /* keep the static preview */ }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) show(null); });
  // load Google Maps only when the map is about to scroll into view
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); mountMap(); } }, { rootMargin: '300px' });
    io.observe(box);
  } else mountMap();
})();
