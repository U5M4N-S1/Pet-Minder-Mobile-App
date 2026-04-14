// Loads the Google Maps JavaScript API (with Places library) once per page
// and exposes window.whenMapsReady(cb) so feature code can wait for it.
// Requires window.GOOGLE_MAPS_API_KEY to be set (from js/config.js).
// If the key is blank, this is a no-op and the caller should fall back.
(function () {
  window._mapsReady  = false;
  window._mapsWaiters = [];
  window.whenMapsReady = function (cb) {
    if (window._mapsReady) { try { cb(); } catch {} }
    else window._mapsWaiters.push(cb);
  };
  window.hasGoogleMapsKey = function () {
    return !!(window.GOOGLE_MAPS_API_KEY && window.GOOGLE_MAPS_API_KEY.trim());
  };
  window.__onGoogleMapsReady = function () {
    window._mapsReady = true;
    const q = window._mapsWaiters.slice();
    window._mapsWaiters = [];
    q.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  };

  const key = window.GOOGLE_MAPS_API_KEY;
  if (!key || !key.trim()) {
    console.info('[PawPal] No GOOGLE_MAPS_API_KEY set in js/config.js — Google Maps & Places will not load.');
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
          '&libraries=places&callback=__onGoogleMapsReady&v=weekly&loading=async';
  s.onerror = function () {
    console.error('[PawPal] Google Maps script failed to load. Check the key, billing, and that Maps JavaScript API + Places API are enabled.');
  };
  document.head.appendChild(s);
})();
