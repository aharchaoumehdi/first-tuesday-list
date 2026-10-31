// /compare?ids=A,B,C : up to 4 properties of the current sale side by side, the public fields only.
// Member fields show as locked bars; signed-in members get them from /api/member/property/<id>, never from the page.
(function () {
  const root = document.getElementById('cmp'), out = root.querySelector('[data-k="out"]');
  const C = window.FTLCompare;
  const TYPE = { single_family: ['Single family', '#1E5BD8'], condo_townhome: ['Condo / townhome', '#8A4FD1'], multifamily: ['Multifamily', '#F28C1B'], commercial: ['Commercial', '#D2141C'], vacant_land: ['Vacant land', '#3E9B47'] };
  const typeInfo = t => TYPE[t] || ['Other', '#8A97AA'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = v => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');
  const nice = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const LET = 'ABCD', MAX = 4;
  const okId = id => C ? C.okId(id) : /^[A-Z]{2,6}-\d{4}-\d{1,7}$/.test(id);
  const miles = (a, b) => {
    const R = 3958.8, rad = x => x * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const mi = d => d < 0.1 ? 'under 0.1 mi' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' mi';
  const fullAddr = r => `${r.addr}, ${r.city}, TX ${r.zip}`;

  let ids = [...new Set((new URLSearchParams(location.search).get('ids') || '').split(',').map(s => s.trim().toUpperCase()).filter(okId))].slice(0, MAX);
  // /compare with no ids opens what this visitor ticked, and puts it in the address bar so it can be shared
  if (!ids.length && C) ids = C.list().map(x => x.id);

  let cur, byId, stats, ST, map = null;
  const sale = fetch('/data/current.json').then(r => r.json()).then(c => { cur = c;
    return Promise.all([fetch('/data/sale-' + c.current_sale + '.json').then(r => r.json()), fetch('/data/stats-' + c.current_sale + '.json').then(r => r.json()).catch(() => ({}))]); });
  Promise.all([sale, (window.FTL && FTL.status) || Promise.resolve({ open: false, member: null })]).then(([[data, st], status]) => {
    byId = Object.fromEntries(data.rows.map(r => [r.id, r])); stats = st || {}; ST = status || {};
    root.querySelector('[data-sale-link]').textContent = cur.label_year + ' sale';
    render(true);
  }).catch(() => { out.innerHTML = '<p class="cmp-alert">The sale list could not load. Refresh the page, or open the <a href="/map">map</a>.</p>'; });

  function setUrl(list) {
    const u = list.length ? '/compare?ids=' + list.join(',') : '/compare';
    if (location.pathname + location.search !== u) history.replaceState(null, '', u);
  }
  const shareUrl = list => location.origin + '/compare?ids=' + list.join(',');
  const isNew = r => stats.new_since && r.first >= stats.new_since;
  const describe = rows => `${rows.length} Harris County ${rows.length === 1 ? 'property' : 'properties'} going to foreclosure auction ${cur.label_day}: `
    + rows.map(r => `${r.addr}, ${r.city} (${typeInfo(r.type)[0].toLowerCase()})`).join('; ') + '. Side by side: type, flood zone, notice, sale window and the county notices.';
  function setMeta(rows) {
    document.title = rows.length ? `Compare ${rows.map(r => r.addr).join(' · ')} · First Tuesday List` : 'Compare foreclosure auction properties side by side · First Tuesday List';
    if (!rows.length) return;
    const d = describe(rows);
    document.querySelectorAll('meta[name="description"],meta[property="og:description"]').forEach(m => m.setAttribute('content', d));
    const t = document.querySelector('meta[property="og:title"]'); if (t) t.setAttribute('content', document.title);
  }

  function render(first) {
    const rows = ids.map(id => byId[id]).filter(Boolean);
    const missing = ids.filter(id => !byId[id]);
    if (first && missing.length) ids = rows.map(r => r.id);
    setUrl(ids); setMeta(rows);
    if (!rows.length) return renderEmpty(missing);
    renderTable(rows, first ? missing : []);
    renderMap(rows);
    if (ST.member) unlock(rows);
  }

  function renderEmpty(missing) {
    // an example that always exists: the busiest ZIP's first single-family home and its 2 nearest neighbours
    const zip = (stats.zips && stats.zips[0] && stats.zips[0][0]) || '';
    const pool = Object.values(byId).filter(r => r.zip === zip && r.type === 'single_family' && r.lat != null);
    let ex = [];
    if (pool.length >= 3) { const a = pool[0]; ex = [a, ...pool.slice(1).sort((x, y) => miles(a, x) - miles(a, y)).slice(0, 2)]; }
    out.innerHTML = `${missing.length ? `<p class="cmp-alert">${missing.length === 1 ? 'The property in this link is' : 'The properties in this link are'} no longer on the ${esc(cur.label)} list (postponed, cancelled or from an earlier sale): ${missing.map(esc).join(', ')}.</p>` : ''}
      <div class="cmp-head cmp-empty"><div><div class="eyebrow">Side by side</div><h1 class="disp">Compare properties side by side</h1>
      <p class="sub">Pick up to ${MAX} of the ${cur.total || ''} properties in the ${esc(cur.label_year)} sale and see them in columns: aerial photo, type, flood zone, notice, sale window and how far apart they are.</p></div></div>
      <div class="cmp-steps">
        <div class="card"><span class="n">1</span><strong>Tick “Compare”</strong><span>On the map list, on a pin's card or on any property page.</span></div>
        <div class="card"><span class="n">2</span><strong>Press Compare</strong><span>The tray at the bottom of the screen counts what you picked, up to ${MAX}.</span></div>
        <div class="card"><span class="n">3</span><strong>Send it to a partner</strong><span>The link carries the properties: anyone you send it to sees the same columns.</span></div>
      </div>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-red" href="/map">Open the map</a>${ex.length ? `<a class="btn btn-ghost" href="/compare?ids=${ex.map(r => r.id).join(',')}">See an example: 3 homes in ${esc(ex[0].city)} ${esc(zip)}</a>` : ''}</p>`;
  }

  function renderTable(rows, missing) {
    const n = rows.length;
    const same = f => n > 1 && rows.every(r => f(r) === f(rows[0]));
    const tr = (label, cell, o = {}) => `<tr class="${o.cls || ''}"><th class="l" scope="row">${label}${o.same ? '<small>Same for all</small>' : ''}</th>${rows.map((r, i) => `<td class="p">${cell(r, i)}</td>`).join('')}</tr>`;
    const lock = (label, key, k, cls) => tr(`<span class="ico-lock" style="vertical-align:-2px;margin-right:5px"></span>${label}`,
      (r, i) => `<span data-m="${key}" data-id="${esc(r.id)}"><span class="redact"><span class="ico-lock"></span><i style="--d:${(k * 0.22 + i * 0.1).toFixed(2)}s"></i></span></span>`, { cls: 'lockrow ' + (cls || '') });
    const where = r => (r.location || '').split(',').slice(0, 2).join(',');
    const P = (ST.prices || {}), founding = ST.founding && P.founding_monthly;
    const body = [
      tr('<span class="sr">Aerial photo</span>', r => `<a class="cmp-ph" href="/property/${esc(r.id)}"><img src="${esc(r.photo)}" alt="Aerial photo of ${esc(r.addr)}, lot outlined"><span class="lbl">Aerial · HCAD 2026</span></a>`, { cls: 'ph' }),
      tr('Property type', r => `<span class="typ"><span class="dot" style="background:${typeInfo(r.type)[1]}"></span>${typeInfo(r.type)[0]}</span>`, { same: same(r => r.type) }),
      tr('ZIP', r => `<a href="/map?q=${esc(r.zip)}">${esc(r.zip)}</a><span class="muted">${esc(r.city)}</span>`, { same: same(r => r.zip) }),
      tr('Flood zone', r => `<span class="tag ${r.sfha ? 'tag-flood' : 'tag-plain'}">Zone ${esc(r.zone || '—')}${r.sfha ? ' · SFHA' : ''}</span><span class="muted">${r.sfha ? 'In FEMA\'s high-risk area' : r.zone ? 'Outside the high-risk area' : 'Not mapped'}</span>`, { same: same(r => r.zone + r.sfha) }),
      tr('Notice type', r => `${r.notice === 'hoa' ? 'HOA lien (assessment)' : 'Mortgage (deed of trust)'}<span class="muted">${r.notice === 'hoa' ? 'HOA lien sale' : 'Trustee sale'} · cash</span>`, { same: same(r => r.notice) }),
      tr('Sale window', r => `${esc(cur.label_day)} · ${esc(r.window || 'time not stated')}<span class="muted">${esc(where(r))}</span>`, { same: same(r => r.window + where(r)) }),
      tr('First seen', r => `${nice(r.first)}${isNew(r) ? ' <span class="tag tag-new">New this week</span>' : ''}`, { same: same(r => r.first) }),
      tr('Posted more than once', r => r.repeat ? 'Yes<span class="muted">Posted again for this sale</span>' : 'No', { same: same(r => Boolean(r.repeat)) }),
      ...(n > 1 ? [tr('Distance to the others', (r, i) => `<span class="cmp-dist">${rows.map((o, j) => j === i ? '' : `<span><b>${LET[j]}</b>${mi(miles(r, o))}</span>`).join('')}</span>`)] : []),
      tr('Open', r => `<span class="cmp-links"><a class="btn btn-navy" href="/property/${esc(r.id)}">Property page</a>${r.notice_url
        ? `<a class="btn btn-ghost" href="/notice/${esc(r.id)}" download="${esc(`${r.addr}, ${r.city} TX ${r.zip} - ${r.notice === 'hoa' ? 'HOA lien' : 'foreclosure'} notice ${r.id}.pdf`)}">Notice PDF</a>` : ''}
        <a class="btn btn-ghost" href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;viewpoint=${r.lat},${r.lon}" target="_blank" rel="noopener">Street View</a></span>`, { cls: 'end' }),
      `<tr class="grp"><th colspan="${n + 1}" scope="rowgroup"><span class="cmp-grp"><span class="ico-lock"></span>The numbers <span class="tag tag-plain" data-k="grptag">Members</span></span></th></tr>`,
      lock('HCAD market value', 'value', 0, 'first'),
      lock('Estimated equity', 'equity', 1, 'tot'),
      lock('Estimated monthly rent', 'rent', 2),
      lock('Current lender', 'lender', 3, 'end'),
      `<tr class="ctarow"><th class="l"><span class="sr">Membership</span></th><td class="ctaw" colspan="${n}"><div class="cmp-cta">
        <p>Members see the value, estimated equity, estimated monthly rent and lender for ${n === 1 ? 'this property' : `all ${n} properties`}, side by side, with the method behind every number.${founding ? ` Founding price $${P.founding_monthly}/month for the first 100 members.` : ''}</p>
        <a class="btn btn-red" href="/pricing">Members compare the numbers</a></div></td></tr>`
    ];
    const subj = `Foreclosure auction ${cur.label}: ${n} properties to compare`;
    const mail = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(rows.map((r, i) => `${LET[i]}. ${fullAddr(r)}`).join('\n') + '\n\nSide by side: ' + shareUrl(ids) + '\n')}`;
    const cities = [...new Set(rows.map(r => r.city))];
    out.innerHTML = `${missing.length ? `<p class="cmp-alert">${missing.length} ${missing.length === 1 ? 'property' : 'properties'} in this link ${missing.length === 1 ? 'is' : 'are'} no longer on the ${esc(cur.label)} list (postponed, cancelled or from an earlier sale): ${missing.map(esc).join(', ')}.</p>` : ''}
      <div class="cmp-head"><div style="min-width:0"><div class="eyebrow">Side by side · ${esc(cur.label_year)} auction</div>
        <h1 class="disp">Compare ${n === 1 ? '1 property' : n + ' properties'}</h1>
        <p class="sub">${esc(cities.slice(0, 3).join(', '))}${cities.length > 3 ? ' and more' : ''} · Harris County foreclosure auction, ${esc(cur.label_day)}</p></div>
        <div class="cmp-share">
          <button type="button" class="btn btn-navy" data-a="share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>Copy link to share</button>
          <a class="btn btn-ghost" href="${mail}">Email it to a partner</a>
          ${n < MAX ? `<a class="btn btn-ghost" href="/map" data-a="add">+ Add a property</a>` : ''}
          <div class="done" role="status" data-k="done"></div>
        </div></div>
      ${n === 1 ? `<p class="cmp-alert">Add at least one more property to compare: tick <strong>Compare</strong> on the map or on a property page.</p>` : ''}
      ${n > 1 ? `<div class="cmp-pager" data-k="pager"><span>Swipe or pick</span>${rows.map((r, i) => `<button type="button" data-go="${i}" aria-label="Show ${LET[i]}: ${esc(r.addr)}"${i === 0 ? ' aria-current="true"' : ''}>${LET[i]}</button>`).join('')}</div>` : ''}
      <div class="cmp-scroll" data-k="scroll"><table class="cmp-table">
        <caption class="sr">${n} properties compared side by side</caption>
        <thead><tr><th class="l" scope="col"><span class="sr">Property</span></th>${rows.map((r, i) => `<th class="p" scope="col" data-col="${i}"><div class="cmp-colh"><span class="cmp-letter" aria-hidden="true">${LET[i]}</span>
          <span style="min-width:0"><a href="/property/${esc(r.id)}">${esc(r.addr)}</a><small>${esc(r.city)}, TX ${esc(r.zip)} · <span class="mono">${esc(r.id)}</span></small></span></div>
          <button type="button" class="cmp-x" data-rm="${esc(r.id)}" aria-label="Remove ${esc(r.addr)} from this comparison" title="Remove from this comparison">×</button></th>`).join('')}</tr></thead>
        <tbody>${body.join('')}</tbody></table></div>
      <div class="cmp-lower">
        <div class="card cmp-mapcard"><div class="hd"><div class="h3">Where they are</div></div>
          <div class="cmp-mapwrap"><div class="cmp-map" data-k="map"></div></div>
          ${n > 1 ? `<div class="cmp-pairs">${rows.flatMap((a, i) => rows.slice(i + 1).map((b, k) => `<span>${LET[i]} ↔ ${LET[i + k + 1]} · ${mi(miles(a, b))}</span>`)).join('')}</div>` : ''}
          <div class="ft"><p class="note">Straight-line distances between the lots.</p>${n > 1 ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${route(rows)}">Drive ${rows.map((r, i) => LET[i]).join(' → ')} in Google Maps</a>` : ''}</div>
        </div>
        <div class="card cmp-inbox" id="inbox">
          <h2 class="disp">Send this comparison to my inbox</h2>
          <p>We email you this side-by-side link, so it's one tap away on sale day. You also get the free First Tuesday Brief every Wednesday: what's new, postponed and cancelled. Unsubscribe anytime.</p>
          <form class="signup" data-k="form"><label class="sr" for="cmp-email">Email address</label><input id="cmp-email" type="email" required placeholder="you@company.com" autocomplete="email">
            <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
            <button class="btn btn-red" type="submit">Send it to me</button></form>
          <div class="signup-done" role="status" data-k="sent"></div>
        </div>
      </div>`;
    wire(rows);
  }

  function route(rows) {
    const a = rows.map(r => encodeURIComponent(fullAddr(r)));
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + a[0] + '&destination=' + a[a.length - 1] + (a.length > 2 ? '&waypoints=' + a.slice(1, -1).join('%7C') : '');
  }

  function wire(rows) {
    const $ = k => out.querySelector(`[data-k="${k}"]`);
    out.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      ids = ids.filter(id => id !== b.dataset.rm);
      if (C) C.setAll(ids.map(id => byId[id]).filter(Boolean));
      render(false);
      const next = out.querySelector('[data-rm]') || out.querySelector('h1'); if (next) next.focus();
    }));
    const add = out.querySelector('[data-a="add"]');
    // carry these properties into the tray, so ticking one more on the map adds to this comparison
    if (add && C) add.addEventListener('click', () => C.setAll(rows));
    out.querySelector('[data-a="share"]').addEventListener('click', async () => {
      const u = shareUrl(ids), done = $('done');
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        try { await navigator.share({ title: document.title, text: `${rows.length} properties at the ${cur.label} foreclosure auction, side by side`, url: u }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(u); done.textContent = 'Link copied. Anyone you send it to sees these same columns.'; }
      catch (e) { done.textContent = 'Copy this link: ' + u; }
    });
    // mobile: the A B C buttons scroll to a card and follow the swipe
    const sc = $('scroll'), pager = $('pager');
    const cols = () => [...out.querySelectorAll('thead th.p')];
    const lw = () => out.querySelector('thead th.l').offsetWidth;
    if (pager) {
      pager.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goCol(+b.dataset.go)));
      let t; sc.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => {
        const c = cols(), x = sc.scrollLeft + lw() + 12;
        let i = c.findIndex(th => th.offsetLeft + th.offsetWidth / 2 > x); if (i < 0) i = c.length - 1;
        pager.querySelectorAll('[data-go]').forEach(b => b.setAttribute('aria-current', String(+b.dataset.go === i)));
      }, 60); }, { passive: true });
    }
    goCol = i => {
      const th = cols()[i]; if (!th) return;
      if (sc.scrollWidth > sc.clientWidth + 2) sc.scrollTo({ left: th.offsetLeft - lw() - 10 });
      const top = sc.getBoundingClientRect().top + scrollY - 140;
      if (Math.abs(scrollY - top) > 300 && i >= 0) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const f = $('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = f.querySelector('input[type=email]').value.trim(), btn = f.querySelector('button'), sent = $('sent');
      if (!email) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      let msg = 'Something went wrong. Try again, or write to leads@firsttuesdaylist.com.';
      try {
        const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'compare:' + ids.join(','), compare: ids, website: f.querySelector('[name=website]').value }) });
        const d = await r.json().catch(() => ({}));
        msg = r.ok ? "You're in. This comparison is on its way to your inbox, and the free list comes every Wednesday." : (d.error || msg);
        if (r.ok) f.reset();
      } catch (err) { /* keep the default message */ }
      btn.disabled = false; btn.textContent = 'Send it to me';
      sent.style.display = 'block'; sent.textContent = msg;
    });
  }
  let goCol = () => {};

  // the mini map: one teardrop pin per column, in its type color, labelled A B C D
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
  async function renderMap(rows) {
    const el = out.querySelector('[data-k="map"]'), pts = rows.filter(r => r.lat != null);
    // laid over the map box (not replacing Google's nodes, which it may still be using)
    const noMap = () => { const m = out.querySelector('[data-k="map"]'); if (m && !m.parentNode.querySelector('.cmp-nomap')) m.insertAdjacentHTML('afterend', '<div class="g-msg cmp-nomap">The map could not load here. The distances below still work.</div>'); };
    // Google calls this when the key is refused for this address (its own error box would say "Oops")
    window.gm_authFailure = noMap;
    try {
      await loadMaps();
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      map = new Map(el, { center: { lat: 29.83, lng: -95.4 }, zoom: 10, mapId: (window.FTL_CONFIG || {}).mapId || 'DEMO_MAP_ID',
        mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] }, zoomControl: true, cameraControl: false,
        streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'cooperative' });
      const b = new google.maps.LatLngBounds();
      pts.forEach(r => {
        const i = rows.indexOf(r), pin = document.createElement('div');
        pin.className = 'fm-pin'; pin.style.setProperty('--c', typeInfo(r.type)[1]); pin.innerHTML = `<i></i><b>${LET[i]}</b>`;
        const m = new AdvancedMarkerElement({ map, position: { lat: r.lat, lng: r.lon }, content: pin, title: `${LET[i]}: ${r.addr}, ${r.city}`, gmpClickable: true });
        m.addEventListener('gmp-click', () => goCol(i));
        b.extend({ lat: r.lat, lng: r.lon });
      });
      if (pts.length > 1) map.fitBounds(b, 60); else if (pts.length) { map.setCenter({ lat: pts[0].lat, lng: pts[0].lon }); map.setZoom(15); }
    } catch (e) { noMap(); }
  }

  // members: the bars become numbers (one request per property, at most 4)
  function unlock(rows) {
    root.classList.add('unlocked');
    const tag = out.querySelector('[data-k="grptag"]'); if (tag) { tag.textContent = 'Member'; tag.className = 'tag tag-member'; }
    rows.forEach(r => fetch('/api/member/property/' + encodeURIComponent(r.id), { credentials: 'same-origin' })
      .then(x => x.ok ? x.json() : null).then(d => {
        const m = d && d.row; if (!m) return;
        const show = { value: usd(m.value), equity: m.equity == null ? '—' : `<span class="eq">${usd(m.equity)}</span>${m.share != null ? ` <span class="tag tag-plain">${Math.round(m.share * 100)}%</span>` : ''}`,
          rent: m.rent == null ? '—' : `${usd(m.rent)}/mo`, lender: esc(m.lender || '—') };
        out.querySelectorAll(`[data-id="${CSS.escape(r.id)}"][data-m]`).forEach(el => { el.innerHTML = show[el.dataset.m] ?? '—'; });
      }).catch(() => {}));
  }
})();
