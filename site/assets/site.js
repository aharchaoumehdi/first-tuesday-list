// Shared header, footer and email sign-up for every page.
(function () {
  const CFG = window.FTL_CONFIG || {};
  // Where sign-ups go. Swap for the beehiiv embed or API once it's set up.
  const SUBSCRIBE_URL = CFG.subscribeUrl || 'https://firsttuesdaylist.beehiiv.com/subscribe';
  const page = document.body.dataset.page || '';
  const nav = [['index', '/', 'Home'], ['map', '/map', 'Map'], ['pricing', '/pricing', 'Pricing']];

  const top = document.createElement('div');
  top.className = 'topbar';
  top.innerHTML = `<div class="wrap"><span><strong style="color:#fff">Nov 3 list is complete.</strong> The filing deadline passed Oct 13. <span id="cdTop"></span></span><span class="hide-sm">Harris County, TX · first Tuesday of every month</span></div>`;

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="wrap">
    <a class="logo" href="/" aria-label="First Tuesday List home"><img src="/assets/logo.png" alt="First Tuesday List" width="166" height="40"></a>
    <nav class="site-nav" id="siteNav" aria-label="Main">${nav.map(([k, h, l]) => `<a href="${h}"${k === page ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <a class="btn btn-red cta" href="/#signup">Get the free list</a>
    <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="siteNav"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>`;
  document.body.prepend(header);
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

  // Countdown to the next sale (first Tuesday of the month, 10:00 AM Central).
  const sale = new Date('2026-11-03T10:00:00-06:00');
  function tick() {
    const ms = sale - new Date();
    const d = Math.max(0, Math.floor(ms / 864e5)), h = Math.max(0, Math.floor(ms / 36e5) % 24), m = Math.max(0, Math.floor(ms / 6e4) % 60);
    const t = document.getElementById('cdTop'); if (t) t.textContent = ms > 0 ? `Sale in ${d} days.` : 'Sale day.';
    document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = String({ d, h, m }[el.dataset.cd]).padStart(2, '0'); });
  }
  tick(); setInterval(tick, 30000);

  // beehiiv's embedded form can take a few seconds to appear (or be blocked), so
  // each slot shows our own form at once and hands over when beehiiv's has loaded.
  document.querySelectorAll('.bh-form').forEach(slot => {
    const fb = document.createElement('form');
    fb.className = 'signup signup-form';
    fb.innerHTML = '<label class="sr">Email address</label><input type="email" required placeholder="you@company.com" autocomplete="email"><button class="btn btn-red" type="submit">Send me the list</button>';
    slot.prepend(fb);
    const done = document.createElement('div'); done.className = 'signup-done'; slot.after(done);
    const swap = setInterval(() => {
      // beehiiv inserts its own wrapper next to the script; it only gets a real height once the form is ready
      const shown = [...slot.children].some(c => c !== fb && c.tagName !== 'SCRIPT' && c.getBoundingClientRect().height > 40);
      if (shown) { fb.remove(); clearInterval(swap); }
    }, 400);
    setTimeout(() => clearInterval(swap), 20000);
  });

  // Every sign-up form on the page.
  document.querySelectorAll('form.signup-form').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const email = f.querySelector('input[type=email]').value.trim();
    if (!email) return;
    window.open(SUBSCRIBE_URL + '?email=' + encodeURIComponent(email), '_blank', 'noopener');
    const done = f.parentElement.querySelector('.signup-done');
    if (done) { done.style.display = 'block'; done.textContent = 'Almost done: confirm on the beehiiv page that just opened.'; }
  }));
})();
