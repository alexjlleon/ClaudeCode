(function () {
  // Figure out where to send events based on this script's own src, so no
  // hardcoded URL is needed in the embed snippet.
  var thisScript = document.currentScript;
  var endpoint = (thisScript && thisScript.getAttribute('data-endpoint')) ||
    (thisScript ? thisScript.src.replace(/\/tracker\.js.*$/, '/api/track') : null);

  if (!endpoint) return;

  // --- Session ID: persists across pages/visits in this browser ---
  var SESSION_KEY = 'wu_session_id';
  var sessionId;
  try {
    sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 'wu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch (e) {
    // localStorage blocked (private mode, etc.) -- fall back to a per-page id
    sessionId = 'wu_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function send(label, opts) {
    opts = opts || {};
    var payload = {
      label: label,
      event_type: opts.type || 'event',
      session_id: sessionId,
      page_url: location.href,
      referrer: document.referrer || null,
      meta: opts.meta || null,
    };
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true, // lets the request finish even if the page is navigating away
      }).catch(function () {});
    } catch (e) {
      /* fail silently -- tracking should never break the site */
    }
  }

  // Expose for manual funnel events, e.g.:
  //   wuTrack('Submitted inquiry form', { type: 'success', meta: { service: 'DJ' } });
  window.wuTrack = send;

  // --- Automatic: page view on load ---
  send('Viewed page: ' + location.pathname, { type: 'pageview' });

  // --- Automatic: clicks on anything tagged data-wu-track="Label text" ---
  // (checked first so manually-tagged elements don't ALSO get logged by
  // the generic auto-capture below)
  //
  // --- Automatic (auto-capture): clicks on links, buttons, and images anywhere on the page ---
  // Never captures form field values -- only the element that was clicked.
  var CLICKABLE_SELECTOR = 'a, button, input[type="button"], input[type="submit"], img, [role="button"]';

  function shortText(s, max) {
    if (!s) return '';
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
  }

  function cssPath(el) {
    if (el.id) return '#' + el.id;
    var cls = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }

  function describeClick(el) {
    var tag = el.tagName.toLowerCase();
    var meta = { tag: tag, selector: cssPath(el) };

    if (tag === 'img') {
      var alt = el.getAttribute('alt') || '';
      meta.src = el.currentSrc || el.src || null;
      return { label: 'Clicked image' + (alt ? ': ' + shortText(alt, 60) : ''), meta: meta };
    }

    var text = shortText(el.textContent, 80) ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('value') || '';

    if (tag === 'a' && el.href) meta.href = el.href;

    return { label: 'Clicked' + (text ? ': ' + text : ' ' + tag), meta: meta };
  }

  document.addEventListener(
    'click',
    function (e) {
      var tagged = e.target.closest && e.target.closest('[data-wu-track]');
      if (tagged) {
        var label = tagged.getAttribute('data-wu-track');
        var type = tagged.getAttribute('data-wu-type') || 'click';
        send(label, { type: type });
        return;
      }

      var el = e.target.closest && e.target.closest(CLICKABLE_SELECTOR);
      if (!el) return;

      var info = describeClick(el);
      send(info.label, { type: 'click', meta: info.meta });
    },
    true
  );

  // --- Automatic: time spent on this page, sent once when the visitor leaves ---
  var pageStart = Date.now();
  var timingSent = false;

  function sendTiming() {
    if (timingSent) return;
    var duration = Date.now() - pageStart;
    if (duration < 1000) return; // skip near-instant bounces, not meaningful
    timingSent = true;
    send('Time on page', {
      type: 'timing',
      meta: { duration_ms: duration, page_url: location.href },
    });
  }

  // pagehide fires reliably on navigation/tab close across desktop + mobile.
  window.addEventListener('pagehide', sendTiming);
  // Fallback: tab backgrounded (covers cases where pagehide doesn't fire).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendTiming();
  });
})();
