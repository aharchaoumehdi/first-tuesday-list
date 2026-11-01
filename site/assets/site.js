// Shared header, footer and email sign-up for every page.
(function () {
  const CFG = window.FTL_CONFIG || {};
  const page = document.body.dataset.page || '';
  const nav = [['index', '/', 'Home'], ['map', '/map', 'Map'], ['pricing', '/pricing', 'Pricing']];

  const top = document.createElement('div');
  top.className = 'topbar';
  top.innerHTML = `<div class="wrap"><span><strong style="color:#fff" id="saleTop">Harris County foreclosure auction list.</strong> <span id="saleNote"></span> <span id="cdTop"></span></span><span class="hide-sm">Harris County, TX · first Tuesday of every month</span></div>`;

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="wrap">
    <a class="logo" href="/" aria-label="First Tuesday List home"><img src="/assets/logo.png" alt="First Tuesday List" width="166" height="40"></a>
    <nav class="site-nav" id="siteNav" aria-label="Main">${nav.map(([k, h, l]) => `<a href="${h}"${k === page ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <button class="sl-btn" type="button" aria-haspopup="dialog" aria-controls="slDrawer"><svg class="sl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.9l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/></svg><span class="sl-lbl">My shortlist</span><span class="sl-n"></span></button>
    <a class="btn btn-red cta" href="/#signup">Get the free list</a>
    <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="siteNav"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>`;
  document.body.prepend(header);

  // Membership state, once per page: is it open, who is signed in. Pages wait on FTL.status (never rejects).
  window.FTL = window.FTL || {};
  FTL.status = fetch('/api/status', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null)
    .then(s => s || { open: false, member: null, signed_in: false, founding: true, founding_left: 100 });
  FTL.status.then(s => {
    const cta = header.querySelector('.cta');
    if (s.member) { cta.textContent = 'Member home'; cta.href = '/members'; cta.className = 'btn btn-navy cta'; }
    else if (s.open) {
      const a = document.createElement('a'); a.href = s.signed_in ? '/members' : '/signin'; a.textContent = s.signed_in ? 'Your account' : 'Sign in';
      a.className = 'signin-link'; cta.before(a);
    }
    // "Join the waitlist" becomes "Become a member" once membership is open
    if (s.open && !s.member) document.querySelectorAll('[data-join]').forEach(el => { el.textContent = 'Become a member'; });
    document.body.classList.toggle('is-member', Boolean(s.member));
  });
  document.body.prepend(top);
  const btn = header.querySelector('.menu-btn'), navEl = header.querySelector('.site-nav');
  btn.addEventListener('click', () => { const o = navEl.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><img src="/assets/logo.png" alt="First Tuesday List" width="132" height="32" style="height:32px;width:auto">
    <nav aria-label="Footer"><a href="/map">Map</a><a href="/areas">By city and ZIP</a><a href="/pricing">Pricing</a><a href="/#how">How we research</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:leads@firsttuesdaylist.com">Contact</a></nav></div>
    <p>Compiled from public records. Not verified. Do your own title and lien research before bidding. First Tuesday List is not a law firm, title company, broker or auctioneer and does not give legal or investment advice. Aerial photos: Harris County Appraisal District imagery. Links to Zillow, Realtor.com, Redfin and Google open their sites; we're not affiliated with them.</p>
    <p>© ${new Date().getFullYear()} First Tuesday List</p></div>`;
  document.body.append(footer);

  // The current sale (written by tools/build_site.py): topbar status and the countdown to its start, Central time.
  const curP = fetch('/data/current.json').then(r => r.json());
  curP.then(cur => {
    const sale = new Date(cur.starts);
    const houstonDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    function tick() {
      const now = new Date(), ms = sale - now, today = houstonDay(now), day = cur.current_sale;
      const phase = today <= cur.deadline ? 'open' : today < day ? 'complete' : today === day ? 'today' : 'over';
      const [head, note, tag] = {
        open: [`${cur.label} list is growing.`, `Notices can be filed until ${cur.deadline_label}.`, 'Filings open'],
        complete: [`${cur.label} list is complete.`, `The filing deadline passed ${cur.deadline_label}.`, 'List complete'],
        today: [`The ${cur.label} sale is today.`, '', 'Sale today'],
        over: [`The ${cur.label} sale is over.`, `The ${cur.next_label} list is coming.`, 'Sale over']
      }[phase];
      const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
      set('saleTop', head); set('saleNote', note);
      set('cdTop', phase === 'open' || phase === 'complete' ? (days => days === 1 ? 'Sale tomorrow.' : `Sale in ${days} days.`)(Math.round((Date.parse(day) - Date.parse(today)) / 864e5)) : '');
      document.querySelectorAll('[data-sale="phase"]').forEach(el => { el.textContent = tag; });
      const d = Math.max(0, Math.floor(ms / 864e5)), h = Math.max(0, Math.floor(ms / 36e5) % 24), m = Math.max(0, Math.floor(ms / 6e4) % 60);
      document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = String({ d, h, m }[el.dataset.cd]).padStart(2, '0'); });
    }
    tick(); setInterval(tick, 30000);
  }).catch(() => {});

  // Every sign-up slot gets our own form; it posts to /api/subscribe (the welcome email carries the spreadsheet).
  // The hidden "website" field is a trap for bots; "source" says where people signed up (page, flyer),
  // plus the slot's own tag when it has one (data-source="home-hero" gives ":/#home-hero").
  const pageSource = (() => { try { return (new URLSearchParams(location.search).get('utm_source') || '') + ':' + (location.pathname || '/'); } catch (e) { return location.pathname; } })();
  document.querySelectorAll('.bh-form').forEach(slot => {
    // data-source="home-hero" adds "#home-hero" to the page source; a full tag (area pages: "area:77449") replaces it
    const tag = slot.dataset.source || '';
    const source = tag.includes(':') ? tag : pageSource + (tag ? '#' + tag : '');
    const f = document.createElement('form');
    f.className = 'signup signup-form';
    f.innerHTML = '<label class="sr">Email address</label><input type="email" required placeholder="you@company.com" autocomplete="email" aria-label="Email address">'
      + '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">'
      + '<button class="btn btn-red" type="submit">Send me the list</button>';
    slot.prepend(f);
    const done = document.createElement('div'); done.className = 'signup-done'; done.setAttribute('role', 'status'); slot.after(done);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = f.querySelector('input[type=email]').value.trim(), btn = f.querySelector('button');
      if (!email) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      let msg = 'Something went wrong. Try again, or write to leads@firsttuesdaylist.com.';
      try {
        const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source, website: f.querySelector('[name=website]').value }) });
        const d = await r.json();
        msg = d.message || d.error || msg;
        if (r.ok) {
          f.reset();
          // remembered on this device, so pages can stop asking (e.g. the home page's sticky bar)
          try { localStorage.setItem('ftl_subscribed', '1'); } catch (err) { /* private mode */ }
          document.dispatchEvent(new CustomEvent('ftl:subscribed', { detail: { source } }));
        }
      } catch (err) { /* keep the default message */ }
      btn.disabled = false; btn.textContent = 'Send me the list';
      done.style.display = 'block'; done.textContent = msg;
    });
  });

  // ---- Shortlist: any visitor saves properties (no account, kept in this browser), sees whether each one is still
  // on the list, and can email it to themself with a postponed/cancelled heads-up (source "shortlist:ID1,ID2,...").
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPES = { single_family: 'Single family', condo_townhome: 'Condo / townhome', multifamily: 'Multifamily', commercial: 'Commercial', vacant_land: 'Vacant land' };
  const STAR = '<svg class="sl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.9l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/></svg>';
  const svg = d => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = { up: svg('M6 15l6-6 6 6'), down: svg('M6 9l6 6 6-6'), x: svg('M6 6l12 12M18 6L6 18') };
  const today = () => new Date().toISOString().slice(0, 10);
  const shortDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const saleDay = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const usd = v => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US');

  const KEY = 'ftl-shortlist', MAX = 50, known = {};
  let st = { items: [], sent: null, demo: null };
  const read = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.items)) st = { items: d.items.filter(x => x && typeof x.id === 'string'), sent: d.sent || null, demo: d.demo || null };
    } catch (e) { /* storage blocked: the list lives for this page only */ }
  };
  const changed = () => { try { window.dispatchEvent(new Event('ftl:shortlist')); } catch (e) { /* very old browser */ } };
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode */ } changed(); };
  read();
  window.addEventListener('storage', e => { if (e.key === KEY) { read(); changed(); } });

  // only the free, public fields are kept (the same ones the map shows)
  const pick = r => ({ id: r.id, sale: r.sale, addr: r.addr, city: r.city, zip: r.zip, type: r.type, zone: r.zone, sfha: r.sfha,
    photo: r.photo, window: r.window, location: r.location, notice: r.notice });

  // the current sale's public rows, loaded once and only when the shortlist needs them
  let dataP = null, D = null, dataFailed = false;
  const data = () => dataP || (dataP = curP.then(cur => fetch('/data/sale-' + cur.current_sale + '.json').then(r => r.json()).then(d => {
    const byId = {};
    d.rows.forEach(r => { byId[r.id] = Object.assign({ sale: cur.current_sale }, r); });
    dataFailed = false;
    return (D = { cur, byId, rows: d.rows });
  })).catch(() => { dataP = null; dataFailed = true; return null; }));

  // bring the saved copies up to date with the latest list; an ID that is no longer on it keeps its last copy
  function refresh() {
    return data().then(d => {
      if (d) {
        const before = JSON.stringify(st.items);
        st.items = st.items.map(it => d.byId[it.id] ? Object.assign({}, it, pick(d.byId[it.id]), { saved: it.saved }) : it);
        if (JSON.stringify(st.items) !== before) { write(); return; }
      }
      changed();
    });
  }

  const SL = {
    items: () => st.items.slice(),
    has: id => st.items.some(x => x.id === id),
    count: () => st.items.length,
    // pages that already hold the rows (the map, a property page) hand them over, so saving needs no extra download
    know(rows, sale) { (rows || []).forEach(r => { if (r && r.id) known[r.id] = Object.assign({ sale }, r); }); },
    add(id, extra) {
      if (!id || SL.has(id)) return true;
      if (st.items.length >= MAX) { toast(`Your shortlist holds up to ${MAX} properties. Remove one to add another.`); return false; }
      const base = known[id] || (D && D.byId[id]);
      st.items.push(Object.assign({ id }, extra || {}, base ? pick(base) : {}, { saved: today() }));
      write();
      if (!base) refresh();
      return true;
    },
    remove(id) {
      const i = st.items.findIndex(x => x.id === id);
      if (i < 0) return;
      const [it] = st.items.splice(i, 1);
      if (st.demo === id) st.demo = null;
      write();
      toast(`Removed ${it.addr || it.id} from your shortlist.`, 'Undo', () => { if (!SL.has(id)) { st.items.splice(Math.min(i, st.items.length), 0, it); write(); } });
    },
    toggle(id, extra) {
      if (SL.has(id)) { SL.remove(id); return; }
      if (SL.add(id, extra)) toast(`Saved to your shortlist (${st.items.length}).`, page === 'shortlist' ? '' : 'Open it', open);
    },
    move(id, d) {
      const i = st.items.findIndex(x => x.id === id), j = i + d;
      if (i < 0 || j < 0 || j >= st.items.length) return;
      [st.items[i], st.items[j]] = [st.items[j], st.items[i]];
      write();
    },
    open, refresh
  };
  FTL.shortlist = SL;

  // a small note at the bottom of the screen after save / remove, with Open or Undo
  const toastEl = document.createElement('div');
  toastEl.className = 'sl-toast'; toastEl.setAttribute('role', 'status'); toastEl.hidden = true;
  document.body.append(toastEl);
  let toastT;
  function toast(msg, act, fn) {
    toastEl.innerHTML = `<span>${esc(msg)}</span>${act ? `<button type="button">${esc(act)}</button>` : ''}`;
    toastEl.hidden = false;
    if (act) toastEl.querySelector('button').onclick = () => { toastEl.hidden = true; fn(); };
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 6000);
  }

  // every save button on the page ([data-sl="ID"]) and the header count follow the stored list
  const headBtn = header.querySelector('.sl-btn');
  function sync() {
    const n = st.items.length;
    const nEl = headBtn.querySelector('.sl-n');
    if (nEl.textContent !== `(${n})`) nEl.textContent = `(${n})`;
    headBtn.classList.toggle('has', n > 0);
    headBtn.setAttribute('aria-label', `My shortlist, ${n} saved`);
    document.querySelectorAll('[data-sl]').forEach(b => {
      const on = SL.has(b.dataset.sl), name = b.dataset.slAddr || 'this property';
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      const t = b.querySelector('.sl-t');
      if (t) { const want = on ? (b.dataset.on || 'Saved') : (b.dataset.off || 'Save'); if (t.textContent !== want) t.textContent = want; }
      else b.setAttribute('aria-label', on ? `Remove ${name} from my shortlist` : `Save ${name} to my shortlist`);
      b.title = on ? 'On your shortlist. Click to remove it.' : 'Save to my shortlist';
    });
  }
  // property cards anywhere (e.g. "New this week" on the home page) get a save star
  function enhance() {
    document.querySelectorAll('.prop-card').forEach(card => {
      if (card.querySelector('[data-sl]')) return;
      const a = card.querySelector('a.ph[href^="/property/"]');
      if (!a) return;
      const t = card.querySelector('.body a');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sl-star'; b.innerHTML = STAR;
      b.dataset.sl = decodeURIComponent(a.getAttribute('href').split('/').pop());
      b.dataset.slAddr = t ? t.textContent.trim() : '';
      card.append(b);
    });
    sync();
  }
  let pending = false;
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; enhance(); }); } })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-sl]');
    if (!b) return;
    e.preventDefault();
    SL.toggle(b.dataset.sl, b.dataset.slAddr ? { addr: b.dataset.slAddr } : null);
  });
  headBtn.addEventListener('click', open);

  // the drawer (every page) and the full page (/shortlist) share one view
  let drawer = null, lastFocus = null;
  function open() {
    if (page === 'shortlist') { const h = document.querySelector('#slPage h1'); if (h) { h.scrollIntoView({ block: 'center' }); h.focus(); } return; }
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.className = 'sl-drawer'; drawer.id = 'slDrawer'; drawer.hidden = true;
      drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-labelledby', 'slTitle');
      drawer.innerHTML = `<div class="sl-backdrop" data-close></div><div class="sl-panel">
        <div class="sl-top"><div><h2 class="disp" id="slTitle">My shortlist</h2><div class="sl-note">Saved in this browser. No account needed.</div></div>
        <button class="sl-x" type="button" data-close aria-label="Close my shortlist">${ICON.x}</button></div>
        <div class="sl-body"></div></div>`;
      document.body.append(drawer);
      drawer.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
      drawer.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        const f = [...drawer.querySelectorAll('a[href],button:not([disabled]),input:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      });
      mount(drawer.querySelector('.sl-body'), 'drawer');
    }
    lastFocus = document.activeElement;
    toastEl.hidden = true;
    drawer.hidden = false;
    document.body.classList.add('sl-open');
    headBtn.setAttribute('aria-expanded', 'true');
    drawer.querySelector('.sl-x').focus();
    refresh();
  }
  function close() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('sl-open');
    headBtn.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); else headBtn.focus();
  }

  const views = [];
  let ST = null, MEM = null, memAsked = false;
  FTL.status.then(s => { ST = s; views.forEach(update); });
  function loadMember() {
    if (memAsked) return; memAsked = true;
    FTL.status.then(s => {
      if (!s.member) return;
      fetch('/api/member/sale', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null)
        .then(d => { MEM = (d && d.rows) || null; views.forEach(update); }).catch(() => {});
    });
  }

  function statusOf(it) {
    if (!D) return dataFailed ? ['wait', 'Could not check the latest list right now', ''] : ['wait', 'Checking the latest list…', ''];
    const cur = D.cur, lbl = cur.label, on = D.byId[it.id] && st.demo !== it.id;
    if (on) return Date.now() > new Date(cur.starts).getTime() + 6 * 36e5 ? ['past', `The ${lbl} sale has passed`, ''] : ['ok', `Still on the list for ${lbl}`, ''];
    if (it.sale && it.sale < cur.current_sale) return ['past', `Was on the ${shortDate(it.sale)} list. That sale has passed.`, ''];
    return ['gone', `No longer on the ${lbl} list`, 'Most often that means the sale was postponed or cancelled.'];
  }

  // "3 homes, 2 ZIPs, all outside the flood zone"
  function summaryHtml(items) {
    const n = items.length;
    const homes = items.every(i => i.type === 'single_family' || i.type === 'condo_townhome');
    const noun = homes ? (n === 1 ? 'home' : 'homes') : (n === 1 ? 'property' : 'properties');
    const zips = {};
    items.forEach(i => { if (i.zip) (zips[i.zip] = zips[i.zip] || { city: i.city || '', n: 0 }).n++; });
    const zk = Object.keys(zips).sort((a, b) => zips[b].n - zips[a].n || a.localeCompare(b)), fl = items.filter(i => i.sfha != null), k = fl.filter(i => i.sfha).length;
    const flood = !fl.length ? '' : k === 0 ? (n === 1 ? 'outside the flood zone' : 'all outside the flood zone')
      : k === fl.length ? (n === 1 ? 'in a high-risk flood zone' : 'all in a high-risk flood zone') : `${k} in a high-risk flood zone`;
    const head = `${n} ${noun}, ${zk.length} ZIP${zk.length === 1 ? '' : 's'}${flood ? ', ' + flood : ''}`;
    let stat = '';
    if (D) {
      const s = items.map(statusOf), ok = s.filter(x => x[0] === 'ok').length, gone = s.filter(x => x[0] === 'gone').length, lbl = esc(D.cur.label);
      stat = gone ? `<span class="ok">${ok} still on the ${lbl} list</span> · <span class="gone">${gone} no longer on it</span>`
        : ok === n ? `<span class="ok">${n === 1 ? 'Still' : 'All ' + n + ' still'} on the ${lbl} list</span>` : '';
    }
    return `<div class="sl-sum-h">${esc(head)}</div>
      <div class="sl-zips">${zk.map(z => `<a class="tag tag-plain" href="/map?q=${esc(z)}" title="See every property for sale in ${esc(z)}">${esc(zips[z].city)} ${esc(z)} · ${zips[z].n}</a>`).join('')}</div>
      ${stat ? `<div class="sl-sum-s">${stat}</div>` : ''}`;
  }

  function itemHtml(it, i, n, mode) {
    const [cls, line, more] = statusOf(it);
    const href = '/property/' + encodeURIComponent(it.id), name = esc(it.addr || it.id);
    const tl = TYPES[it.type] || (it.type ? 'Other' : '');
    const m = MEM && MEM[it.id];
    const eq = m ? `<div class="sl-eq"><span class="k">Est. equity</span><b class="mono">${usd(m.equity)}</b></div>`
      : `<a class="sl-eq" href="/pricing" aria-label="Estimated equity for ${name}: members only. See membership"><span class="k">Est. equity</span><span class="redact"><span class="ico-lock"></span><i></i></span></a>`;
    return `<li class="sl-item" data-id="${esc(it.id)}">
      <a class="sl-ph" href="${href}" tabindex="-1" aria-hidden="true">${it.photo ? `<img loading="lazy" src="${esc(it.photo)}" alt="">` : ''}<span class="sl-rank">${i + 1}</span></a>
      <div class="sl-main"><a class="sl-addr" href="${href}">${name}</a>
        <div class="sl-sub">${esc([it.city ? `${it.city}, TX ${it.zip || ''}` : '', tl].filter(Boolean).join(' · '))}</div>
        <div class="sl-tags">${it.zone ? `<span class="tag ${it.sfha ? 'tag-flood' : 'tag-plain'}">Flood zone ${esc(it.zone)}${it.sfha ? ' (SFHA)' : ''}</span>` : ''}${it.notice ? `<span class="tag tag-plain">${it.notice === 'hoa' ? 'HOA lien' : 'Mortgage'}</span>` : ''}</div></div>
      <div class="sl-when"><strong>${esc(saleDay(it.sale))}${it.window ? ' · ' + esc(it.window) : ''}</strong>${mode === 'page' && it.location ? `<span class="sl-loc">${esc(it.location.split(',').slice(0, 2).join(','))}</span>` : ''}
        <span class="sl-status ${cls}">${esc(line)}</span>${more ? `<small>${esc(more)}</small>` : ''}</div>
      <div class="sl-foot">${eq}<div class="sl-ctl sl-noprint">
        <button type="button" data-act="up" aria-label="Move ${name} up"${i === 0 ? ' disabled' : ''}>${ICON.up}</button>
        <button type="button" data-act="down" aria-label="Move ${name} down"${i === n - 1 ? ' disabled' : ''}>${ICON.down}</button>
        <button type="button" data-act="remove" aria-label="Remove ${name} from my shortlist">${ICON.x}</button></div></div>
    </li>`;
  }

  function mount(el, mode) {
    const id = 'slmail-' + mode;
    el.classList.add('sl-view', 'sl-in-' + mode);
    el.innerHTML = `${mode === 'page' ? `<div class="sl-head"><div><div class="eyebrow">Saved in this browser · no account needed</div>
        <h1 class="disp" tabindex="-1">My shortlist</h1></div>
        <div class="sl-acts sl-noprint" data-v="acts"><button class="btn btn-ghost" type="button" data-v="print">${svg('M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z')}Print</button><a class="btn btn-navy" href="/map">Add more from the map</a></div></div>
        <div class="sl-print-only">Printed ${esc(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))} from firsttuesdaylist.com/shortlist</div>` : ''}
      <div class="sl-demo sl-noprint" data-v="demo" hidden><span><strong>Demo shortlist.</strong> To show every status, it pretends the last one dropped off the list.</span><button type="button" class="chip" data-v="cleardemo">Clear the demo</button></div>
      <div class="sl-cols"><div class="sl-left">
        <div class="sl-sum" data-v="sum"></div>
        <ol class="sl-list" data-v="list"></ol>
        <div class="sl-empty" data-v="empty" hidden><span class="sl-empty-ico">${STAR}</span><div class="disp">Nothing saved yet</div>
          <p>Tap the star on any property, on the map or on its page, and it lands here. No account needed. Then email the list to yourself and we'll tell you if any of them gets postponed or cancelled.</p>
          <a class="btn btn-red" href="/map">Open the map</a></div>
        ${mode === 'drawer' ? `<div class="sl-links" data-v="links"><a class="btn btn-ghost" href="/shortlist">Open as a page</a><a class="btn btn-ghost" href="/shortlist?print=1">${svg('M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z')}Print</a></div>` : ''}
      </div>
      <div class="sl-aside sl-noprint" data-v="aside">
        <form class="sl-mail">
          <div class="disp sl-mail-h">Email me my shortlist</div>
          <p class="sl-mail-p">and tell me if any of them gets postponed or cancelled.</p>
          <div class="signup"><label class="sr" for="${id}">Email address</label><input id="${id}" type="email" required placeholder="you@company.com" autocomplete="email">
          <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
          <button class="btn btn-red" type="submit">Email it to me</button></div>
          <div class="sl-mail-note" data-v="mailnote"></div>
          <div class="sl-mail-done" role="status" data-v="done" hidden></div>
        </form>
        <a class="sl-lockcta" href="/pricing" data-v="lockcta"><span class="ico-lock"></span><span>Members see the value, the loan, and the estimated balance and equity of every home on the shortlist. <strong data-v="join">Join the waitlist</strong></span></a>
      </div></div>
      <p class="sl-disc">Compiled from public records. Not verified. Do your own title and lien research before bidding.</p>`;
    const v = { el, mode };
    views.push(v);
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      const li = b.closest('.sl-item');
      if (li && b.dataset.act === 'up') SL.move(li.dataset.id, -1);
      else if (li && b.dataset.act === 'down') SL.move(li.dataset.id, 1);
      else if (li && b.dataset.act === 'remove') SL.remove(li.dataset.id);
      else if (b.dataset.v === 'print') window.print();
      else if (b.dataset.v === 'cleardemo') { st.items = []; st.demo = null; write(); }
    });
    const f = el.querySelector('.sl-mail');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = f.querySelector('input[type=email]').value.trim(), btn = f.querySelector('button[type=submit]'), done = f.querySelector('[data-v=done]');
      const ids = st.items.map(x => x.id);
      if (!email || !ids.length) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      let msg = 'Something went wrong. Try again, or write to leads@firsttuesdaylist.com.';
      try {
        const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'shortlist:' + ids.join(','), shortlist: ids, website: f.querySelector('[name=website]').value }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          msg = `Done. Your shortlist of ${ids.length} is on its way to ${email}. We'll write if any of them gets postponed or cancelled.`;
          f.reset(); st.sent = { at: today(), ids }; write();
        } else msg = d.message || d.error || msg;
      } catch (err) { /* keep the default message */ }
      btn.disabled = false; btn.textContent = 'Email it to me';
      done.textContent = msg; done.hidden = false;
    });
    loadMember();
    update(v);
  }

  function update(v) {
    const el = v.el, items = st.items, n = items.length, $ = k => el.querySelector(`[data-v="${k}"]`);
    $('demo').hidden = !st.demo || !SL.has(st.demo);
    $('empty').hidden = n > 0;
    ['sum', 'list', 'aside', 'links', 'acts'].forEach(k => { const x = $(k); if (x) x.hidden = !n; });
    if (!n) { $('list').innerHTML = ''; return; }
    $('sum').innerHTML = summaryHtml(items);
    // keep keyboard focus on the same button (or the next row) when the list redraws
    const a = document.activeElement, li = a && el.contains(a) && a.dataset.act ? a.closest('.sl-item') : null;
    const keep = li ? { id: li.dataset.id, act: a.dataset.act, i: [...$('list').children].indexOf(li) } : null;
    $('list').innerHTML = items.map((it, i) => itemHtml(it, i, n, v.mode)).join('');
    $('list').querySelectorAll('.redact i').forEach((b, i) => b.style.setProperty('--d', ((i * 0.22) % 2.6).toFixed(2) + 's'));
    if (keep) {
      const rows = [...$('list').children], row = rows.find(x => x.dataset.id === keep.id);
      let b = row ? row.querySelector(`[data-act="${keep.act}"]`) : (rows[Math.min(keep.i, rows.length - 1)] || {}).querySelector?.('[data-act="remove"]');
      if (b && b.disabled) b = row.querySelector(`[data-act="${keep.act === 'up' ? 'down' : 'up'}"]`);
      if (b && !b.disabled) b.focus();
    }
    const s = st.sent, same = s && s.ids && s.ids.length === n && s.ids.every(x => SL.has(x));
    $('mailnote').textContent = !s ? 'Free. You also get the First Tuesday Brief every Wednesday. Unsubscribe anytime.'
      : same ? `You emailed this list on ${shortDate(s.at)}. We'll write if any of them gets postponed or cancelled.`
        : `You changed the list since you emailed it on ${shortDate(s.at)}. Send it again to update it.`;
    $('lockcta').hidden = Boolean(ST && ST.member);
    $('join').textContent = ST && ST.open ? 'Become a member' : 'Join the waitlist';
  }

  window.addEventListener('ftl:shortlist', () => { sync(); views.forEach(update); });

  // the full page: /shortlist (?demo=1 fills an empty list with a sample, ?print=1 opens the print dialog)
  const pageEl = document.getElementById('slPage');
  if (pageEl) {
    mount(pageEl, 'page');
    const q = new URLSearchParams(location.search);
    const seed = () => data().then(d => {
      if (!d || st.items.length) return;
      const counts = {};
      d.rows.forEach(r => { counts[r.zip] = (counts[r.zip] || 0) + 1; });
      const zips = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const ok = z => d.rows.filter(r => r.zip === z && r.type === 'single_family' && !r.sfha && r.photo);
      const picks = [...ok(zips[0]).slice(0, 2), ...ok(zips[1]).slice(0, 1), ...ok(zips[2]).slice(0, 1)];
      st.items = picks.map(r => Object.assign(pick(d.byId[r.id]), { saved: today() }));
      st.demo = picks.length > 1 ? picks[picks.length - 1].id : null;
      write();
    });
    (q.has('demo') ? seed() : Promise.resolve()).then(refresh).then(() => { if (q.has('print') && st.items.length) setTimeout(() => window.print(), 600); });
  }
  enhance();
})();
