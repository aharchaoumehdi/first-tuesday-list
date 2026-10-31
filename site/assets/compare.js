// Compare: up to 4 properties picked from the map, the pin card or a property page, then laid side by side on /compare.
// The picks live in this browser (localStorage, with a fallback to memory). Any <input type=checkbox data-cmp="ID">
// on the page is a compare box: its data-addr / data-city / data-zip / data-photo describe the property for the tray.
// window.FTLCompare: list(), has(id), set(item, on), setAll(items), clear(), url(ids), onChange(fn), MAX
window.FTLCompare = window.FTLCompare || (function () {
  const KEY = 'ftl-compare', MAX = 4;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const okId = id => /^[A-Z]{2,6}-\d{4}-\d{1,7}$/.test(id);
  let mem = [];
  const read = () => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(v)) return v.filter(x => x && okId(x.id)).slice(0, MAX); } catch (e) { /* private window */ }
    return mem.slice();
  };
  const write = v => { mem = v.slice(0, MAX); try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* memory only */ } };
  const subs = [];
  const fire = msg => { sync(); renderTray(msg); subs.forEach(fn => { try { fn(read()); } catch (e) { /* a listener must not break the others */ } }); };

  const list = () => read();
  const has = id => read().some(x => x.id === id);
  const url = ids => '/compare?ids=' + (ids || read().map(x => x.id)).join(',');
  // returns false when the tray is full (the box stays unticked)
  function set(item, on) {
    if (!item || !okId(item.id)) return false;
    let v = read();
    if (on) {
      if (v.some(x => x.id === item.id)) return true;
      if (v.length >= MAX) { fire(`You can compare up to ${MAX}. Remove one first.`); return false; }
      v.push({ id: item.id, addr: item.addr || item.id, city: item.city || '', zip: item.zip || '', photo: item.photo || '' });
      write(v); fire(`Added ${item.addr || item.id}. ${v.length} selected.`);
    } else {
      v = v.filter(x => x.id !== item.id); write(v); fire(`Removed ${item.addr || item.id}. ${v.length} selected.`);
    }
    return true;
  }
  const setAll = items => { write(items.filter(x => x && okId(x.id))); fire(''); };
  const clear = () => { write([]); fire('Compare cleared.'); };
  const onChange = fn => subs.push(fn);

  // one compare box (checkbox in a label); callers drop it into their markup
  const box = (r, cls) => `<label class="cmp-check ${cls || ''}"><input type="checkbox" data-cmp="${esc(r.id)}" data-addr="${esc(r.addr)}" data-city="${esc(r.city)}" data-zip="${esc(r.zip)}" data-photo="${esc(r.photo)}"${has(r.id) ? ' checked' : ''}><span>Compare</span></label>`;

  function sync() {
    const ids = new Set(read().map(x => x.id));
    document.querySelectorAll('input[data-cmp]').forEach(i => { i.checked = ids.has(i.dataset.cmp); });
  }
  document.addEventListener('change', e => {
    const i = e.target;
    if (!i.matches || !i.matches('input[data-cmp]')) return;
    const d = i.dataset;
    if (!set({ id: d.cmp, addr: d.addr, city: d.city, zip: d.zip, photo: d.photo }, i.checked)) i.checked = false;
  });
  // another tab changed the picks
  window.addEventListener('storage', e => { if (e.key === KEY) fire(''); });

  // the floating tray: thumbnails, "3 selected", Compare
  let tray = null, live = null;
  function renderTray(msg) {
    if (document.body.dataset.page === 'compare') return;
    const v = read();
    if (!tray) {
      tray = document.createElement('div'); tray.className = 'cmp-tray'; tray.setAttribute('role', 'region'); tray.setAttribute('aria-label', 'Properties to compare');
      live = document.createElement('div'); live.className = 'sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      document.body.append(tray, live);
      tray.addEventListener('click', e => {
        const x = e.target.closest('[data-rm]'); if (x) { const it = read().find(r => r.id === x.dataset.rm); set(it || { id: x.dataset.rm }, false); return; }
        if (e.target.closest('[data-clear]')) clear();
      });
    }
    if (msg) live.textContent = msg;
    const full = msg && msg.startsWith('You can compare');
    document.body.classList.toggle('cmp-on', v.length > 0);
    if (!v.length) { tray.hidden = true; tray.innerHTML = ''; return; }
    tray.hidden = false;
    const slots = v.map((r, i) => `<span class="cmp-slot"><img src="${esc(r.photo)}" alt=""><b>${'ABCD'[i]}</b>
      <button type="button" data-rm="${esc(r.id)}" aria-label="Remove ${esc(r.addr)} from compare" title="Remove ${esc(r.addr)}">×</button></span>`).join('')
      + Array.from({ length: MAX - v.length }, () => '<span class="cmp-slot empty" aria-hidden="true">+</span>').join('');
    tray.innerHTML = `<div class="cmp-slots">${slots}</div>
      <div class="cmp-txt"><strong>${v.length} selected</strong><span>${full ? `Up to ${MAX}: remove one first` : v.length < 2 ? 'Tick one more to compare' : `Up to ${MAX} side by side`}</span></div>
      ${v.length >= 2 ? `<a class="btn btn-red cmp-go" href="${url()}">Compare<span class="sr"> ${v.length} properties</span></a>` : `<span class="btn btn-red cmp-go" aria-disabled="true">Compare</span>`}
      <button type="button" class="cmp-clear" data-clear>Clear</button>`;
    tray.classList.toggle('cmp-full', Boolean(full));
  }

  // styles once, from the same folder as this script
  if (!document.querySelector('link[href^="/assets/compare.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/compare.css'; document.head.append(l);
  }
  function start() {
    // property page: a compare box next to "Save notice PDF"
    const prop = document.getElementById('prop');
    if (prop && prop.dataset.id) {
      const parts = (prop.dataset.addr || '').split(', ');
      const h1 = prop.querySelector('h1'), ph = prop.querySelector('.g-photo');
      const r = { id: prop.dataset.id, addr: h1 ? h1.textContent.trim() : parts[0], city: parts[1] || '', zip: ((parts[2] || '').match(/\d{5}/) || [''])[0], photo: ph ? ph.getAttribute('src') : '' };
      const acts = prop.querySelector('.acts');
      if (acts && !acts.querySelector('[data-cmp]')) acts.insertAdjacentHTML('afterbegin', box(r, 'cmp-btn'));
    }
    sync(); renderTray('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { MAX, list, has, set, setAll, clear, url, onChange, box, okId };
})();
