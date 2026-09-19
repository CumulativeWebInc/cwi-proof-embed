/* badge.js — CWI catalog proof embed. Zero dependencies.
 *
 * Site-owner integration (one snippet):
 *   <script src="https://cumulativewebinc.github.io/cwi-proof-embed/badge.js"
 *           data-claim="zooted-zone-eric-alper"></script>
 *
 * On load, the badge fetches its backing record from
 *   https://cumulativewebinc.github.io/cwi-proof-embed/records/<claim-id>.json
 * and renders purely from (observed_at, ttl_hours, now):
 *   fresh  -> "VERIFIED by CWI" + observed date + link to the verifier page
 *   stale  -> "STALE — recheck" + last observed date (never "verified")
 *   missing/error/tampered -> "UNVERIFIED — recheck" (never "verified")
 *
 * The badge NEVER renders "verified" without a live backing record whose
 * observed_at is a strict ISO-8601 timestamp inside its TTL. The standalone
 * verifier page (records/<id>.json + /verify/?claim=<id>) is the trust
 * anchor; this badge is a convenience render.
 */
(function () {
  'use strict';

  var BASE = 'https://cumulativewebinc.github.io/cwi-proof-embed';
  var CLAIM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

  // ---- pure logic (also exercised by test.js in Node) ----

  function sanitizeClaimId(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    return CLAIM_RE.test(s) ? s : null;
  }

  function parseObservedAt(v) {
    if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    // Reject impossible calendar dates that Date() silently normalizes
    // (e.g. 2026-02-30 -> Mar 2): compare the date portion back.
    var iso = d.toISOString().slice(0, 10);
    if (iso !== v.slice(0, 10) && v.charAt(10) === 'T') {
      // Allow timezone offsets: compare via UTC components instead.
      var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3]) {
        // For Z-suffixed values the slice must match exactly.
        if (/Z$/.test(v)) return null;
      }
    }
    return d.getTime();
  }

  // Returns 'verified' | 'stale' | 'invalid'. Never guesses.
  function statusFor(record, nowMs) {
    if (!record || typeof record !== 'object') return 'invalid';
    if (typeof record.claim_text !== 'string' || record.claim_text.trim() === '') return 'invalid';
    var t = parseObservedAt(record.observed_at);
    if (t === null) return 'invalid';
    var ttl = Number(record.ttl_hours);
    if (!isFinite(ttl) || ttl <= 0) return 'invalid';
    if (t > nowMs + 60000) return 'invalid'; // observed in the future: tampered
    var ageHours = (nowMs - t) / 3600000;
    return ageHours <= ttl ? 'verified' : 'stale';
  }

  function fmtDate(observedAt) {
    return String(observed_at_safe(observedAt)).slice(0, 10);
  }
  function observed_at_safe(v) { return typeof v === 'string' ? v : ''; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- browser render ----

  var STYLES = {
    wrap: 'display:inline-flex;align-items:center;gap:6px;font:12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
      'border:1px solid #d8d8d8;border-radius:999px;padding:4px 10px;background:#fff;color:#111;' +
      'text-decoration:none;white-space:nowrap;',
    verified: 'border-color:#1a7f37;background:#f0fbf4;color:#0d5c26;',
    stale: 'border-color:#b25e09;background:#fff8ec;color:#8a4b08;',
    invalid: 'border-color:#9aa0a6;background:#f6f8fa;color:#5f6368;',
    dot: 'width:8px;height:8px;border-radius:50%;display:inline-block;',
    small: 'font-size:11px;opacity:.75;'
  };

  function renderBadge(hostEl, model) {
    // model: { state, claimText, observedAt, verifyUrl }
    var a = document.createElement('a');
    a.setAttribute('href', model.verifyUrl);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.setAttribute('style', STYLES.wrap + (STYLES[model.state] || STYLES.invalid));

    var dotColor = model.state === 'verified' ? '#1a7f37'
      : model.state === 'stale' ? '#b25e09' : '#9aa0a6';
    var label = model.state === 'verified' ? 'VERIFIED by CWI'
      : model.state === 'stale' ? 'STALE — recheck' : 'UNVERIFIED — recheck';

    var dot = document.createElement('span');
    dot.setAttribute('style', STYLES.dot + 'background:' + dotColor + ';');
    a.appendChild(dot);

    var strong = document.createElement('strong');
    strong.textContent = label;
    a.appendChild(strong);

    var sub = document.createElement('span');
    sub.setAttribute('style', STYLES.small);
    if (model.state === 'verified') {
      sub.textContent = 'observed ' + fmtDate(model.observedAt) + ' · view proof';
    } else if (model.state === 'stale') {
      sub.textContent = 'last observed ' + fmtDate(model.observedAt) + ' · view proof';
    } else {
      sub.textContent = 'claim could not be confirmed · view proof';
    }
    a.appendChild(sub);

    hostEl.textContent = '';
    hostEl.appendChild(a);
  }

  function mount(scriptEl) {
    var host = document.createElement('span');
    host.setAttribute('class', 'cwi-proof-badge');
    scriptEl.parentNode.insertBefore(host, scriptEl.nextSibling);

    var claimId = sanitizeClaimId(scriptEl.getAttribute('data-claim'));
    var verifyUrl = BASE + '/verify/?claim=' + encodeURIComponent(claimId || 'unknown');

    function fail() {
      renderBadge(host, { state: 'invalid', claimText: '', observedAt: '', verifyUrl: verifyUrl });
    }
    if (!claimId) { fail(); return; }

    var url = BASE + '/records/' + claimId + '.json';
    fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('record HTTP ' + res.status);
        return res.json();
      })
      .then(function (record) {
        var st = statusFor(record, Date.now());
        if (st === 'invalid') { fail(); return; }
        renderBadge(host, {
          state: st,
          claimText: record.claim_text,
          observedAt: record.observed_at,
          verifyUrl: BASE + '/verify/?claim=' + encodeURIComponent(claimId)
        });
      })
      .catch(function () { fail(); });
  }

  function boot() {
    var scripts = document.querySelectorAll('script[data-claim][src*="cwi-proof-embed/badge.js"]');
    for (var i = 0; i < scripts.length; i++) {
      try { mount(scripts[i]); } catch (e) { /* one bad embed never breaks the host page */ }
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  // Export pure logic for Node tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeClaimId: sanitizeClaimId, parseObservedAt: parseObservedAt, statusFor: statusFor, esc: esc };
  }
})();
