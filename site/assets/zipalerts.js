// "Watch my area": free email alerts for the ZIP codes and cities a visitor buys in.
// FTLAlerts.mount(el, {variant: 'hero' | 'prop' | 'dialog', areas: ['77084', 'Katy'], picks: [...], picksLabel, title})
// FTLAlerts.open({...})   the same widget in a dialog (the map's "Watch this area" button)
// Data: /data/zips-<sale>.json (small ZIP index: counts, centre, newest 3 per ZIP; free fields only).
// Sign-up: POST /api/subscribe {email, source: "zip-alerts:77084,77449", zips: [...], areas: [...]}.
window.FTLAlerts = (function () {
  const MAX = 8, KEY = 'ftl-zip-alerts';
  const TYPES = { single_family: 'Single family', condo_townhome: 'Condo / townhome', multifamily: 'Multifamily', commercial: 'Commercial', vacant_land: 'Vacant land' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = d => d ? +d.slice(5, 7) + '/' + +d.slice(8, 10) : '';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private window: fine */ } }
  };
  let uid = 0;

  // ZIP index, once per page. Falls back to building it from the full sale file if the index is missing.
  let dataP = null;
  function data() {
    if (dataP) return dataP;
    dataP = fetch('/data/current.json').then(r => r.json()).then(cur =>
      fetch('/data/zips-' + cur.current_sale + '.json').then(r => { if (!r.ok) throw new Error('no index'); return r.json(); })
        .catch(() => Promise.all([fetch('/data/sale-' + cur.current_sale + '.json').then(r => r.json()), fetch('/data/stats-' + cur.current_sale + '.json').then(r => r.json())])
          .then(([sale, st]) => buildIndex(cur, sale.rows, st.new_since)))
        .then(ix => prepare(ix, cur)));
    return dataP;
  }
  function buildIndex(cur, rows, since) {
    const by = {};
    rows.forEach(r => { (by[r.zip] = by[r.zip] || []).push(r); });
    const zips = Object.entries(by).map(([z, rs]) => {
      const geo = rs.filter(r => r.lat != null), cities = {};
      rs.forEach(r => { cities[r.city] = (cities[r.city] || 0) + 1; });
      return { z, c: Object.entries(cities).sort((a, b) => b[1] - a[1])[0][0], n: rs.length, nw: rs.filter(r => r.first >= since).length,
        lat: geo.length ? geo.reduce((s, r) => s + r.lat, 0) / geo.length : null, lon: geo.length ? geo.reduce((s, r) => s + r.lon, 0) / geo.length : null,
        ex: rs.slice().sort((a, b) => (b.first || '').localeCompare(a.first || '') || b.addr.localeCompare(a.addr)).slice(0, 3).map(r => [r.id, r.addr, r.city, r.type, r.first]) };
    }).sort((a, b) => b.n - a.n || a.z.localeCompare(b.z));
    return { sale: cur.current_sale, label: cur.label, new_since: since, total: rows.length, zips };
  }
  function prepare(ix, cur) {
    ix.label = ix.label || cur.label;
    ix.byZip = {}; ix.cities = {};
    ix.zips.forEach(z => {
      ix.byZip[z.z] = z;
      const c = ix.cities[z.c] = ix.cities[z.c] || { c: z.c, zips: [], n: 0, nw: 0 };
      c.zips.push(z.z); c.n += z.n; c.nw += z.nw;
    });
    return ix;
  }

  // an area is a ZIP ("77084") or a city name ("Katy", meaning all of its ZIPs)
  const isZip = a => /^\d{5}$/.test(a);
  const zipsOf = (ix, areas) => [...new Set(areas.flatMap(a => isZip(a) ? [a] : (ix.cities[a] || { zips: [] }).zips))];
  const areaLabel = (ix, a) => isZip(a) ? (ix.byZip[a] ? `${a} ${ix.byZip[a].c}` : a) : `${a} (all ZIPs)`;
  const shortList = areas => areas.length <= 3 ? areas.join(', ') : `${areas.slice(0, 2).join(', ')} + ${areas.length - 2} more`;
  function miles(a, b, c, d) {
    const R = 3958.8, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const PIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';

  function mount(el, opts) {
    const o = Object.assign({ variant: 'hero', areas: [], picks: null, picksLabel: 'Busiest ZIPs', title: null }, opts || {});
    const id = 'za' + (++uid);
    const saved = store.get();
    const S = { areas: [], active: -1, opts: [], near: null, done: false };
    el.classList.add('za', 'za-v-' + o.variant);
    el.innerHTML = `
      <div class="za-head">${o.variant === 'dialog' ? '' : `<span class="za-eyebrow">${BELL}Free ZIP alerts</span>`}
        <h2 class="disp za-title" id="${id}-t"></h2>
        <p class="za-lead">Tell us where you buy. We'll email you when a new foreclosure is filed there.</p></div>
      <div class="za-form">
        <div class="za-saved" hidden></div>
        <div class="za-pick">
          <div class="za-combo">
            <label class="sr" for="${id}-q">Add a ZIP code or city</label>
            <input id="${id}-q" type="text" inputmode="search" autocomplete="off" spellcheck="false" placeholder="ZIP or city, e.g. 77084"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-lb">
            <ul class="za-lb" id="${id}-lb" role="listbox" aria-label="Matching ZIP codes and cities" hidden></ul>
          </div>
          <button type="button" class="btn btn-ghost za-near">${PIN}Near me</button>
        </div>
        <div class="za-chosen" aria-live="polite"></div>
        <div class="za-picks"><span class="za-picks-l"></span><span class="za-picks-c"></span></div>
        <div class="za-msg" role="status"></div>
        <div class="za-preview" aria-live="polite"></div>
        <form class="za-signup" novalidate>
          <label class="sr" for="${id}-e">Email address</label>
          <input id="${id}-e" type="email" required placeholder="you@company.com" autocomplete="email">
          <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="za-trap">
          <button class="btn btn-red" type="submit">${BELL}<span>Watch these areas</span></button>
        </form>
        <div class="za-note">Free · no card. One email on the days something new is filed in your areas, plus the Wednesday Brief and this sale's spreadsheet right away. Unsubscribe in one click.</div>
      </div>
      <div class="za-done" hidden tabindex="-1"></div>`;
    const $ = s => el.querySelector(s);
    const q = $('.za-combo input'), lb = $('.za-lb'), email = $('.za-signup input[type=email]');
    if (saved && saved.email) email.value = saved.email;
    $('.za-title').textContent = o.title ? o.title(o.areas || []) : 'Watch my area';
    loading();

    data().then(ix => {
      (o.areas || []).forEach(a => add(ix, a, true));
      savedNote();
      wire(ix);
      render(ix);
    }).catch(() => { $('.za-preview').innerHTML = '<div class="za-pv-empty">The ZIP list could not load. Type your ZIP and email anyway.</div>'; $('.za-picks').hidden = true; wire(null); });

    // until the ZIP index arrives: the same rows as an empty pick, with stand-in chips, so the card keeps its height
    function loading() {
      const side = o.variant === 'prop';
      $('.za-chosen').innerHTML = '<span class="za-empty">No areas yet. Type a ZIP or city, or tap one below.</span>';
      $('.za-picks-l').textContent = o.picksLabel;
      $('.za-picks-c').innerHTML = `<span class="chip za-add za-sk" aria-hidden="true">+ 77000<span>Spring${side ? '' : ' · 00'}</span></span>`.repeat(side ? 4 : 6);
      $('.za-preview').innerHTML = '<div class="za-pv-empty"><strong>…</strong> properties across Harris County go to the coming sale. Pick an area to see what your alert would hold.</div>';
    }

    // someone who signed up on this device: say what they already watch (a new sign-up adds to it)
    function savedNote() {
      const sv = store.get(), box = $('.za-saved');
      if (!sv || !sv.areas || !sv.areas.length) { box.hidden = true; return; }
      const has = (o.areas || []).length && o.areas.every(a => sv.areas.includes(a));
      box.innerHTML = `${BELL}<span>${has ? 'You already get alerts here. You watch' : 'You already watch'} <strong>${esc(shortList(sv.areas))}</strong>. Areas you add join those.</span>`;
      box.hidden = false;
    }
    function msg(t, bad) { const m = $('.za-msg'); m.textContent = t || ''; m.classList.toggle('bad', Boolean(bad)); }

    function add(ix, a, quiet) {
      a = String(a || '').trim();
      if (!a) return false;
      if (!isZip(a)) { const k = Object.keys(ix.cities).find(c => c.toLowerCase() === a.toLowerCase()); if (!k) return false; a = k; }
      else if (!ix.byZip[a] && !/^77/.test(a)) { if (!quiet) msg('We cover Harris County, Texas: its ZIP codes start with 77.', true); return false; }
      if (S.areas.includes(a)) return true;
      if (S.areas.length >= MAX) { if (!quiet) msg(`Up to ${MAX} areas per alert. Remove one to add another.`, true); return false; }
      S.areas.push(a);
      if (!quiet) msg('');
      return true;
    }

    function options(ix, text) {
      const t = text.trim().toLowerCase();
      if (!t) return [];
      const out = [];
      if (/^\d+$/.test(t)) {
        ix.zips.filter(z => z.z.startsWith(t)).sort((a, b) => b.n - a.n).slice(0, 7).forEach(z => out.push({ a: z.z, main: `${z.z} <span>${esc(z.c)}</span>`, n: z.n }));
        if (/^77\d{3}$/.test(t) && !ix.byZip[t]) out.unshift({ a: t, main: `${t} <span>none this sale yet</span>`, n: 0, note: 'watch anyway' });
      } else {
        const cities = Object.values(ix.cities).filter(c => c.c.toLowerCase().includes(t))
          .sort((a, b) => (b.c.toLowerCase().startsWith(t) - a.c.toLowerCase().startsWith(t)) || b.n - a.n);
        cities.slice(0, 3).forEach(c => out.push({ a: c.c, main: `${esc(c.c)} <span>all ${c.zips.length} ZIP${c.zips.length > 1 ? 's' : ''}</span>`, n: c.n }));
        cities.slice(0, 2).forEach(c => c.zips.slice(0, cities.length === 1 ? 6 : 3).forEach(z => out.push({ a: z, main: `${z} <span>${esc(c.c)}</span>`, n: ix.byZip[z].n })));
      }
      return out.slice(0, 8);
    }
    function openList(ix) {
      S.opts = ix ? options(ix, q.value) : [];
      S.active = S.opts.length ? 0 : -1;
      lb.innerHTML = S.opts.map((x, i) => `<li role="option" id="${id}-o${i}" data-i="${i}" aria-selected="${i === S.active}"${S.areas.includes(x.a) ? ' class="on"' : ''}>
        <span class="m">${x.main}</span><span class="n mono">${x.n ? x.n + ' listed' : (x.note || '')}</span></li>`).join('')
        || (q.value.trim() ? `<li class="za-none">${/^\d+$/.test(q.value.trim()) ? (/^(7|77\d{0,3})$/.test(q.value.trim()) ? 'Keep typing the 5-digit ZIP' : 'Harris County ZIP codes start with 77') : 'No Harris County city by that name in this sale. Try a ZIP.'}</li>` : '');
      const show = Boolean(lb.innerHTML);
      lb.hidden = !show; q.setAttribute('aria-expanded', show && S.opts.length > 0);
      q.setAttribute('aria-activedescendant', S.active >= 0 ? `${id}-o${S.active}` : '');
    }
    function closeList() { lb.hidden = true; q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); S.active = -1; }
    function choose(ix, i) {
      const x = S.opts[i]; if (!x) return;
      if (add(ix, x.a)) { q.value = ''; closeList(); render(ix); }
    }

    function wire(ix) {
      q.addEventListener('input', () => openList(ix));
      q.addEventListener('focus', () => { if (q.value.trim()) openList(ix); });
      q.addEventListener('keydown', e => {
        const open = !lb.hidden && S.opts.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!open) { openList(ix); return; }
          e.preventDefault();
          S.active = (S.active + (e.key === 'ArrowDown' ? 1 : -1) + S.opts.length) % S.opts.length;
          lb.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', i === S.active));
          q.setAttribute('aria-activedescendant', `${id}-o${S.active}`);
          const li = lb.querySelector(`#${id}-o${S.active}`); if (li) li.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (open && S.active >= 0) choose(ix, S.active);
          else if (ix && /^\d{5}$/.test(q.value.trim()) && add(ix, q.value.trim())) { q.value = ''; closeList(); render(ix); }
        } else if (e.key === 'Escape' && !lb.hidden) { e.preventDefault(); e.stopPropagation(); closeList(); }
        else if (e.key === 'Backspace' && !q.value && S.areas.length && ix) { S.areas.pop(); render(ix); }
      });
      q.addEventListener('blur', () => setTimeout(closeList, 150));
      lb.addEventListener('mousedown', e => e.preventDefault());
      lb.addEventListener('click', e => { const li = e.target.closest('[role=option]'); if (li) choose(ix, +li.dataset.i); });

      $('.za-near').addEventListener('click', () => {
        if (!ix) return;
        if (!navigator.geolocation) { msg('Your browser does not share location. Type your ZIP instead.', true); return; }
        const b = $('.za-near'); b.disabled = true; msg('Finding the ZIPs closest to you…');
        navigator.geolocation.getCurrentPosition(p => {
          b.disabled = false;
          const { latitude: la, longitude: lo } = p.coords;
          S.near = ix.zips.filter(z => z.lat != null).map(z => ({ z: z.z, d: miles(la, lo, z.lat, z.lon) })).sort((a, b) => a.d - b.d).slice(0, 5);
          msg(S.near[0].d > 60 ? 'You seem to be outside Harris County. These are the closest ZIPs in this sale.' : 'The ZIPs in this sale closest to you. Tap to add.');
          render(ix);
        }, () => { b.disabled = false; msg('Location is off for this site. Type your ZIP or city instead.', true); }, { timeout: 10000, maximumAge: 600000 });
      });

      el.addEventListener('click', e => {
        const x = e.target.closest('[data-rm]'); if (x && ix) { S.areas = S.areas.filter(a => a !== x.dataset.rm); render(ix); q.focus(); return; }
        const p = e.target.closest('[data-add]'); if (p && ix) { add(ix, p.dataset.add); render(ix); }
      });

      $('.za-signup').addEventListener('submit', async e => {
        e.preventDefault();
        if (ix && !S.areas.length && q.value.trim()) { const t = q.value.trim(); if (add(ix, t)) { q.value = ''; render(ix); } }
        if (!S.areas.length) { msg('Pick at least one ZIP or city to watch.', true); q.focus(); return; }
        const em = email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { msg('Enter your email so we can send the alerts.', true); email.focus(); return; }
        const btn = $('.za-signup button'), lbl = btn.querySelector('span'), was = lbl.textContent;
        btn.disabled = true; lbl.textContent = 'Saving…'; msg('');
        const zips = ix ? zipsOf(ix, S.areas) : S.areas.filter(isZip);
        try {
          const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: em, source: ('zip-alerts:' + S.areas.join(',')).slice(0, 80), zips, areas: S.areas, website: $('.za-trap').value }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again, or write to leads@firsttuesdaylist.com.');
          // the backend adds new areas to what this email already watches; mirror that on this device
          const prev = store.get(), all = [...new Set([...(prev && prev.email === em ? prev.areas || [] : []), ...S.areas])];
          store.set({ email: em, areas: all, at: new Date().toISOString() });
          done(ix, em, d.message, all);
        } catch (err) {
          msg(err.message && !/fetch|network/i.test(err.message) ? err.message : 'Something went wrong. Try again, or write to leads@firsttuesdaylist.com.', true);
        }
        btn.disabled = false; lbl.textContent = was;
      });
    }

    function render(ix) {
      if (!ix) return;
      const t = $('.za-title');
      t.textContent = o.title ? o.title(S.areas) : 'Watch my area';
      if (o.lead && !S.leadSet) { S.leadSet = true; const L = o.lead(ix); if (L) $('.za-lead').textContent = L; }
      $('.za-chosen').innerHTML = S.areas.length
        ? S.areas.map(a => `<span class="za-chip">${esc(areaLabel(ix, a))}<button type="button" data-rm="${esc(a)}" aria-label="Stop watching ${esc(a)}">×</button></span>`).join('')
        : '<span class="za-empty">No areas yet. Type a ZIP or city, or tap one below.</span>';
      // suggestions: "near me" results, else the page's picks, else the busiest ZIPs of the sale
      const around = o.around && !isNaN(o.around.lat) ? ix.zips.filter(z => z.lat != null).map(z => ({ z: z.z, d: miles(o.around.lat, o.around.lon, z.lat, z.lon) })).sort((x, y) => x.d - y.d).slice(0, 8) : null;
      const near = S.near || around, list = near ? near.map(x => x.z) : (o.picks || ix.zips.slice(0, 8).map(z => z.z));
      // on a property page the suggestions are the ZIPs around it (distance from the property says little, so it's left out)
      const side = o.variant === 'prop', avail = list.filter(z => !S.areas.includes(z)).slice(0, side ? 4 : 6);
      $('.za-picks-l').textContent = avail.length ? (S.near ? 'Near you' : o.picksLabel) : '';
      $('.za-picks-c').innerHTML = avail.map(z => { const r = ix.byZip[z], dd = near && near.find(x => x.z === z);
        return `<button type="button" class="chip za-add" data-add="${z}" aria-label="Add ${z} ${r ? esc(r.c) : ''}">+ ${z}<span>${r ? esc(r.c) : ''}${dd && (S.near || !side) ? ' · ' + (dd.d < 10 ? dd.d.toFixed(1) : Math.round(dd.d)) + ' mi' : r && !side ? ' · ' + r.n : ''}</span></button>`; }).join('');
      $('.za-picks').hidden = !avail.length;
      $('.za-signup button span').textContent = (store.get() || {}).areas ? 'Add to my alerts' : S.areas.length === 1 ? `Watch ${S.areas[0]}` : S.areas.length ? `Watch these ${S.areas.length} areas` : 'Watch these areas';
      preview(ix);
    }

    function preview(ix) {
      const pv = $('.za-preview');
      if (!S.areas.length) {
        pv.innerHTML = `<div class="za-pv-empty"><strong>${ix.total}</strong> properties across Harris County go to the ${esc(ix.label)} sale. Pick an area to see what your alert would hold.</div>`;
        return;
      }
      const zs = zipsOf(ix, S.areas).map(z => ix.byZip[z]).filter(Boolean);
      const n = zs.reduce((s, z) => s + z.n, 0), nw = zs.reduce((s, z) => s + z.nw, 0);
      // newest first, one ZIP at a time, so every watched ZIP shows up in the sample
      const queues = zs.map(z => z.ex.slice()).filter(q => q.length).sort((a, b) => (b[0][4] || '').localeCompare(a[0][4] || '')), ex = [];
      for (let i = 0; ex.length < 3 && queues.some(q => q.length); i++) { const q = queues[i % queues.length]; if (q.length) ex.push(q.shift()); }
      const mapUrl = '/map?zips=' + encodeURIComponent(zipsOf(ix, S.areas).join(','));
      pv.innerHTML = `<div class="za-pv-h"><span>Your alert, if it went out today</span><a href="${mapUrl}">On the map ›</a></div>
        <div class="za-pv-n">${n ? `<strong class="mono">${n}</strong> propert${n === 1 ? 'y' : 'ies'} in your area for the ${esc(ix.label)} sale · <strong class="mono">${nw}</strong> new this week`
          : `Nothing filed in ${esc(shortList(S.areas))} for the ${esc(ix.label)} sale. You'll hear from us the day one is.`}</div>
        ${ex.length ? `<ul class="za-pv-l">${ex.map(([pid, addr, city, type, first]) => `<li><a href="/property/${encodeURIComponent(pid)}">${esc(addr)}</a>${first >= ix.new_since ? `<span class="tag tag-new">New ${md(first)}</span>` : `<span class="tag tag-plain">Filed ${md(first)}</span>`}<span class="mt">${esc(city)} · ${esc(TYPES[type] || 'Other')}</span></li>`).join('')}</ul>` : ''}`;
    }

    function done(ix, em, serverMsg, all) {
      S.done = true;
      const d = $('.za-done');
      const labels = ix ? all.map(a => areaLabel(ix, a)) : all;
      const zips = ix ? zipsOf(ix, all) : all.filter(isZip);
      d.innerHTML = `<div class="za-ok">${BELL}<span class="disp">You're watching ${all.length} area${all.length > 1 ? 's' : ''}</span></div>
        <div class="za-chosen">${labels.map(l => `<span class="za-chip za-chip-ok">${esc(l)}</span>`).join('')}</div>
        <p>We'll email <strong>${esc(em)}</strong> the day a new foreclosure is filed in ${zips.length > 1 ? `these ${zips.length} ZIP codes` : 'this ZIP code'}.
        ${/already/i.test(serverMsg || '') ? 'You were already on the list, so these areas are added to it.' : `The spreadsheet for the ${esc(ix ? ix.label : 'current')} sale is on its way now.`}</p>
        <p class="za-srv">Each alert lists the new notices with their address, sale date and flood zone, and links to the map. To change your areas, reply to any alert. Unsubscribe in one click.</p>
        <div class="lock"><span>Members also see the value, loan, estimated equity and rent for every property in your areas. <a href="/pricing">See membership ›</a></span></div>
        <div class="za-done-a"><a class="btn btn-navy" href="/map?zips=${encodeURIComponent(zips.join(','))}">See your areas on the map</a><button type="button" class="btn btn-ghost za-again">Add another area</button></div>`;
      $('.za-form').hidden = true; $('.za-head').hidden = true; d.hidden = false;
      d.focus({ preventScroll: true });
      d.querySelector('.za-again').onclick = () => { d.hidden = true; $('.za-form').hidden = false; $('.za-head').hidden = false; S.areas = []; savedNote(); if (ix) render(ix); q.focus(); };
      el.dispatchEvent(new CustomEvent('za:done', { bubbles: true, detail: { areas: all.slice(), zips } }));
      // the same "signed up" memory as the other forms (the home page's sticky bar stops asking)
      try { localStorage.setItem('ftl_subscribed', '1'); } catch (err) { /* private mode */ }
      document.dispatchEvent(new CustomEvent('ftl:subscribed', { detail: { source: 'zip-alerts' } }));
    }
    return el;
  }

  // the widget in a modal dialog (Esc or × closes; focus returns to the button that opened it)
  let dlg = null;
  function open(opts) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'za-dialog';
      dlg.setAttribute('aria-labelledby', 'za-dlg-t');
      document.body.append(dlg);
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    }
    dlg.innerHTML = `<button type="button" class="za-x" aria-label="Close">×</button><div class="za-dlg-eyebrow">${BELL}Free ZIP alerts</div><div class="za-slot"></div>`;
    dlg.querySelector('.za-x').onclick = () => dlg.close();
    const slot = dlg.querySelector('.za-slot');
    mount(slot, Object.assign({ variant: 'dialog', title: a => a.length ? `Watch ${shortList(a)}` : 'Watch this area' }, opts));
    slot.querySelector('.za-title').id = 'za-dlg-t';
    dlg.showModal();
    const first = slot.querySelector('.za-signup input[type=email]');
    if (first && (opts.areas || []).length) first.focus(); else slot.querySelector('.za-combo input').focus();
  }

  return { mount, open, data, saved: () => store.get() };
})();
