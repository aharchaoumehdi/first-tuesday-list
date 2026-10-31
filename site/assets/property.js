// Property page: photo / Street View / map tabs and the days-to-sale chip.
(function () {
  const root = document.getElementById('prop');
  if (!root) return;
  const lat = parseFloat(root.dataset.lat), lon = parseFloat(root.dataset.lon);
  const $ = k => root.querySelector(`[data-k="${k}"]`);

  // "Get alerts for 77084": the free sign-up is a ZIP alert for this property's ZIP, in the card under the photo
  // (tools/property_pages.py writes the card and loads assets/zipalerts.js)
  (function zipAlerts() {
    const slot = root.querySelector('[data-zip-alerts]'), zip = slot && slot.dataset.zip;
    if (!slot || !zip || !window.FTLAlerts) return;
    FTLAlerts.mount(slot, { variant: 'prop', areas: [zip], picksLabel: 'Nearby ZIPs',
      around: { lat: parseFloat(root.dataset.lat), lon: parseFloat(root.dataset.lon) },
      lead: ix => `Buying around here? We'll email you the day a new foreclosure is filed in ${ix.byZip[zip] ? ix.byZip[zip].c + ' ' : ''}${zip}.`,
      title: a => a.length ? `Get alerts for ${a.length <= 2 ? a.join(', ') : a.slice(0, 2).join(', ') + ' + ' + (a.length - 2)}` : 'Get ZIP alerts' });
  })();

  // Back to the map: return to the exact map view (zoom, filters) when we came from it,
  // otherwise open the map on this property. Esc does the same.
  const fromMap = (() => { try { const u = new URL(document.referrer); return u.origin === location.origin && (u.pathname === '/map' || u.pathname === '/'); } catch (e) { return false; } })();
  const goBack = ev => { if (fromMap && history.length > 1) { if (ev) ev.preventDefault(); history.back(); } };
  document.querySelectorAll('[data-back]').forEach(a => a.addEventListener('click', goBack));
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || document.body.classList.contains('sl-open') || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
    if (fromMap && history.length > 1) history.back(); else location.href = '/map#' + encodeURIComponent(root.dataset.id);
  });

  // Shortlist (site.js): a save button first in the actions, with this page's public facts as the saved copy.
  const SL = window.FTL && FTL.shortlist;
  if (SL) {
    const id = root.dataset.id, parts = (root.dataset.addr || '').split(', ');
    const text = sel => ((root.querySelector(sel) || {}).textContent || '').trim();
    const TYPES = { 'Single family': 'single_family', 'Condo / townhome': 'condo_townhome', Multifamily: 'multifamily', Commercial: 'commercial', 'Vacant land': 'vacant_land' };
    const flood = [...root.querySelectorAll('.p-title .chips .tag')].find(t => /^Flood zone /.test(t.textContent));
    const kv = k => { const el = [...root.querySelectorAll('.kv .k')].find(x => x.textContent.trim() === k); return el ? el.nextElementSibling.textContent.trim() : ''; };
    const typeLabel = (text('.p-title .sub').split('·')[1] || '').trim();
    const photo = root.querySelector('.g-photo');
    SL.know([{ id, addr: text('.p-title h1') || parts[0], city: parts[1] || '', zip: ((parts[2] || '').match(/\d{5}/) || [''])[0],
      type: TYPES[typeLabel] || 'other', zone: flood ? flood.textContent.replace('Flood zone ', '').split(' ')[0] : '', sfha: flood ? flood.classList.contains('tag-flood') : null,
      photo: photo ? photo.getAttribute('src') : '', window: kv('Sale window'), location: text('.auction .where'), notice: /HOA/.test(kv('Notice type')) ? 'hoa' : 'mortgage' }], root.dataset.sale);
    const acts = root.querySelector('.acts');
    if (acts) {
      const on = SL.has(id), b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-navy sl-save'; b.dataset.sl = id; b.dataset.slAddr = parts[0] || '';
      b.dataset.on = 'On my shortlist'; b.dataset.off = 'Save to my shortlist'; b.setAttribute('aria-pressed', on);
      b.innerHTML = '<svg class="sl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.9l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/></svg><span class="sl-t">' + (on ? b.dataset.on : b.dataset.off) + '</span>';
      acts.prepend(b);
    }
    // the free shortlist now does the postponed / cancelled emails, so the member list names what members add to it
    root.querySelectorAll('.tools li').forEach(li => { if (/^Watchlist/.test(li.textContent)) li.textContent = 'Value and equity for every home on your shortlist'; });
  }

  // stagger the sheen on the locked bars so it travels down each card, top to bottom
  root.querySelectorAll('.card').forEach(card => card.querySelectorAll('.redact i').forEach((bar, i) => bar.style.setProperty('--d', (i * 0.22).toFixed(2) + 's')));

  const sale = new Date(root.dataset.starts || root.dataset.sale + 'T10:00:00-06:00');
  const days = Math.ceil((sale - new Date()) / 864e5);
  $('days').textContent = days > 1 ? `${days} days away` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'Sale date passed';

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

  const CAP = {
    photo: '<strong>Aerial photo · this lot</strong><br>Harris County Appraisal District imagery, 2026 · lot outlined in red',
    pano: '<strong>Street View</strong><br>Google · drag to look around · the photo date shows in the corner',
    gmap: '<strong>Map</strong><br>Google Maps · switch to Satellite for a wider aerial view'
  };
  const fallback = (el, msg) => {
    el.innerHTML = `<div class="g-msg">${msg} <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" rel="noopener">Open in Google Maps</a></div>`;
  };
  let panoReady = false, mapReady = false;

  async function showPano() {
    if (panoReady) return; panoReady = true;
    const el = $('pano');
    try {
      await loadMaps();
      const { StreetViewPanorama, StreetViewService, StreetViewSource, StreetViewPreference } = await google.maps.importLibrary('streetView');
      const { spherical } = await google.maps.importLibrary('geometry');
      const target = new google.maps.LatLng(lat, lon), svs = new StreetViewService();
      // the nearest image is usually the street in front; Google's "best" one can be a freeway nearby
      const find = (radius, preference) => new Promise(ok => svs.getPanorama({ location: target, radius, preference, source: StreetViewSource.OUTDOOR }, (res, status) => ok(status === 'OK' ? res : null)));
      Promise.resolve(find(60, StreetViewPreference.NEAREST)).then(res => res || find(120, StreetViewPreference.BEST)).then(res => {
        if (!res) { fallback(el, 'Google has no Street View image near this lot.'); return; }
        new StreetViewPanorama(el, {
          pano: res.location.pano, pov: { heading: spherical.computeHeading(res.location.latLng, target), pitch: 4 }, zoom: 1,
          addressControl: false, fullscreenControl: true, motionTracking: false
        });
      });
    } catch (e) { fallback(el, 'Street View could not load here.'); }
  }

  async function showMap() {
    if (mapReady) return; mapReady = true;
    const el = $('gmap');
    try {
      await loadMaps();
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      const map = new Map(el, {
        center: { lat, lng: lon }, zoom: 17, mapId: (window.FTL_CONFIG || {}).mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] }, mapTypeId: 'roadmap',
        zoomControl: true, cameraControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false
      });
      const pin = document.createElement('div'); pin.className = 'g-pin';
      new AdvancedMarkerElement({ map, position: { lat, lng: lon }, content: pin, title: root.dataset.addr });
    } catch (e) { fallback(el, 'The map could not load here.'); }
  }

  // Members: the locked rows get their values (from /api/member/property/<id>, never from the static page).
  const usd = v => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const longDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  function fill(m) {
    const show = {
      value: usd(m.value), balance: usd(m.balance), vtl: m.vtl == null ? '—' : m.vtl.toFixed(2) + '×',
      equity: m.equity == null ? '—' : `<span class="eq">${usd(m.equity)}</span>${m.share != null ? ` <span class="tag tag-plain">${Math.round(m.share * 100)}%</span>` : ''}`,
      beds: m.beds == null ? '—' : `${m.beds} bd · ${m.baths ?? '—'} ba${m.half ? ' · ' + m.half + ' half' : ''}`,
      sqft: m.sqft == null ? '—' : m.sqft.toLocaleString('en-US') + ' sq ft', year: m.year ?? '—',
      lot: m.lot == null ? '—' : m.lot.toLocaleString('en-US') + ' sq ft', appraised: usd(m.appraised), school: esc(m.school || '—'),
      occ: m.occ == null ? 'Unknown' : m.occ ? 'Likely' : 'Likely not', lender: esc(m.lender || '—'),
      servicer: esc(m.servicer || '—'), trustee: esc(m.trustee || '—'),
      rent: m.rent == null ? '—' : `${usd(m.rent)}/mo <span class="tag tag-plain">HUD · ${m.rent_beds} bd</span>`,
      rent_yield: m.rent_yield == null ? '—' : (m.rent_yield * 100).toFixed(1) + '%',
      loan: m.loan == null ? (m.loan_status === 'not_stated' ? 'Not stated on the notice' : '—') : usd(m.loan), dot: longDate(m.dot)
    };
    root.querySelectorAll('[data-m]').forEach(el => { el.innerHTML = show[el.dataset.m] ?? '—'; });
    const card = root.querySelector('.card.members');
    card.classList.add('unlocked');
    card.querySelector('.h3').innerHTML = 'The numbers <span class="tag tag-member">Member</span>';
    card.querySelector('.cta').innerHTML = '<span>Estimates from public records, not a lender payoff. The opening bid can be close to the full debt: call the trustee. <a href="/members#method">How we estimate</a></span>';
    const links = root.querySelector('[data-k="rlinks"]');
    if (m.hcad_url) links.insertAdjacentHTML('afterbegin', `<a href="${esc(m.hcad_url)}" target="_blank" rel="noopener"><span>Appraisal record</span><small>HCAD${m.hcad ? ' · ' + esc(m.hcad) : ''}</small></a>`);
    if (m.tax_url) links.insertAdjacentHTML('afterbegin', `<a href="${esc(m.tax_url)}" target="_blank" rel="noopener"><span>Tax statement</span><small>Harris County Tax Office</small></a>`);
    const tools = root.querySelector('[data-k="tools"]');
    tools.innerHTML = `<div class="h3">Member downloads</div><div class="rlinks">
      <a href="/api/member/file/latest-xlsx"><span>Member spreadsheet</span><small>Excel · every property</small></a>
      <a href="/api/member/file/latest-brief"><span>Top 10 Research Brief</span><small>PDF · this sale</small></a>
      <a href="/members"><span>Member home</span><small>Account and billing</small></a></div>
      <p class="note" style="margin:10px 0 0">Coming next: watchlist and alerts, max-bid calculator, sale-day mode.</p>`;
  }
  if (window.FTL && FTL.status) FTL.status.then(s => {
    if (!s.member) return;
    fetch('/api/member/property/' + encodeURIComponent(root.dataset.id), { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).then(d => { if (d && d.row) fill(d.row); }).catch(() => {});
  });

  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
    root.querySelector('.g-photo').hidden = t !== 'photo';
    $('pano').hidden = t !== 'pano';
    $('gmap').hidden = t !== 'gmap';
    $('cap').innerHTML = CAP[t];
    $('cap').hidden = t !== 'photo';
    if (isNaN(lat)) { if (t !== 'photo') fallback($(t), 'We could not place this property on the map.'); return; }
    if (t === 'pano') showPano();
    if (t === 'gmap') showMap();
  }));
})();

// Compare: a "Compare" box beside "Save notice PDF" and the floating compare tray (assets/compare.js).
// Loaded from here so the 795 generated pages need no change.
(function () {
  if (!document.getElementById('prop') || window.FTLCompare) return;
  const s = document.createElement('script'); s.src = '/assets/compare.js'; s.async = true; document.head.appendChild(s);
})();
