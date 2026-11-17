/* FORM CLUB V8 — nutrition diary, food search, calorie analytics, BMI and energy estimate.
   Diary and catalogue use the V6 endpoints (/api/v6/foods, /api/v6/food-logs) so admins keep member diaries.
   Food search also calls the V8 backend (/api/v8/foods/search, Open Food Facts); a chosen product is stored in
   the V6 catalogue with its per-100 g label values before logging. No sample food values are shipped. */
(() => {
'use strict';
const C = window.V8Calc;
const root = document.getElementById('v8-root');
const today = () => C.localISO(new Date());
let current = { user:null, role:'', state:null, foods:[], logs:[], memberId:null, view:'diary', day:today(), week:C.weekStart(today()), month:C.monthStart(today()), query:'', selected:null, mode:'gram', portion:{}, remote:{ q:'', loading:false, error:'', products:[], attribution:'' }, profile:{ sex:'', age:'', height:'', weight:'', activity:'' }, error:'' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const int = v => Math.round(Number(v || 0)).toLocaleString('tr-TR');
const dec = v => Number(v || 0).toLocaleString('tr-TR', { maximumFractionDigits:1 });
const dateLabel = (v, opts = { day:'numeric', month:'short' }) => { const d = C.parseISO(v); return d ? d.toLocaleDateString('tr-TR', opts) : '—'; };
const kpi = (label, value, foot) => `<article class="card kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="foot">${esc(foot)}</div></article>`;
const empty = text => `<div class="empty">${esc(text)}</div>`;
async function api(path, options = {}) {
  const init = { credentials:'same-origin', headers:{ 'Accept':'application/json' }, ...options };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  const response = await fetch(path, init);
  let json; try { json = await response.json(); } catch { throw Error(`API yanıtı okunamadı (${response.status})`); }
  if (!response.ok) throw Error(json.error || `Sunucu hatası (${response.status})`);
  return json;
}
const canLog = () => current.role === 'member' || current.role === 'admin';
const members = () => Array.isArray(current.state?.members) ? current.state.members : [];

async function init() {
  try {
    const me = await api('/api/me');
    const user = me?.user;
    if (!user || !user.role) return renderError('Oturum bulunamadı. Önce ana uygulamada giriş yapmalısın.');
    current.user = user; current.role = user.role;
    current.state = await api('/api/state');
    current.foods = await api('/api/v6/foods');
    if (current.role === 'member') current.memberId = user.member_id;
    if (current.role === 'admin' && !current.memberId) current.memberId = members()[0]?.id ?? null;
    if (current.role === 'teacher') current.view = 'health';
    await loadLogs();
    prefillWeight();
    render();
  } catch (e) { renderError(e.message); }
}
async function loadLogs() {
  if (!canLog() || !current.memberId) { current.logs = []; return; }
  const q = current.role === 'admin' ? `?member_id=${encodeURIComponent(current.memberId)}` : '';
  current.logs = await api('/api/v6/food-logs' + q);
}
// Latest real body measurement only; nothing is filled in when there is none.
function prefillWeight() {
  const list = (current.state?.measurements || []).filter(m => m.weight != null && (current.role !== 'admin' || m.member_id === current.memberId));
  const last = list.slice().sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at))).at(-1);
  current.profile.weight = last ? String(last.weight) : '';
  current.profile.weightSource = last ? String(last.measured_at).slice(0, 10) : '';
}
function renderError(message) { root.innerHTML = `<main class="main"><div class="brand">FORM <strong>CLUB</strong></div><div class="error"><h2>V8 açılmadı</h2><p>${esc(message)}</p><a href="/">Önce ana uygulamada giriş yap</a></div></main>`; }
function toast(message) { current.error = message; render(); }

const pages = () => canLog() ? [['diary','Günlük'],['add','Besin seç'],['stats','Kalori analizi'],['health','VKİ ve enerji']] : [['health','VKİ ve enerji']];
const titles = { diary:'Beslenme günlüğü', add:'Besin ve ürün seç', stats:'Kalori analizi', health:'VKİ ve enerji ihtiyacı' };
function render() {
  const links = pages();
  if (!links.some(x => x[0] === current.view)) current.view = links[0][0];
  const focus = document.activeElement?.id, caret = document.activeElement?.selectionStart;
  root.innerHTML = `<div class="shell"><aside class="side"><div class="brand">FORM <strong>CLUB</strong><span style="font-size:10px;vertical-align:top;margin-left:6px;color:#829879">V8</span></div><div class="tag">BESLENME · SAĞLIK</div><nav class="nav" aria-label="V8 sayfaları">${links.map(([id, name]) => `<a href="#${id}" class="navlink ${current.view === id ? 'active' : ''}" data-view="${id}" ${current.view === id ? 'aria-current="page"' : ''}>${esc(name)}</a>`).join('')}<a href="/v7.html" class="navlink">V7 panel</a></nav><div class="side-bottom">● V6 beslenme API'si<br>Besin değerleri salon kataloğu ve Open Food Facts'ten<br>Hesap: ${esc(current.user.username || current.role)}</div></aside><main class="main"><header class="head"><div><div class="eyebrow">FITNESS · BESLENME · SAĞLIK</div><h1>${esc(titles[current.view])}</h1><div class="subtitle">${new Date().toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</div></div><div class="actions">${memberPicker()}<a href="/" class="btn">← Ana uygulama</a><button class="btn primary" id="reload">↻ Yenile</button></div></header>${current.error ? `<div class="notice" role="alert">${esc(current.error)}</div>` : ''}${body()}</main></div>`;
  current.error = '';
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (caret != null && el.setSelectionRange) try { el.setSelectionRange(caret, caret); } catch {} } }
}
function memberPicker() {
  if (current.role !== 'admin') return '';
  return `<label class="screen-reader" for="memberpick">Üye seç</label><select class="range" id="memberpick">${members().map(m => `<option value="${m.id}" ${m.id === current.memberId ? 'selected' : ''}>${esc(m.name)}</option>`).join('') || '<option>Üye yok</option>'}</select>`;
}
function body() {
  if (current.view === 'add') return addView();
  if (current.view === 'stats') return statsView();
  if (current.view === 'health') return healthView();
  return diaryView();
}
const energy = () => C.tdee({ ...current.profile, age:Number(current.profile.age), height:Number(current.profile.height), weight:Number(current.profile.weight) });

/* ---------- Günlük ---------- */
function diaryView() {
  const day = current.day, rows = current.logs.filter(l => l.consumed_on === day);
  const t = C.dailyTotals(rows).get(day) || { kcal:0, protein:0, carbs:0, fat:0, count:0 };
  const e = energy();
  const pctOf = e ? Math.round(t.kcal / e.tdee * 100) : null;
  return `<section class="card section"><div class="cardtop"><h2>${esc(dateLabel(day, { weekday:'long', day:'numeric', month:'long' }))}</h2><div class="daynav"><button class="btn small" data-day="-1" aria-label="Önceki gün">←</button><label class="screen-reader" for="daypick">Tarih</label><input type="date" id="daypick" value="${day}" max="${today()}"><button class="btn small" data-day="1" aria-label="Sonraki gün" ${day >= today() ? 'disabled' : ''}>→</button><button class="btn small" data-day="today">Bugün</button></div></div>
  <div class="calc-out"><div class="hero"><b>${int(t.kcal)}</b><span>kcal</span></div><div><b>${dec(t.protein)}</b><span>protein (g)</span></div><div><b>${dec(t.carbs)}</b><span>karbonhidrat (g)</span></div><div><b>${dec(t.fat)}</b><span>yağ (g)</span></div></div>
  ${e ? `<div class="progress ${pctOf > 100 ? 'over' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, pctOf)}" aria-label="Tahmini enerji ihtiyacına oran"><i style="width:${Math.min(100, pctOf)}%"></i></div><p class="footnote">Tahmini günlük ihtiyacın ${int(e.tdee)} kcal · bugüne kadar %${pctOf} · ${t.kcal <= e.tdee ? `${int(e.tdee - t.kcal)} kcal kaldı` : `${int(t.kcal - e.tdee)} kcal üzerinde`}</p>` : `<p class="footnote">Günlük hedefi görmek için <a href="#health" data-view="health">VKİ ve enerji</a> sayfasında bilgilerini gir.</p>`}
  </section><section class="card"><div class="cardtop"><h2>Kayıtlar (${rows.length})</h2><button class="btn primary" data-view="add">+ Besin ekle</button></div>${rows.length ? rows.map(l => { const nu = C.nutrientsFor(l, l.grams); return `<div class="log-row"><div><b>${esc(l.name)}</b><div class="muted">${dec(l.grams)} g · P ${dec(nu.protein)} · K ${dec(nu.carbs)} · Y ${dec(nu.fat)}</div></div><span class="kcal">${int(nu.kcal)} kcal</span><button class="btn small ghost" data-del="${l.id}" aria-label="${esc(l.name)} kaydını sil">Sil</button></div>`; }).join('') : empty('Bu gün için beslenme kaydı yok.')}</section>`;
}

/* ---------- Besin seç ---------- */
function addView() {
  return `<div class="grid two add-grid"><section class="card"><div class="cardtop"><h2>Besin ara</h2><span class="pill">${int(current.foods.length)} katalog ürünü</span></div><form class="search" id="searchform" role="search"><label class="screen-reader" for="foodsearch">Besin ara</label><input id="foodsearch" type="search" enterkeyhint="search" autocomplete="off" placeholder="Besin veya ürün ara…" value="${esc(current.query)}"></form><div class="food-list" id="foodresults">${foodResults()}</div></section><section class="card" id="portionpanel">${current.selected ? portionPanel() : `<h2>Porsiyon hesapla</h2>${empty('Kalori hesaplamak için bir ürün seç.')}`}</section></div>${newFoodForm()}`;
}
const foodButton = (attr, f, pressed, badge) => `<button type="button" class="food-item" ${attr} aria-pressed="${pressed}"><span><b>${esc(f.name)}</b>${badge ? `<span class="src">${esc(badge)}</span>` : ''}<span class="macro">100 g · P ${dec(f.protein_100g)} · K ${dec(f.carbs_100g)} · Y ${dec(f.fat_100g)}</span></span><span class="kcal">${dec(f.kcal_100g)} kcal</span></button>`;
function foodResults() {
  const q = current.query.trim(), local = C.searchFoods(current.foods, q).slice(0, 100), sel = current.selected;
  const localHtml = local.length
    ? local.map(f => foodButton(`data-food="${f.id}"`, f, !!sel && !sel.remote && sel.id === f.id)).join('')
    : empty(current.foods.length ? `Katalogda "${q}" için sonuç yok.` : 'Katalogda henüz ürün yok.');
  const r = current.remote;
  let remoteHtml;
  if (q.length < 2) remoteHtml = empty('Open Food Facts veritabanında aramak için en az 2 karakter yaz.');
  else if (q.length > 100) remoteHtml = empty('Arama en fazla 100 karakter olabilir.');
  else if (r.loading || r.q !== q) remoteHtml = `<div class="empty" role="status">"${esc(q)}" aranıyor…</div>`;
  else if (r.error) remoteHtml = `<div class="empty error-box" role="alert">${esc(r.error)} <button type="button" class="btn small" data-retry>Tekrar dene</button></div>`;
  else if (!r.products.length) remoteHtml = empty(`"${q}" için 100 g besin değeri olan ürün bulunamadı.`);
  else remoteHtml = r.products.map(p => foodButton(`data-remote="${esc(p.source_id)}"`, p, !!sel && sel.remote && sel.source_id === p.source_id, 'Open Food Facts')).join('') + `<p class="footnote">${esc(r.attribution || 'Open Food Facts — ODbL-1.0')}</p>`;
  return `<h3 class="list-head">Salon kataloğu</h3>${localHtml}<h3 class="list-head">Open Food Facts</h3>${remoteHtml}`;
}
function currentGrams() {
  const p = current.portion || {};
  return current.mode === 'gram' ? (Number(p.grams) > 0 ? Number(p.grams) : null) : C.gramsFromPortion(p.count, p.size);
}
function calcOut() {
  const nu = C.nutrientsFor(current.selected, currentGrams());
  if (!nu) return `<div class="calc-out" id="calcout"><div class="hero"><b>—</b><span>kcal</span></div><div><b>—</b><span>protein (g)</span></div><div><b>—</b><span>karbonhidrat (g)</span></div><div><b>—</b><span>yağ (g)</span></div></div>`;
  return `<div class="calc-out" id="calcout" aria-live="polite"><div class="hero"><b>${int(nu.kcal)}</b><span>kcal · ${dec(nu.grams)} g</span></div><div><b>${dec(nu.protein)}</b><span>protein (g)</span></div><div><b>${dec(nu.carbs)}</b><span>karbonhidrat (g)</span></div><div><b>${dec(nu.fat)}</b><span>yağ (g)</span></div></div>`;
}
function portionPanel() {
  const f = current.selected, p = current.portion || {};
  const source = f.remote ? `<p class="footnote">Kaynak: <a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">Open Food Facts</a> (${esc(f.source_license || 'ODbL-1.0')}). Eklediğinde bu değerlerle salon kataloğuna kaydedilir.</p>` : '';
  return `<h2>${esc(f.name)}</h2><p class="footnote">100 g: ${dec(f.kcal_100g)} kcal · protein ${dec(f.protein_100g)} g · karbonhidrat ${dec(f.carbs_100g)} g · yağ ${dec(f.fat_100g)} g</p>${source}<div class="seg" role="group" aria-label="Miktar türü"><button type="button" data-mode="gram" aria-pressed="${current.mode === 'gram'}">Gram</button><button type="button" data-mode="portion" aria-pressed="${current.mode === 'portion'}">Porsiyon</button></div>
  ${current.mode === 'gram'
    ? `<div class="form-row"><label class="field">Miktar (g)<input id="p-grams" type="number" inputmode="decimal" min="0.1" max="5000" step="0.1" value="${esc(p.grams ?? '')}"></label></div>`
    : `<div class="form-row"><label class="field">Porsiyon sayısı<input id="p-count" type="number" inputmode="decimal" min="0.25" max="50" step="0.25" value="${esc(p.count ?? '')}"></label><label class="field">1 porsiyon (g)<input id="p-size" type="number" inputmode="decimal" min="1" max="5000" step="0.1" value="${esc(p.size ?? '')}"><small>Ambalajdaki porsiyon gramajı</small></label></div>`}
  ${calcOut()}<div class="form-row"><label class="field">Tarih<input id="p-date" type="date" value="${esc(current.day)}" max="${today()}"></label></div><button class="btn primary" id="addlog" ${current.role === 'admin' && !current.memberId ? 'disabled' : ''}>Günlüğe ekle</button><p class="footnote">Kalori = gram × (100 g değeri ÷ 100). Sunucuya yalnızca gram kaydedilir.</p>`;
}
function newFoodForm() {
  return `<section class="card section" style="margin-top:18px"><details><summary><b>Katalogda olmayan ürün ekle</b></summary><p class="footnote">Değerleri ürün ambalajındaki besin değerleri tablosundan, 100 g için gir. Tahmini değer girme.</p><form id="foodform"><div class="form-row"><label class="field">Ürün adı<input name="name" required minlength="2" maxlength="100"></label><label class="field">Enerji (kcal/100 g)<input name="kcal_100g" type="number" min="0" max="1000" step="0.1" required></label><label class="field">Protein (g)<input name="protein_100g" type="number" min="0" max="100" step="0.1" required></label><label class="field">Karbonhidrat (g)<input name="carbs_100g" type="number" min="0" max="100" step="0.1" required></label><label class="field">Yağ (g)<input name="fat_100g" type="number" min="0" max="100" step="0.1" required></label></div><button class="btn primary">Ürünü kataloğa ekle</button></form></details></section>`;
}

/* ---------- Kalori analizi ---------- */
function bars(series, label, dense) {
  if (!series.some(x => x.hasData)) return empty(`${label} için kayıt yok.`);
  const max = Math.max(1, ...series.map(x => x.kcal));
  return `<div class="chart" role="img" aria-label="${esc(label)} günlük kalori sütun grafiği"><div class="bars ${dense ? 'dense' : ''}">${series.map(x => { const h = x.kcal ? Math.max(4, Math.round(x.kcal / max * 172)) : 2; const d = C.parseISO(x.date); return `<div class="barcol ${x.hasData ? '' : 'nodata'}" title="${esc(dateLabel(x.date, { weekday:'short', day:'numeric', month:'short' }))}: ${x.hasData ? int(x.kcal) + ' kcal' : 'kayıt yok'}"><span class="barv">${x.hasData ? int(x.kcal) : ''}</span><div class="bar" style="height:${h}px"></div><small>${dense ? d.getDate() : esc(d.toLocaleDateString('tr-TR', { weekday:'short' }))}</small></div>`; }).join('')}</div></div>`;
}
function dataTable(series, e) {
  const rows = series.filter(x => x.hasData);
  return `<details class="datatable"><summary>Tablo görünümü</summary><div class="tablewrap"><table><thead><tr><th>Tarih</th><th>Kalori</th>${e ? '<th>İhtiyaca göre fark</th>' : ''}</tr></thead><tbody>${rows.map(x => `<tr><td>${esc(dateLabel(x.date, { weekday:'short', day:'numeric', month:'short' }))}</td><td>${int(x.kcal)} kcal</td>${e ? `<td>${x.kcal - e.tdee > 0 ? '+' : ''}${int(x.kcal - e.tdee)} kcal</td>` : ''}</tr>`).join('') || `<tr><td colspan="3">Kayıt yok</td></tr>`}</tbody></table></div></details>`;
}
function statsView() {
  const t = today(), e = energy();
  const todayKcal = C.dailyTotals(current.logs).get(t)?.kcal || 0;
  const dAvg = C.dailyAverage(current.logs, t, 7), wAvg = C.weeklyAverage(current.logs, t, 4);
  const logged30 = C.daySeries(current.logs, C.addDays(t, -29), 30).filter(x => x.hasData).length;
  const week = C.daySeries(current.logs, current.week, 7);
  const month = C.daySeries(current.logs, current.month, C.daysInMonth(current.month));
  const weekEnd = C.addDays(current.week, 6), monthName = dateLabel(current.month, { month:'long', year:'numeric' });
  const wSum = week.reduce((s, x) => s + x.kcal, 0), mDays = month.filter(x => x.hasData);
  return `<div class="grid kpis section">${kpi('Bugün', `${int(todayKcal)} kcal`, e ? `İhtiyacın ${int(e.tdee)} kcal` : 'Kaydedilen enerji')}${kpi('Günlük ortalama', dAvg.value == null ? 'Veri yok' : `${int(dAvg.value)} kcal`, `Son 7 gün · ${dAvg.days} kayıtlı gün`)}${kpi('Haftalık ortalama', wAvg.value == null ? 'Veri yok' : `${int(wAvg.value)} kcal`, `Son 4 hafta · ${wAvg.weeks} kayıtlı hafta`)}${kpi('Kayıtlı gün', `${logged30} / 30`, 'Son 30 gün')}</div>
  <div class="grid two section"><section class="card"><div class="cardtop"><div><h2>Haftalık kalori</h2><div class="muted">${esc(dateLabel(current.week))} – ${esc(dateLabel(weekEnd))} · toplam ${int(wSum)} kcal</div></div><div class="actions"><button class="btn small" data-week="-1" aria-label="Önceki hafta">←</button><button class="btn small" data-week="0">Bu hafta</button><button class="btn small" data-week="1" aria-label="Sonraki hafta" ${weekEnd >= t ? 'disabled' : ''}>→</button></div></div>${bars(week, 'Bu hafta', false)}${dataTable(week, e)}</section>
  <section class="card"><div class="cardtop"><div><h2>Aylık kalori</h2><div class="muted">${esc(monthName)} · ${mDays.length} kayıtlı gün${mDays.length ? ` · ort. ${int(mDays.reduce((s, x) => s + x.kcal, 0) / mDays.length)} kcal/gün` : ''}</div></div><div class="actions"><button class="btn small" data-month="-1" aria-label="Önceki ay">←</button><button class="btn small" data-month="0">Bu ay</button><button class="btn small" data-month="1" aria-label="Sonraki ay" ${C.shiftMonth(current.month, 1) > t ? 'disabled' : ''}>→</button></div></div>${bars(month, monthName, true)}${dataTable(month, e)}</section></div>
  <p class="footnote">Ortalamalar yalnızca kayıt girilen günler üzerinden hesaplanır; kayıt olmayan günler 0 sayılmaz ve tahmin edilmez. Sunucu üye başına en son 250 kaydı döndürür; daha eski aylar eksik görünebilir.</p>`;
}

/* ---------- VKİ ve enerji ---------- */
function healthView() {
  const p = current.profile, b = C.bmi(p.weight, p.height), cat = C.bmiCategory(b), e = energy();
  const pos = b == null ? 0 : Math.min(100, Math.max(0, (b - 15) / 25 * 100));
  const tick = v => `<span style="left:${(v - 15) / 25 * 100}%">${v}</span>`;
  return `<div class="grid two"><section class="card"><h2>Bilgilerin</h2><form id="healthform" novalidate><div class="form-row"><label class="field">Cinsiyet<select name="sex"><option value="">Seç</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Kadın</option><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Erkek</option></select></label><label class="field">Yaş<input name="age" type="number" inputmode="numeric" min="18" max="100" value="${esc(p.age)}"></label></div><div class="form-row"><label class="field">Boy (cm)<input name="height" type="number" inputmode="decimal" min="100" max="250" step="0.1" value="${esc(p.height)}"></label><label class="field">Kilo (kg)<input name="weight" type="number" inputmode="decimal" min="20" max="350" step="0.1" value="${esc(p.weight)}">${p.weightSource ? `<small>Son ölçümden: ${esc(dateLabel(p.weightSource, { day:'numeric', month:'short', year:'numeric' }))}</small>` : ''}</label></div><label class="field">Aktivite düzeyi<select name="activity"><option value="">Seç</option>${C.ACTIVITY.map(a => `<option value="${a.key}" ${p.activity === a.key ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label></form><p class="footnote">Bilgiler yalnızca bu sayfada hesaplama için kullanılır; sunucuya veya tarayıcıya kaydedilmez.</p></section>
  <section class="card" id="healthout">${healthOut(b, cat, e, pos, tick)}</section></div>`;
}
function healthOut(b, cat, e, pos, tick) {
  const p = current.profile;
  const bmiBlock = b == null ? `<h2>Vücut kitle indeksi</h2>${empty('VKİ için boy (100-250 cm) ve kilo (20-350 kg) gir.')}` : `<h2>Vücut kitle indeksi</h2><div class="big">${dec(b)}</div><span class="status ${cat.key === 'normal' ? '' : cat.key === 'under' ? 'info' : 'warn'}">${cat.key === 'normal' ? '✓' : '!'} ${esc(cat.label)}</span><div class="bmi-scale" aria-hidden="true"><i style="left:${pos}%"></i></div><div class="bmi-ticks" aria-hidden="true">${[18.5, 25, 30, 35].map(tick).join('')}</div><p class="footnote">Dünya Sağlık Örgütü yetişkin sınıflaması: &lt;18,5 zayıf · 18,5–24,9 normal · 25–29,9 fazla kilolu · ≥30 obez. VKİ kas kütlesini ayırt etmez.</p>`;
  const missing = [!p.sex && 'cinsiyet', !(Number(p.age) >= 18 && Number(p.age) <= 100) && 'yaş (18-100)', !(Number(p.height) >= 100) && 'boy', !(Number(p.weight) >= 20) && 'kilo', !p.activity && 'aktivite'].filter(Boolean);
  const energyBlock = e ? `<h2 style="margin-top:26px">Tahmini günlük enerji ihtiyacı</h2><div class="big">${int(e.tdee)} <span style="font-size:18px">kcal</span></div><div class="member-row"><span>Bazal metabolizma (BMR)</span><b>${int(e.bmr)} kcal</b></div><div class="member-row"><span>Aktivite katsayısı</span><b>× ${String(e.factor).replace('.', ',')}</b></div><p class="footnote">Mifflin-St Jeor denklemiyle hesaplanan tahmindir; tıbbi tavsiye değildir. Hamilelik, emzirme veya sağlık sorunu varsa diyetisyene danış.</p>` : `<h2 style="margin-top:26px">Tahmini günlük enerji ihtiyacı</h2>${empty('Eksik: ' + missing.join(', '))}`;
  return bmiBlock + energyBlock;
}
function updateHealth() {
  const p = current.profile, b = C.bmi(p.weight, p.height), cat = C.bmiCategory(b), e = energy();
  const pos = b == null ? 0 : Math.min(100, Math.max(0, (b - 15) / 25 * 100));
  const el = document.getElementById('healthout');
  if (el) el.innerHTML = healthOut(b, cat, e, pos, v => `<span style="left:${(v - 15) / 25 * 100}%">${v}</span>`);
}

/* ---------- Events ---------- */
// Open Food Facts products have no V6 id yet: reuse a matching catalogue row or create one with the label values.
async function catalogId(food) {
  if (!food.remote) return food.id;
  const existing = C.findCatalogMatch(current.foods, food);
  if (existing) return existing.id;
  const r = await api('/api/v6/foods', { method:'POST', body:{ name:C.catalogName(food), kcal_100g:food.kcal_100g, protein_100g:food.protein_100g, carbs_100g:food.carbs_100g, fat_100g:food.fat_100g } });
  current.foods = await api('/api/v6/foods');
  return r.id;
}
let searchTimer = 0, searchSeq = 0;
async function remoteSearch(q) {
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  current.remote = { q, loading:true, error:'', products:[], attribution:'' };
  refreshResults();
  try {
    const r = await api('/api/v8/foods/search?q=' + encodeURIComponent(q));
    if (seq !== searchSeq) return;
    current.remote = { q, loading:false, error:'', products:(Array.isArray(r.products) ? r.products : []).map(p => ({ ...p, remote:true })), attribution:r.attribution || '' };
  } catch (e) {
    if (seq !== searchSeq) return;
    current.remote = { q, loading:false, error:e instanceof TypeError ? 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.' : e.message, products:[], attribution:'' };
  }
  refreshResults();
}
function scheduleSearch() {
  clearTimeout(searchTimer);
  const q = current.query.trim();
  if (q.length < 2 || q.length > 100) { searchSeq++; current.remote = { q:'', loading:false, error:'', products:[], attribution:'' }; return refreshResults(); }
  if (q === current.remote.q && !current.remote.error) return refreshResults();
  refreshResults();
  searchTimer = setTimeout(() => remoteSearch(q), 450);
}
function refreshResults() { const box = document.getElementById('foodresults'); if (box) box.innerHTML = foodResults(); }
function selectFood(food) {
  current.selected = food; current.portion = { grams:'100', count:'1', size:'' };
  render();
  if (window.matchMedia('(max-width:1080px)').matches) document.getElementById('portionpanel')?.scrollIntoView({ behavior:'smooth', block:'start' });
}
async function addLog() {
  const grams = currentGrams(), date = document.getElementById('p-date')?.value;
  if (!grams || grams > 5000) return toast('Geçerli bir miktar gir (en fazla 5000 g).');
  if (!date) return toast('Tarih seç.');
  const btn = document.getElementById('addlog'); if (btn) btn.disabled = true;
  try {
    const body = { product_id:await catalogId(current.selected), grams, consumed_on:date };
    if (current.role === 'admin') body.member_id = current.memberId;
    await api('/api/v6/food-logs', { method:'POST', body });
    await loadLogs();
    current.day = date; current.view = 'diary'; current.portion = {};
    render();
  } catch (e) { toast(e.message); }
  finally { const b = document.getElementById('addlog'); if (b) b.disabled = false; }
}
root.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-view],[data-day],[data-week],[data-month],[data-food],[data-remote],[data-retry],[data-mode],[data-del],#reload,#addlog');
  if (!t || t.disabled) return;
  if (t.dataset.view) { ev.preventDefault(); current.view = t.dataset.view; return render(); }
  if (t.dataset.day) { current.day = t.dataset.day === 'today' ? today() : C.addDays(current.day, Number(t.dataset.day)); if (current.day > today()) current.day = today(); return render(); }
  if (t.dataset.week) { current.week = t.dataset.week === '0' ? C.weekStart(today()) : C.addDays(current.week, 7 * Number(t.dataset.week)); return render(); }
  if (t.dataset.month) { current.month = t.dataset.month === '0' ? C.monthStart(today()) : C.shiftMonth(current.month, Number(t.dataset.month)); return render(); }
  if (t.dataset.food) return selectFood(current.foods.find(f => String(f.id) === t.dataset.food) || null);
  if (t.dataset.remote) return selectFood(current.remote.products.find(p => p.source_id === t.dataset.remote) || null);
  if (t.hasAttribute('data-retry')) return remoteSearch(current.query.trim());
  if (t.dataset.mode) { current.mode = t.dataset.mode; return render(); }
  if (t.dataset.del) {
    if (!confirm('Bu beslenme kaydı silinsin mi?')) return;
    try { await api('/api/v6/food-logs/' + Number(t.dataset.del), { method:'DELETE' }); await loadLogs(); render(); } catch (e) { toast(e.message); }
    return;
  }
  if (t.id === 'reload') { root.innerHTML = '<div class="loading">Yenileniyor…</div>'; return init(); }
  if (t.id === 'addlog') return addLog();
});
root.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'foodsearch') { current.query = t.value; return scheduleSearch(); }
  if (['p-grams', 'p-count', 'p-size'].includes(t.id)) { current.portion = { ...current.portion, [t.id.slice(2)]:t.value }; const out = document.getElementById('calcout'); if (out) out.outerHTML = calcOut(); return; }
  if (t.form?.id === 'healthform') { current.profile[t.name] = t.value; if (t.name === 'weight') current.profile.weightSource = ''; updateHealth(); }
});
root.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id === 'daypick' && t.value) { current.day = t.value > today() ? today() : t.value; return render(); }
  if (t.form?.id === 'healthform' && t.tagName === 'SELECT') { current.profile[t.name] = t.value; return updateHealth(); }
  if (t.id === 'memberpick') { current.memberId = Number(t.value); try { await loadLogs(); prefillWeight(); render(); } catch (e) { toast(e.message); } }
});
root.addEventListener('submit', async ev => {
  if (ev.target.id === 'searchform') {
    ev.preventDefault();
    const q = current.query.trim();
    if (q.length >= 2 && q.length <= 100) remoteSearch(q);
    document.getElementById('foodsearch')?.blur();
    return;
  }
  if (ev.target.id !== 'foodform') return;
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(ev.target));
  try {
    const r = await api('/api/v6/foods', { method:'POST', body:{ name:d.name, kcal_100g:Number(d.kcal_100g), protein_100g:Number(d.protein_100g), carbs_100g:Number(d.carbs_100g), fat_100g:Number(d.fat_100g) } });
    current.foods = await api('/api/v6/foods');
    current.query = ''; current.remote = { q:'', loading:false, error:'', products:[], attribution:'' };
    selectFood(current.foods.find(f => f.id === r.id) || null);
  } catch (e) { toast(e.message); }
});
init();
})();
