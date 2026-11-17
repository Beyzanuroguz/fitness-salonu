'use strict';
// Unified shell and calorie target: grouped menu, drawer, logout, Mifflin-St Jeor estimate,
// manual target persistence, server-support honesty, CSP and responsive rules.
// Runs app.js in a VM with a stub DOM and fake fetch; no server or database is opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = path.join(__dirname, '..', '..', 'public');
const read = f => fs.readFileSync(path.join(pub, f), 'utf8');
const E = require(path.join(pub, 'energy.js'));

/* ---------- Mifflin-St Jeor ---------- */
test('BMR, TDEE and goal targets match Mifflin-St Jeor', () => {
  const m = E.estimate({ age: 30, sex: 'male', height_cm: 180, weight_kg: 80, activity: 'moderate', goal: 'maintain' });
  assert.deepEqual(m.result, { bmr: 1780, tdee: 2759, target: 2759, delta: 0, factor: 1.55, bmi: 24.7 });
  const f = E.estimate({ age: 25, sex: 'female', height_cm: 165, weight_kg: 60, activity: 'sedentary', goal: 'lose' });
  assert.equal(f.result.bmr, 1345);
  assert.equal(f.result.tdee, 1614);
  assert.equal(f.result.target, 1314);
  assert.ok(f.cautions.some(c => /bazal/.test(c)), 'deficit below BMR is flagged');
  const g = E.estimate({ age: 40, sex: 'female', height_cm: 170, weight_kg: 70, activity: 'very_active', goal: 'gain' });
  assert.equal(g.result.target, Math.round((700 + 1062.5 - 200 - 161) * 1.9 + 300));
  assert.equal(E.estimate({ age: '30', sex: 'male', height_cm: '180,0', weight_kg: '80', activity: 'light', goal: 'maintain' }).result.tdee, Math.round(1780 * 1.375));
});

test('standard estimate is refused where it does not apply', () => {
  const base = { age: 30, sex: 'female', height_cm: 165, weight_kg: 60, activity: 'light', goal: 'maintain' };
  const cases = [[{ age: 16 }, /18 yaş/], [{ age: 101 }, /100 yaş/], [{ pregnancy: true }, /Hamilelik/], [{ medical: true }, /sağlık durumu/], [{ weight_kg: 40, height_cm: 170 }, /çok düşük/]];
  for (const [patch, re] of cases) {
    const e = E.estimate({ ...base, ...patch });
    assert.equal(e.result, null, JSON.stringify(patch));
    assert.ok(e.blockers.some(b => re.test(b)), JSON.stringify(patch));
    assert.match(E.resultView({ ...base, ...patch }), /Standart hesap uygulanamıyor/);
  }
  assert.ok(E.estimate({ ...base, weight_kg: 130, height_cm: 170 }).cautions.some(c => /Yüksek vücut kitle/.test(c)));
  const missing = E.assess({ activity: 'light' });
  assert.deepEqual(Object.keys(missing.errors).sort(), ['age', 'height_cm', 'sex', 'weight_kg']);
  assert.match(E.assess({ ...base, age: 30.5 }).errors.age, /tam sayı/);
  assert.match(E.assess({ ...base, height_cm: 90 }).errors.height_cm, /100–250/);
  // A blocked estimate still allows a user-chosen manual target (e.g. set with a dietitian).
  assert.deepEqual(E.resolveTarget({ ...base, pregnancy: true, target_mode: 'manual', manual_kcal: 2300 }), { kcal: 2300, source: 'manual' });
  assert.equal(E.resolveTarget({ ...base, pregnancy: true }).kcal, null);
});

test('manual target is never reset by measurement changes or by switching modes', () => {
  let p = E.normalizeProfile({ age: 30, sex: 'male', height_cm: 180, weight_kg: 80, activity: 'moderate', goal: 'maintain', target_mode: 'manual', manual_kcal: 2100 });
  p = E.applyEdit(p, { weight_kg: 95, goal: 'lose', activity: 'very_active' });
  assert.deepEqual(E.resolveTarget(p), { kcal: 2100, source: 'manual' });
  p = E.applyEdit(p, { target_mode: 'auto' });
  assert.equal(E.resolveTarget(p).source, 'auto');
  assert.equal(p.manual_kcal, 2100, 'value kept while auto is selected');
  p = E.applyEdit(p, { target_mode: 'manual' });
  assert.equal(E.resolveTarget(p).kcal, 2100);
  // readForm keeps manual_kcal even though the input is disabled in auto mode.
  const form = fakeForm({ age: '30', height_cm: '180', weight_kg: '96', manual_kcal: '2100', sex: 'male', activity: 'moderate', goal: 'maintain', target_mode: 'auto' });
  const r = E.readForm(form, p);
  assert.equal(r.manual_kcal, 2100);
  assert.equal(r.weight_kg, 96);
  assert.match(E.resolveTarget({ ...r, target_mode: 'manual', manual_kcal: 400 }).error, /1000–6000/);
});
function fakeForm(values, checks = {}) {
  const radios = ['sex', 'activity', 'goal', 'target_mode'];
  return { querySelector(sel) {
    const m = sel.match(/\[name="(\w+)"\](:checked)?/); if (!m) return null;
    const [, name, checked] = m;
    if (checked) return radios.includes(name) && values[name] ? { value: values[name] } : null;
    if (name in checks) return { checked: checks[name] };
    return name in values ? { value: values[name], checked: false } : null;
  } };
}

/* ---------- Storage honesty ---------- */
function memSession() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), map: m }; }
test('without server support the profile is kept per tab and never reported as saved', async () => {
  const calls = [];
  const request = async (url, method, body) => { calls.push([url, method, body]); throw Object.assign(Error('API bulunamadı'), { status: 404 }); };
  const session = memSession();
  const store = E.createStore({ request, session, userId: 7 });
  const loaded = await store.load();
  assert.equal(loaded.server, false);
  const saved = await store.save({ age: 30, sex: 'male', height_cm: 180, weight_kg: 80, target_mode: 'manual', manual_kcal: 2000 });
  assert.equal(saved.persisted, false);
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [['/api/v9/nutrition/profile', 'GET'], ['/api/v9/nutrition/profile', 'PATCH']]);
  assert.equal(JSON.parse(session.map.get('formclub:energy-profile:7')).manual_kcal, 2000);
  const local = E.statusView({ local: true, server: false });
  assert.match(local, /kaydedilmedi/);
  assert.doesNotMatch(local, /Hesabına kaydedildi/);
  assert.match(E.view(saved.profile, { server: false }), />Bu oturumda kullan</);
  assert.equal((await E.createStore({ request, session, userId: 7 }).load()).profile.manual_kcal, 2000);
  assert.equal((await E.createStore({ request, session, userId: 8 }).load()).profile.manual_kcal, '', 'other accounts do not see it');
});

test('with server support only a confirmed write is reported as saved; other errors surface', async () => {
  const profile = { age: 30, sex: 'female', height_cm: 165, weight_kg: 60, activity: 'light', goal: 'lose', target_mode: 'auto', manual_kcal: 1800, updated_at: '2026-11-17T10:00:00Z' };
  let body;
  const ok = E.createStore({ request: async (u, m, b) => { if (m === 'PATCH') body = b; return { profile }; }, session: memSession() });
  assert.equal((await ok.load()).server, true);
  const s = await ok.save({ ...profile, age: '30', weight_kg: '60,0' });
  assert.equal(s.persisted, true);
  assert.equal(body.age, 30); assert.equal(body.weight_kg, 60); assert.equal(body.manual_kcal, 1800);
  assert.ok(!('user_id' in body) && !('member_id' in body), 'identity comes from the session only');
  assert.match(E.statusView({ persisted: true, updatedAt: profile.updated_at }), /Hesabına kaydedildi · 2026-11-17 10:00/);
  for (const status of [500, 400, 401, 403]) {
    const st = E.createStore({ request: async () => { throw Object.assign(Error('x' + status), { status }); }, session: memSession() });
    await assert.rejects(st.save(profile), { status }, String(status));
  }
  const empty = E.createStore({ request: async () => ({}), session: memSession() });
  await assert.rejects(empty.save(profile), /onaylamadı/);
});

/* ---------- View: accessibility, escaping, CSP ---------- */
test('calculator view is labelled, grouped, escaped and free of inline handlers', () => {
  const html = E.view({ age: '<img src=x onerror=alert(1)>', sex: 'female', activity: 'light' }, { showErrors: true });
  assert.ok(!html.includes('<img'));
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  for (const legend of ['Hesaplama parametresi (cinsiyet)', 'Aktivite seviyesi', 'Hedef', 'Kalori hedefi', 'Hesabı etkileyen durumlar']) assert.ok(html.includes(`<legend>${legend}</legend>`), legend);
  assert.match(html, /aria-invalid="true" aria-describedby="en-err-age"/);
  assert.match(html, /id="energy-result" class="en-result" aria-live="polite"/);
  assert.match(html, /tıbbi veya kişisel beslenme önerisi değildir/i);
  assert.match(html, /Kilo vermek[\s\S]*Kiloyu korumak[\s\S]*Kilo almak/);
  assert.match(html, /value="auto" checked[\s\S]*value="manual"/);
  assert.match(html, /name="manual_kcal"[^>]*disabled/);
  for (const a of E.ACTIVITY) assert.ok(html.includes(`value="${a.id}"`), a.id);
});

/* ---------- App shell in a VM ---------- */
function element(id) {
  return { id, hidden: false, textContent: '', innerHTML: '', disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, focus() {}, remove() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
}
function boot({ role = 'member', hash = '#energy', profileStatus = 404, logoutFails = false } = {}) {
  const app = element('app'), toast = element('toast'), listeners = {}, requests = [];
  let loggedIn = true, sessionCleared = false;
  const user = { id: 5, username: 'ada', role, member_id: role === 'member' ? 1 : null, trainer_id: role === 'teacher' ? 1 : null };
  const state = { members: [{ id: 1, name: 'Ada Üye', phone: '', email: '', plan: 'Aylık', credits: 4, expires: '2026-12-30', status: 'Aktif' }], classes: [], bookings: [], trainers: [{ id: 1, name: 'Eğitmen', specialty: 'Pilates' }], payments: [], checkins: [], measurements: [] };
  const fetch = async (url, init = {}) => {
    requests.push([url, init]);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (url === '/api/logout') { if (logoutFails) throw TypeError('network'); loggedIn = false; return json({ ok: true }); }
    if (url === '/api/me') return json({ user: loggedIn ? user : null, setup: false });
    if (url === '/api/state') return json(state);
    if (url === '/api/v9/nutrition/profile') return { ok: false, status: profileStatus, json: async () => ({ error: 'API bulunamadı' }) };
    if (url.startsWith('/api/v6/settings')) return json({});
    if (url === '/api/leads') return json([]);
    if (url === '/api/v6/analytics') return json({ monthly: [], scores: [] });
    return json([]);
  };
  const doc = {
    body: { classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
    getElementById: id => id === 'app' ? app : id === 'toast' ? toast : element(id),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name, fn) => (listeners[name] ||= []).push(fn)
  };
  const ctx = {
    FormClubDashboard: { defaults: () => ({}), render: () => '<div class="fc-dashboard"></div>', selection() {} },
    FormClubEnergy: E, document: doc, window: { addEventListener() {} }, addEventListener() {},
    navigator: { onLine: true }, location: { hash, pathname: '/' }, history: { replaceState() {} },
    sessionStorage: { clear: () => { sessionCleared = true; }, getItem: () => null, setItem() {}, removeItem() {} },
    fetch, setTimeout: () => 0, clearTimeout() {}, console, URLSearchParams, Intl, Date
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx);
  const settle = () => new Promise(r => setImmediate(r));
  const click = async dataset => { for (const fn of listeners.click) await fn({ target: { closest: () => ({ dataset, disabled: false }) }, preventDefault() {} }); await settle(); await settle(); };
  return { app, toast, requests, listeners, settle, click, ctx, get sessionCleared() { return sessionCleared; }, get loggedIn() { return loggedIn; } };
}
const until = async (t, re) => { for (let i = 0; i < 40 && !re.test(t.app.innerHTML); i++) await t.settle(); return t.app.innerHTML; };

test('menu: grouped sections, every page reachable once, active page, no version names', async () => {
  for (const role of ['admin', 'member', 'teacher']) {
    const t = boot({ role, hash: '#energy' });
    const html = await until(t, /fc-side/);
    assert.doesNotMatch(html.replace(/(?:src|href)="[^"]*"/g, ''), /\bV[5-9](?:\.\d)?\b/, role + ' shows a version name');
    const items = vm.runInContext('navItems[role].map(x=>x[0])', t.ctx);
    const grouped = vm.runInContext('navGroups[role].flatMap(g=>g[1])', t.ctx);
    assert.deepEqual([...grouped].sort(), [...items].sort(), role + ': each page in exactly one section');
    assert.equal(new Set(grouped).size, grouped.length);
    assert.doesNotMatch(html, /<h2 class="fc-group-title"[^>]*>Diğer</);
    assert.equal((html.match(/aria-current="page"/g) || []).length >= 1, true);
    assert.match(html, /class="fc-navlink active" aria-current="page" data-page="energy"/);
    assert.match(html, /<nav class="fc-nav" id="main-nav" aria-label="Ana menü">/);
    assert.match(html, /<ul aria-labelledby="nav-g0">/);
    assert.match(html, /<button class="fc-burger" type="button" data-act="menu" aria-controls="app-drawer" aria-expanded="false">/);
    assert.match(html, /<a class="skip-link" href="#module-content"/);
    // Logout sits in the pinned footer of the menu, not in the page toolbar.
    assert.match(html, /<div class="fc-side-foot">[\s\S]*data-act="logout"[\s\S]*<\/aside>/);
    assert.equal((html.match(/data-act="logout"/g) || []).length, 1);
  }
});

test('energy page: unsupported server is stated, nothing claims to be saved', async () => {
  const t = boot({ role: 'member', hash: '#energy', profileStatus: 404 });
  const html = await until(t, /energyForm/);
  assert.match(html, /Profil kaydı sunucuda henüz etkin değil/);
  assert.doesNotMatch(html, /Hesabına kaydedildi/);
  assert.match(html, /Bu oturumda kullan/);
  const profile = await until(boot({ role: 'teacher', hash: '#profile' }), /energyForm/);
  assert.match(profile, /Kalori ihtiyacı ve hedef/);
  const nutrition = await until(boot({ role: 'member', hash: '#nutrition' }), /en-summary/);
  assert.match(nutrition, /Günlük kalori hedefin/);
  assert.match(nutrition, /data-page="energy"/);
});

test('logout calls the server, clears private state and shows the login screen', async () => {
  const t = boot({ role: 'member', hash: '#home' });
  await until(t, /fc-side/);
  await t.click({ act: 'logout' });
  await until(t, /Hesabına giriş yap/);
  const call = t.requests.find(r => r[0] === '/api/logout');
  assert.equal(call[1].method, 'POST');
  assert.equal(call[1].headers['Content-Type'], 'application/json', 'CSRF guard requires JSON');
  assert.equal(call[1].credentials, 'same-origin');
  assert.equal(t.loggedIn, false);
  assert.equal(t.sessionCleared, true);
  assert.match(t.app.innerHTML, /Hesabına giriş yap/);
  assert.equal(vm.runInContext('account', t.ctx), null);
  assert.match(t.toast.textContent, /Çıkış yapıldı/);
});

test('failed logout is reported and does not pretend the session ended', async () => {
  const t = boot({ role: 'member', hash: '#home', logoutFails: true });
  await until(t, /fc-side/);
  await t.click({ act: 'logout' });
  assert.match(t.toast.textContent, /Çıkış yapılamadı/);
  assert.equal(t.sessionCleared, false);
  assert.ok(vm.runInContext('account', t.ctx), 'still signed in locally because the server did not confirm');
  assert.doesNotMatch(t.app.innerHTML, /Hesabına giriş yap/);
});

test('drawer: modal on phones, Escape and focus return, hash routes only real pages', () => {
  const js = read('app.js');
  for (const s of ["setAttribute('inert','')", "setAttribute('aria-modal','true')", "b.setAttribute('aria-expanded',String(open))", "e.key!=='Escape'", "e.key==='Tab'&&open&&isPhone()", "(max-width: 899px)", 'menuOpener']) assert.ok(js.includes(s), s);
  assert.match(js, /hashchange',\(\)=>\{const next=location\.hash\.slice\(1\);if\(account&&navItems\[role\]\.some/);
  assert.doesNotMatch(js, /\son(?:click|load|error|submit)\s*=\s*["'`]/, 'no inline handler attributes');
});

/* ---------- Responsive, CSP, no version names in static UI ---------- */
test('responsive shell: sidebar on desktop, drawer below 900 px, safe for 360 px', () => {
  const css = read('shell.css');
  assert.match(css, /@media \(max-width:899px\)\{[\s\S]*\.fc-side\{position:fixed[^}]*width:min\(320px,86vw\)/);
  assert.match(css, /\.fc-side\.open\{transform:none;visibility:visible/);
  assert.match(css, /\.fc-side-foot\{position:sticky;bottom:0/);
  assert.match(css, /\.fc-burger\{[^}]*width:44px;height:44px/);
  assert.match(css, /\.fc-navlink\{[^}]*min-height:44px/);
  assert.match(css, /\.fc-logout\{[^}]*min-height:44px/);
  assert.match(css, /\.en-field input\{[^}]*font-size:16px/, 'no iOS zoom on focus');
  assert.match(css, /@media \(max-width:420px\)\{\.en-row\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /safe-area-inset/);
  const outside = css.replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const m of outside.matchAll(/(?<![-\w])(?:min-)?width:(\d+)px/g)) assert.ok(Number(m[1]) <= 360, m[0]);
  const html = read('index.html');
  assert.ok(html.indexOf('/shell.css') > html.indexOf('/style.css'));
  assert.ok(html.indexOf('/runtime-config.js') < html.indexOf('/energy.js') && html.indexOf('/energy.js') < html.indexOf('/app.js'));
  assert.doesNotMatch(html, /<script>(?!<)/);
  const sw = read('sw.js');
  assert.match(sw, /'\/shell\.css','\/energy\.js'/);
});

test('user-facing pages and manifests no longer show V7/V8/V9 names', () => {
  const visible = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(?:src|href)="[^"]*"/g, '');
  for (const f of ['index.html', 'v7.html', 'v8.html', 'v9/index.html', 'manifest.webmanifest', 'v9/manifest.webmanifest']) assert.doesNotMatch(visible(read(f)), /\bV[5-9](?:\.\d)?\b/, f);
  const strings = s => [...visible(s).matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/gs)].map(m => m[2]).join('\n');
  for (const f of ['v7.js', 'v8.js', 'v9/v9.js', 'v9/sw.js', 'app.js', 'energy.js']) assert.doesNotMatch(strings(read(f)).replace(/\/v\d[\w./-]*/g, ''), /(?<![\w.])V[5-9](?:\.\d)?(?![\w.])/, f);
});
