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
    <nav aria-label="Footer"><a href="/map">Map</a><a href="/pricing">Pricing</a><a href="/#how">How we research</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:leads@firsttuesdaylist.com">Contact</a></nav></div>
    <p>Compiled from public records. Not verified. Do your own title and lien research before bidding. First Tuesday List is not a law firm, title company, broker or auctioneer and does not give legal or investment advice. Aerial photos: Harris County Appraisal District imagery. Links to Zillow, Realtor.com, Redfin and Google open their sites; we're not affiliated with them.</p>
    <p>© ${new Date().getFullYear()} First Tuesday List</p></div>`;
  document.body.append(footer);

  // The current sale (written by tools/build_site.py): topbar status and the countdown to its start, Central time.
  fetch('/data/current.json').then(r => r.json()).then(cur => {
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
      set('cdTop', phase === 'open' || phase === 'complete' ? `Sale in ${Math.floor(ms / 864e5)} days.` : '');
      document.querySelectorAll('[data-sale="phase"]').forEach(el => { el.textContent = tag; });
      const d = Math.max(0, Math.floor(ms / 864e5)), h = Math.max(0, Math.floor(ms / 36e5) % 24), m = Math.max(0, Math.floor(ms / 6e4) % 60);
      document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = String({ d, h, m }[el.dataset.cd]).padStart(2, '0'); });
    }
    tick(); setInterval(tick, 30000);
  }).catch(() => {});

  // Every sign-up slot gets our own form; it posts to /api/subscribe (the welcome email carries the spreadsheet).
  // The hidden "website" field is a trap for bots; "source" says where people signed up (page, flyer).
  const source = (() => { try { return (new URLSearchParams(location.search).get('utm_source') || '') + ':' + (location.pathname || '/'); } catch (e) { return location.pathname; } })();
  document.querySelectorAll('.bh-form').forEach(slot => {
    const f = document.createElement('form');
    f.className = 'signup signup-form';
    f.innerHTML = '<label class="sr">Email address</label><input type="email" required placeholder="you@company.com" autocomplete="email">'
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
        if (r.ok) f.reset();
      } catch (err) { /* keep the default message */ }
      btn.disabled = false; btn.textContent = 'Send me the list';
      done.style.display = 'block'; done.textContent = msg;
    });
  });
})();
