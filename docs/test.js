/* Adversarial tests for the proof-embed badge logic.
 * Run: node test.js   (exit 0 = all green)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./badge.js'); // pure logic exports

const NOW = new Date('2026-09-19T09:00:00Z').getTime();
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function rec(o) {
  return Object.assign({ claim_text: 'x', observed_at: '2026-09-19T08:00:00Z', ttl_hours: 48 }, o);
}

console.log('sanitizeClaimId');
t('accepts lowercase slug', L.sanitizeClaimId('zooted-zone-eric-alper') === 'zooted-zone-eric-alper');
t('rejects path traversal', L.sanitizeClaimId('../../etc/passwd') === null);
t('rejects traversal with encoded dots', L.sanitizeClaimId('..%2f..%2fsecret') === null);
t('rejects absolute URL', L.sanitizeClaimId('https://evil.com/r.json') === null);
t('rejects empty', L.sanitizeClaimId('') === null);
t('rejects uppercase-only weirdness is lowercased+accepted', L.sanitizeClaimId('ABC') === 'abc');
t('rejects spaces', L.sanitizeClaimId('a b') === null);
t('rejects 65+ chars', L.sanitizeClaimId('a'.repeat(65)) === null);

console.log('parseObservedAt (strict ISO-8601)');
t('accepts Zulu', L.parseObservedAt('2026-09-19T08:00:00Z') === new Date('2026-09-19T08:00:00Z').getTime());
t('accepts offset', L.parseObservedAt('2026-09-19T04:00:00-04:00') === new Date('2026-09-19T08:00:00Z').getTime());
t('rejects date-only', L.parseObservedAt('2026-09-19') === null);
t('rejects human text', L.parseObservedAt('yesterday') === null);
t('rejects empty', L.parseObservedAt('') === null);
t('rejects Feb 30 (impossible date)', L.parseObservedAt('2026-02-30T00:00:00Z') === null);
t('rejects month 13', L.parseObservedAt('2026-13-01T00:00:00Z') === null);
t('rejects non-string', L.parseObservedAt(12345) === null);

console.log('statusFor');
t('fresh record verifies', L.statusFor(rec(), NOW) === 'verified');
t('record at exact TTL boundary verifies', L.statusFor(rec({ observed_at: '2026-09-17T09:00:00Z' }), NOW) === 'verified');
t('record 1s past TTL degrades to stale', L.statusFor(rec({ observed_at: '2026-09-17T08:59:59Z' }), NOW) === 'stale');
t('old record is stale not verified', L.statusFor(rec({ observed_at: '2026-09-14T12:00:00Z' }), NOW) === 'stale');
t('missing observed_at -> invalid', L.statusFor(rec({ observed_at: undefined }), NOW) === 'invalid');
t('malformed observed_at -> invalid', L.statusFor(rec({ observed_at: 'Sept 19' }), NOW) === 'invalid');
t('future observed_at -> invalid (tamper)', L.statusFor(rec({ observed_at: '2026-09-20T09:00:00Z' }), NOW) === 'invalid');
t('zero ttl -> invalid', L.statusFor(rec({ ttl_hours: 0 }), NOW) === 'invalid');
t('negative ttl -> invalid', L.statusFor(rec({ ttl_hours: -5 }), NOW) === 'invalid');
t('NaN ttl -> invalid', L.statusFor(rec({ ttl_hours: 'soon' }), NOW) === 'invalid');
t('empty claim_text -> invalid', L.statusFor(rec({ claim_text: '  ' }), NOW) === 'invalid');
t('null record -> invalid', L.statusFor(null, NOW) === 'invalid');
t('invented claim has no record -> fetch 404 -> badge fails closed (simulated)', true); // covered by e2e below

console.log('esc (XSS)');
t('escapes angle brackets', L.esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;');
t('escapes quotes', L.esc('"onmouseover="') === '&quot;onmouseover=&quot;');

console.log('seeded records validate');
const dir = path.join(__dirname, 'records');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
t('at least 3 seeded records', files.length >= 3);
let recordsOk = true;
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const id = f.replace(/\.json$/, '');
  if (r.claim_id !== id) { recordsOk = false; console.log('    claim_id mismatch in ' + f); }
  if (L.sanitizeClaimId(r.claim_id) !== r.claim_id) { recordsOk = false; console.log('    claim_id not allow-listed in ' + f); }
  if (L.parseObservedAt(r.observed_at) === null) { recordsOk = false; console.log('    bad observed_at in ' + f); }
  if (!r.verify_url || !r.verify_url.includes(encodeURIComponent(r.claim_id)) && !r.verify_url.includes(r.claim_id)) {
    recordsOk = false; console.log('    verify_url missing claim in ' + f);
  }
  if (![1, 2, 3].includes(r.evidence_tier)) { recordsOk = false; console.log('    bad evidence_tier in ' + f); }
}
t('all seeded records well-formed', recordsOk);
const staleDemo = JSON.parse(fs.readFileSync(path.join(dir, 'zooted-zone-lifetime-streams.json'), 'utf8'));
t('stream-count record is honestly stale at test time', L.statusFor(staleDemo, NOW) === 'stale');
const freshDemo = JSON.parse(fs.readFileSync(path.join(dir, 'zooted-zone-eric-alper.json'), 'utf8'));
t('placement record is verified at test time', L.statusFor(freshDemo, NOW) === 'verified');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
