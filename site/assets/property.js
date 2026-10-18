// Property page: photo / Street View / map tabs and the days-to-sale chip.
(function () {
  const root = document.getElementById('prop');
  if (!root) return;
  const lat = parseFloat(root.dataset.lat), lon = parseFloat(root.dataset.lon);
  const $ = k => root.querySelector(`[data-k="${k}"]`);

  // stagger the sheen on the locked bars so it travels down each card, top to bottom
  root.querySelectorAll('.card').forEach(card => card.querySelectorAll('.redact i').forEach((bar, i) => bar.style.setProperty('--d', (i * 0.22).toFixed(2) + 's')));

  const sale = new Date(root.dataset.sale + 'T10:00:00-06:00');
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
