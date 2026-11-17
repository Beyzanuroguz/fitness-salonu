/* FORM CLUB energy profile: adult BMR/TDEE estimate (Mifflin-St Jeor), calorie goal and
   automatic/manual target. Pure helpers + view + storage adapter, shared by the browser
   (window.FormClubEnergy) and node:test. No DOM access, no inline handlers.
   This is a general estimate, not medical or dietary advice. */
(function (global) {
'use strict';

const ACTIVITY = Object.freeze([
  { id: 'sedentary', factor: 1.2, label: 'Hareketsiz', hint: 'Masa başı iş, düzenli egzersiz yok' },
  { id: 'light', factor: 1.375, label: 'Hafif aktif', hint: 'Haftada 1–3 gün hafif egzersiz' },
  { id: 'moderate', factor: 1.55, label: 'Orta aktif', hint: 'Haftada 3–5 gün orta egzersiz' },
  { id: 'active', factor: 1.725, label: 'Çok aktif', hint: 'Haftada 6–7 gün yoğun egzersiz' },
  { id: 'very_active', factor: 1.9, label: 'Aşırı aktif', hint: 'Ağır fiziksel iş veya günde iki antrenman' }
]);
// Same fixed adjustments as the server estimate endpoint, so both give the same number.
const GOALS = Object.freeze([
  { id: 'lose', delta: -300, label: 'Kilo vermek', hint: 'Koruma kalorisinden 300 kcal az' },
  { id: 'maintain', delta: 0, label: 'Kiloyu korumak', hint: 'Koruma kalorisi' },
  { id: 'gain', delta: 300, label: 'Kilo almak', hint: 'Koruma kalorisinden 300 kcal fazla' }
]);
const SEX = Object.freeze([
  { id: 'female', label: 'Kadın formülü (−161)' },
  { id: 'male', label: 'Erkek formülü (+5)' }
]);
const LIMITS = Object.freeze({ age: [18, 100], height_cm: [100, 250], weight_kg: [30, 350], manual_kcal: [1000, 6000] });
const DEFAULT_PROFILE = Object.freeze({ age: '', sex: '', height_cm: '', weight_kg: '', activity: 'moderate', goal: 'maintain', pregnancy: false, medical: false, target_mode: 'auto', manual_kcal: '' });

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const kcal = n => Math.round(n);
const fmt = n => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n);

/* Normalises any stored/server/form shape into the profile shape documented in docs/. */
function normalizeProfile(raw) {
  const p = { ...DEFAULT_PROFILE };
  if (!raw || typeof raw !== 'object') return p;
  for (const k of ['age', 'height_cm', 'weight_kg', 'manual_kcal']) { const n = num(raw[k]); p[k] = n === null ? '' : n; }
  if (SEX.some(s => s.id === raw.sex)) p.sex = raw.sex;
  if (ACTIVITY.some(a => a.id === raw.activity)) p.activity = raw.activity;
  if (GOALS.some(g => g.id === raw.goal)) p.goal = raw.goal;
  p.pregnancy = raw.pregnancy === true || raw.pregnancy === 'on' || raw.pregnancy === 'true';
  p.medical = raw.medical === true || raw.medical === 'on' || raw.medical === 'true';
  p.target_mode = raw.target_mode === 'manual' ? 'manual' : 'auto';
  return p;
}

/* Field errors (bad input) vs. blockers (input fine, but the standard estimate does not apply). */
function assess(profile) {
  const p = normalizeProfile(profile);
  const errors = {}, blockers = [], cautions = [];
  const age = num(p.age), h = num(p.height_cm), w = num(p.weight_kg);
  if (age === null) errors.age = 'Yaşını gir.';
  else if (!Number.isInteger(age)) errors.age = 'Yaş tam sayı olmalı.';
  else if (age < 18) blockers.push('Bu hesaplama yalnızca 18 yaş ve üzeri yetişkinler içindir. Büyüme dönemindeki gençlerin enerji ihtiyacı farklı yöntemlerle değerlendirilir.');
  else if (age > 100) blockers.push('Formül 100 yaş üzeri için doğrulanmamıştır.');
  if (h === null) errors.height_cm = 'Boyunu cm olarak gir.';
  else if (h < LIMITS.height_cm[0] || h > LIMITS.height_cm[1]) errors.height_cm = `Boy ${LIMITS.height_cm[0]}–${LIMITS.height_cm[1]} cm arasında olmalı.`;
  if (w === null) errors.weight_kg = 'Kilonu kg olarak gir.';
  else if (w < LIMITS.weight_kg[0] || w > LIMITS.weight_kg[1]) errors.weight_kg = `Kilo ${LIMITS.weight_kg[0]}–${LIMITS.weight_kg[1]} kg arasında olmalı.`;
  if (!p.sex) errors.sex = 'Formülde kullanılacak parametreyi seç.';
  if (p.pregnancy) blockers.push('Hamilelik ve emzirme döneminde enerji ihtiyacı değişir; standart hesap uygulanmaz. Hedefini doktorun veya diyetisyeninle belirle.');
  if (p.medical) blockers.push('Enerji ihtiyacını etkileyen bir sağlık durumu (ör. tiroit, diyabet, böbrek hastalığı, yeme bozukluğu) için takipteysen standart hesap uygun değildir. Hedefini sağlık profesyonelinle belirle.');
  let bmi = null;
  if (h !== null && w !== null && !errors.height_cm && !errors.weight_kg) {
    bmi = Math.round(w / (h / 100) ** 2 * 10) / 10;
    if (bmi < 17) blockers.push('Vücut kitle indeksin çok düşük aralıkta. Bu durumda kalori hedefi standart formülle belirlenmemeli; bir sağlık profesyoneline danış.');
    else if (bmi >= 40) cautions.push('Yüksek vücut kitle indeksinde formül sapma gösterebilir; sonucu yalnızca kaba bir başlangıç olarak kullan.');
  }
  return { profile: p, errors, blockers, cautions, bmi, ok: !Object.keys(errors).length && !blockers.length };
}

function mifflin({ age, sex, height_cm, weight_kg }) {
  return 10 * weight_kg + 6.25 * height_cm - 5 * age + (sex === 'male' ? 5 : -161);
}
// Returns null when the estimate must not be shown; never throws for user input.
function estimate(profile) {
  const a = assess(profile);
  if (!a.ok) return { ...a, result: null };
  const p = a.profile;
  const bmr = mifflin({ age: num(p.age), sex: p.sex, height_cm: num(p.height_cm), weight_kg: num(p.weight_kg) });
  const factor = ACTIVITY.find(x => x.id === p.activity).factor;
  const goal = GOALS.find(x => x.id === p.goal);
  const tdee = bmr * factor;
  const target = tdee + goal.delta;
  const cautions = [...a.cautions];
  if (bmr <= 0 || target <= 0) return { ...a, ok: false, blockers: [...a.blockers, 'Girilen ölçüler bu formülün geçerli aralığında değil.'], result: null };
  if (goal.id === 'lose' && target < bmr) cautions.push('Önerilen hedef bazal metabolizma tahmininin altında. Uzun süre bu seviyede kalmadan önce bir uzmana danış.');
  if (target < 1200) cautions.push('1200 kcal altındaki hedefler genellikle uzman takibi gerektirir.');
  return { ...a, cautions, result: { bmr: kcal(bmr), tdee: kcal(tdee), target: kcal(target), delta: goal.delta, factor, bmi: a.bmi } };
}

/* Daily target used by the app. A manual value is the user's choice: it is never replaced or
   cleared when measurements change; it only stops applying when the user picks "otomatik". */
function resolveTarget(profile) {
  const p = normalizeProfile(profile);
  if (p.target_mode === 'manual') {
    const m = num(p.manual_kcal);
    if (m !== null && m >= LIMITS.manual_kcal[0] && m <= LIMITS.manual_kcal[1]) return { kcal: Math.round(m), source: 'manual' };
    return { kcal: null, source: 'manual', error: `Manuel hedef ${LIMITS.manual_kcal[0]}–${LIMITS.manual_kcal[1]} kcal arasında olmalı.` };
  }
  const e = estimate(p);
  return e.result ? { kcal: e.result.target, source: 'auto' } : { kcal: null, source: 'auto' };
}
// Applies form edits on top of the current profile without dropping fields the form omits.
function applyEdit(profile, edits) {
  const merged = { ...normalizeProfile(profile), ...edits };
  return normalizeProfile(merged);
}

/* ---------- Storage: server when supported, otherwise this tab only ---------- */
const ENDPOINT = '/api/v9/nutrition/profile';
const SESSION_KEY = 'formclub:energy-profile';
// 404 (route missing), 405 and 501 mean the server has not shipped the profile API yet.
const isMissing = e => [404, 405, 501].includes(Number(e?.status));
function createStore({ request, session, userId }) {
  const key = SESSION_KEY + ':' + (userId ?? 'anon');
  const readLocal = () => { try { return JSON.parse(session?.getItem(key) || 'null'); } catch { return null; } };
  const writeLocal = p => { try { session?.setItem(key, JSON.stringify(p)); return true; } catch { return false; } };
  return {
    key,
    async load() {
      try {
        const r = await request(ENDPOINT, 'GET');
        return { profile: normalizeProfile(r?.profile), persisted: true, server: true, updatedAt: r?.profile?.updated_at || '' };
      } catch (e) {
        if (!isMissing(e)) throw e;
        return { profile: normalizeProfile(readLocal()), persisted: false, server: false };
      }
    },
    // persisted:true only when the server confirmed the write.
    async save(profile) {
      const p = normalizeProfile(profile);
      const body = { ...p, age: num(p.age), height_cm: num(p.height_cm), weight_kg: num(p.weight_kg), manual_kcal: num(p.manual_kcal) };
      try {
        const r = await request(ENDPOINT, 'PATCH', body);
        if (!r || typeof r.profile !== 'object' || r.profile === null) throw Object.assign(Error('Sunucu profili onaylamadı'), { status: 502 });
        return { profile: normalizeProfile(r.profile), persisted: true, server: true, updatedAt: r.profile.updated_at || '' };
      } catch (e) {
        if (!isMissing(e)) throw e;
        writeLocal(p);
        return { profile: p, persisted: false, server: false };
      }
    },
    clearLocal() { try { session?.removeItem(key); } catch { /* blocked storage */ } }
  };
}

/* ---------- View ---------- */
function field(name, label, value, error, attrs = '') {
  return `<label class="en-field${error ? ' has-error' : ''}"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${attrs} aria-invalid="${error ? 'true' : 'false'}"${error ? ` aria-describedby="en-err-${name}"` : ''}>${error ? `<small id="en-err-${name}" class="en-error">${esc(error)}</small>` : ''}</label>`;
}
function radios(name, list, value, legend) {
  return `<fieldset class="en-choices"><legend>${esc(legend)}</legend>${list.map(o => `<label class="en-choice"><input type="radio" name="${name}" value="${o.id}" ${value === o.id ? 'checked' : ''}><span><strong>${esc(o.label)}</strong>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`).join('')}</fieldset>`;
}
// The live result block is re-rendered on input without touching the form (keeps focus).
function resultView(profile, { showErrors = false } = {}) {
  const e = estimate(profile);
  const t = resolveTarget(profile);
  const p = e.profile;
  const missing = Object.keys(e.errors).length;
  let calc;
  if (e.blockers.length) calc = `<div class="en-note en-block" role="alert"><strong>Standart hesap uygulanamıyor</strong>${e.blockers.map(b => `<p>${esc(b)}</p>`).join('')}</div>`;
  else if (!e.result) calc = `<p class="muted">${showErrors && missing ? 'Eksik veya hatalı alanları düzelt.' : 'Hesaplama için yaş, formül parametresi, boy ve kilo gir.'}</p>`;
  else {
    const r = e.result;
    calc = `<dl class="en-kv">
      <div><dt>Bazal metabolizma (BMR)</dt><dd>${fmt(r.bmr)} kcal</dd></div>
      <div><dt>Günlük harcama (TDEE)</dt><dd>${fmt(r.tdee)} kcal</dd></div>
      <div><dt>Hedefe göre öneri</dt><dd>${fmt(r.target)} kcal</dd></div>
      <div><dt>Vücut kitle indeksi</dt><dd>${esc(new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(r.bmi))}</dd></div>
    </dl>
    <p class="muted small">BMR × ${esc(String(r.factor).replace('.', ','))} (aktivite) ${r.delta ? (r.delta > 0 ? '+ ' : '− ') + Math.abs(r.delta) + ' kcal (hedef)' : ''}</p>`;
  }
  const cautions = e.cautions.map(c => `<p class="en-note en-warn">${esc(c)}</p>`).join('');
  const target = t.kcal !== null
    ? `<p class="en-target"><span>Günlük kalori hedefin</span><strong>${fmt(t.kcal)} kcal</strong><small>${t.source === 'manual' ? 'Manuel hedef · ölçüler değişince değişmez' : 'Otomatik · ölçülerine göre güncellenir'}</small></p>`
    : `<p class="en-target empty"><span>Günlük kalori hedefin</span><strong>Belirlenmedi</strong>${t.error ? `<small class="en-error">${esc(t.error)}</small>` : ''}</p>`;
  return `${target}${calc}${p.target_mode === 'manual' && e.result ? `<p class="muted small">Otomatik öneri ${fmt(e.result.target)} kcal; manuel hedefin korunuyor.</p>` : ''}${cautions}`;
}
function statusView(status) {
  if (!status) return '';
  if (status.loadError) return `<p class="en-status en-status-bad" role="alert">Kayıtlı profil yüklenemedi: ${esc(status.loadError)} Hesaplama yine de çalışır.</p>`;
  if (status.saving) return '<p class="en-status" role="status">Kaydediliyor…</p>';
  if (status.dirty && !status.error) return `<p class="en-status en-status-warn" role="status">Değişiklikler henüz kaydedilmedi.${status.server === false ? ' Sunucu profil kaydını henüz desteklemiyor; bilgiler hesabına kaydedilmeyecek.' : ''}</p>`;
  if (status.error) return `<p class="en-status en-status-bad" role="alert">Kaydedilemedi: ${esc(status.error)}</p>`;
  if (status.persisted) return `<p class="en-status en-status-ok" role="status">Hesabına kaydedildi${status.updatedAt ? ' · ' + esc(String(status.updatedAt).slice(0, 16).replace('T', ' ')) : ''}.</p>`;
  if (status.local) return '<p class="en-status en-status-warn" role="status">Sunucu bu özelliği henüz desteklemiyor: bilgiler hesabına <strong>kaydedilmedi</strong>, yalnızca bu sekme açıkken kullanılır.</p>';
  if (status.server === false) return '<p class="en-status en-status-warn" role="status">Profil kaydı sunucuda henüz etkin değil. Hesaplama çalışır ama bilgiler kalıcı olarak saklanmaz.</p>';
  return '';
}
function view(profile, status = {}) {
  const a = assess(profile), p = a.profile, err = status.showErrors ? a.errors : {};
  return `<section class="panel energy" aria-labelledby="energy-h">
    <div class="panel-title"><div><h2 id="energy-h">Kalori ihtiyacı ve hedef</h2><p class="muted">Mifflin–St Jeor formülüyle yetişkinler için genel tahmin. Tıbbi veya kişisel beslenme önerisi değildir.</p></div></div>
    <div id="energy-status" aria-live="polite">${statusView(status)}</div>
    <div class="en-grid">
    <form id="energyForm" class="en-form" novalidate>
      <div class="en-row">
        ${field('age', 'Yaş', p.age, err.age, 'inputmode="numeric" autocomplete="off" required')}
        ${field('height_cm', 'Boy (cm)', p.height_cm, err.height_cm, 'inputmode="decimal" autocomplete="off" required')}
        ${field('weight_kg', 'Kilo (kg)', p.weight_kg, err.weight_kg, 'inputmode="decimal" autocomplete="off" required')}
      </div>
      ${radios('sex', SEX, p.sex, 'Hesaplama parametresi (cinsiyet)')}
      ${err.sex ? `<small class="en-error" role="alert">${esc(err.sex)}</small>` : ''}
      <p class="muted small">Formül biyolojik cinsiyete göre iki sabit kullanır; bu seçim yalnızca hesaplama içindir.</p>
      ${radios('activity', ACTIVITY, p.activity, 'Aktivite seviyesi')}
      ${radios('goal', GOALS, p.goal, 'Hedef')}
      <fieldset class="en-choices"><legend>Hesabı etkileyen durumlar</legend>
        <label class="en-check"><input type="checkbox" name="pregnancy" ${p.pregnancy ? 'checked' : ''}><span>Hamileyim veya emziriyorum</span></label>
        <label class="en-check"><input type="checkbox" name="medical" ${p.medical ? 'checked' : ''}><span>Enerji ihtiyacını etkileyen bir sağlık durumu için takipteyim</span></label>
      </fieldset>
      <fieldset class="en-choices"><legend>Kalori hedefi</legend>
        <label class="en-choice"><input type="radio" name="target_mode" value="auto" ${p.target_mode === 'auto' ? 'checked' : ''}><span><strong>Otomatik</strong><small>Ölçülerine ve hedefine göre hesaplanır</small></span></label>
        <label class="en-choice"><input type="radio" name="target_mode" value="manual" ${p.target_mode === 'manual' ? 'checked' : ''}><span><strong>Manuel</strong><small>Kendin ya da uzmanınla belirlediğin değer</small></span></label>
      </fieldset>
      ${field('manual_kcal', 'Manuel hedef (kcal)', p.manual_kcal, p.target_mode === 'manual' ? resolveTarget(p).error : '', `inputmode="numeric" autocomplete="off" ${p.target_mode === 'manual' ? '' : 'disabled'}`)}
      <div class="toolbar"><button class="btn primary" type="submit" ${status.saving ? 'disabled' : ''}>${status.server === false ? 'Bu oturumda kullan' : 'Kaydet'}</button></div>
    </form>
    <div id="energy-result" class="en-result" aria-live="polite">${resultView(p, { showErrors: status.showErrors })}</div>
    </div>
    <p class="muted small">Hesaplama; büyüme dönemi, hamilelik/emzirme, sporcu düzeyinde kas kütlesi ve enerji dengesini etkileyen hastalıklarda geçerli değildir. Hedefini belirlemeden önce gerekiyorsa doktoruna veya diyetisyenine danış.</p>
  </section>`;
}
// Reads the form into a profile (unchecked boxes and disabled inputs are handled explicitly).
function readForm(form, current) {
  const get = n => form.querySelector(`[name="${n}"]`);
  const checked = n => form.querySelector(`[name="${n}"]:checked`)?.value;
  return applyEdit(current, {
    age: get('age')?.value ?? '', height_cm: get('height_cm')?.value ?? '', weight_kg: get('weight_kg')?.value ?? '',
    sex: checked('sex') || '', activity: checked('activity') || current?.activity, goal: checked('goal') || current?.goal,
    pregnancy: !!get('pregnancy')?.checked, medical: !!get('medical')?.checked,
    target_mode: checked('target_mode') || 'auto',
    // Keep the manual value even while "otomatik" is selected, so switching back restores it.
    manual_kcal: get('manual_kcal') ? get('manual_kcal').value : current?.manual_kcal
  });
}

const api = { ACTIVITY, GOALS, SEX, LIMITS, DEFAULT_PROFILE, ENDPOINT, normalizeProfile, assess, estimate, mifflin, resolveTarget, applyEdit, createStore, view, resultView, statusView, readForm, isMissing };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.FormClubEnergy = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
