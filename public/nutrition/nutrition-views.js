/* FORM CLUB Nutrition+ views. Pure functions: state in, HTML string out (no DOM, no network).
   Every dynamic value passes through esc(). No inline scripts, no on* attributes: the controller
   (nutrition.js) binds behaviour through data-act / data-* attributes and event delegation. */
(function (global) {
'use strict';
const Core = typeof module === 'object' && module.exports ? require('./nutrition-core.js') : global.NutritionCore;
const { esc, fmt, MEALS } = Core;

const ICONS = {
  today: '<path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/>',
  trends: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  body: '<circle cx="12" cy="5" r="2.5"/><path d="M6 9h12M12 9v5m0 0-3 7m3-7 3 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/><path d="m3 3 18 18"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 4 2.5 20h19Z"/><path d="M12 10v4M12 17v.5"/>'
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
const TABS = [['today', 'Bugün'], ['search', 'Besin ara'], ['scan', 'Barkod'], ['trends', 'Grafikler'], ['body', 'Vücut']];
const MEAL_LABEL = Object.fromEntries(MEALS.map(m => [m.id, m.label]));
MEAL_LABEL.unassigned = 'Öğünü belirtilmemiş';

/* ---------- Shared blocks ---------- */
function stateBlock(kind, { title, text, action, actionLabel, href } = {}) {
  const defaults = {
    loading: ['Yükleniyor…', ''],
    empty: ['Henüz kayıt yok', ''],
    error: ['Bir sorun oluştu', ''],
    offline: ['Bağlantı yok', 'İnternet bağlantın gelince otomatik yeniden denenir.'],
    unsupported: ['Sunucu desteği bekleniyor', 'Bu bölüm Nutrition+ API’si yayımlandığında açılacak. Şimdilik veri kaydedilmez.'],
    session: ['Oturum süren doldu', 'Kişisel beslenme verilerin için yeniden giriş yapman gerekiyor.']
  }[kind] || ['', ''];
  const role = kind === 'error' || kind === 'session' ? 'alert' : 'status';
  const btn = href ? `<a class="btn primary" href="${esc(href)}" target="_top">${esc(actionLabel)}</a>`
    : action ? `<button class="btn ${kind === 'empty' ? 'primary' : ''}" type="button" data-act="${esc(action)}">${esc(actionLabel || 'Tekrar dene')}</button>` : '';
  const ico = { error: 'alert', offline: 'wifi', session: 'lock', unsupported: 'lock' }[kind];
  return `<div class="state state-${esc(kind)}" role="${role}" ${kind === 'loading' ? 'aria-busy="true"' : ''}>
    ${kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : ico ? icon(ico, 'state-ic') : ''}
    <p class="state-title">${esc(title || defaults[0])}</p>${(text || defaults[1]) ? `<p class="state-text">${esc(text || defaults[1])}</p>` : ''}${btn}</div>`;
}
function errorState(err, retry) {
  const kind = Core.errorKind(err);
  if (kind === 'offline') return stateBlock('offline', { action: retry, actionLabel: 'Tekrar dene' });
  if (kind === 'unsupported') return stateBlock('unsupported');
  return stateBlock('error', { text: Core.errorText(err), action: retry, actionLabel: 'Tekrar dene' });
}
function skeleton(rows = 3) {
  return `<div class="skeleton" role="status" aria-busy="true"><span class="sr">Yükleniyor…</span>${'<div class="sk-row"></div>'.repeat(rows)}</div>`;
}
function sourceBadge(source) {
  return `<span class="src src-${esc(source.kind)}" title="${esc(source.detail || source.label)}">${esc(source.label)}</span>`;
}
function bar(label, value, goal, unit, cls) {
  const p = Core.progress(value, goal);
  const now = Core.round(value || 0, 0);
  const text = p.hasGoal ? `${fmt(now, '', 0)} / ${fmt(goal, unit, 0)}` : fmt(now, unit, 0);
  return `<div class="macro ${cls}">
    <div class="macro-head"><span>${esc(label)}</span><span class="num">${esc(text)}</span></div>
    <div class="track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${p.hasGoal ? esc(goal) : 100}" aria-valuenow="${esc(now)}" aria-valuetext="${esc(text)}">
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="fill ${p.over ? 'over' : ''}" x="0" y="0" height="8" rx="4" width="${p.hasGoal ? p.pct : 0}"/></svg>
    </div></div>`;
}

/* ---------- Shell ---------- */
function shell(S, body) {
  const nav = TABS.map(([id, label]) => `<a class="tab" href="#${id}" data-route="${id}" ${S.route === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${esc(label)}</span></a>`).join('');
  return `<button class="skip" type="button" data-act="skip">İçeriğe geç</button>
  <div class="shell">
    <nav class="tabbar" aria-label="Nutrition+ menüsü"><div class="rail-brand" aria-hidden="true">FORM <strong>CLUB</strong><small>Nutrition+</small></div>${nav}</nav>
    <div class="page">
      <header class="topbar"><div class="brand">FORM <strong>CLUB</strong> <span class="plus">Nutrition+</span></div>${S.user ? `<span class="who">${esc(S.user.name)}</span>` : ''}</header>
      ${S.preview ? '<p class="banner banner-preview" role="note"><strong>ÖNİZLEME</strong> Örnek veri gösteriliyor. Bu kayıtlar gerçek değildir ve sunucuya gönderilmez.</p>' : ''}
      ${S.online ? '' : `<p class="banner banner-offline" role="status">${icon('wifi')} Çevrimdışısın. Kişisel veriler cihazda saklanmadığı için bağlantı gelince yenilenir.</p>`}
      <main id="main" class="main" tabindex="-1">${body}</main>
    </div>
  </div>
  ${S.sheet ? sheet(S) : ''}
  <div class="toast" role="status" aria-live="polite">${S.toast ? esc(S.toast) : ''}</div>`;
}
function sessionScreen(S) {
  return `<div class="shell solo"><main id="main" class="main" tabindex="-1">${stateBlock('session', { href: '/', actionLabel: 'Giriş yap' })}</main></div>`;
}

/* ---------- Today ---------- */
function today(S) {
  const D = S.day;
  const head = `<div class="day-nav">
    <button class="iconbtn" type="button" data-act="day-prev" aria-label="Önceki gün">${icon('left')}</button>
    <h1 class="day-title">${esc(Core.dayLabel(S.date, S.today))}</h1>
    <button class="iconbtn" type="button" data-act="day-next" aria-label="Sonraki gün" ${S.date >= S.today ? 'disabled' : ''}>${icon('right')}</button>
  </div>`;
  if (D.loading && !D.data) return head + skeleton(4);
  if (D.error && !D.data) return head + errorState(D.error, 'reload-day');
  const logs = D.data?.logs || [];
  const sum = Core.sumNutrients(logs.map(l => l.nutrients));
  const g = S.goals;
  const p = Core.progress(sum.totals.kcal, g?.kcal);
  const r = Core.ring(p.pct);
  const ringLabel = g ? `${fmt(sum.totals.kcal, 'kcal', 0)} tüketildi, hedef ${fmt(g.kcal, 'kcal', 0)}` : `${fmt(sum.totals.kcal, 'kcal', 0)} tüketildi, hedef belirlenmedi`;
  const summary = `<section class="card summary" aria-labelledby="sum-h">
    <h2 id="sum-h" class="sr">Günlük özet</h2>
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${esc(ringLabel)}">
        <circle class="ring-track" cx="60" cy="60" r="52"/>
        <circle class="ring-fill ${p.over ? 'over' : ''}" cx="60" cy="60" r="52" stroke-dasharray="${r.circumference}" stroke-dashoffset="${r.offset}" transform="rotate(-90 60 60)"/>
      </svg>
      <div class="ring-center" aria-hidden="true">
        ${g ? `<strong>${esc(fmt(Math.abs(p.remaining), '', 0))}</strong><span>${p.over ? 'kcal fazla' : 'kcal kaldı'}</span>` : `<strong>${esc(fmt(sum.totals.kcal, '', 0))}</strong><span>kcal</span>`}
      </div>
    </div>
    <div class="sum-side">
      <dl class="kv">
        <div><dt>Hedef</dt><dd>${g ? esc(fmt(g.kcal, 'kcal', 0)) : '<a href="#body" data-route="body">Belirle</a>'}</dd></div>
        <div><dt>Tüketilen</dt><dd>${esc(fmt(sum.totals.kcal, 'kcal', 0))}</dd></div>
      </dl>
      ${bar('Protein', sum.totals.protein, g?.protein, 'g', 'm-protein')}
      ${bar('Karbonhidrat', sum.totals.carbs, g?.carbs, 'g', 'm-carbs')}
      ${bar('Yağ', sum.totals.fat, g?.fat, 'g', 'm-fat')}
    </div>
    ${sum.partial && logs.length ? '<p class="note">Bazı ürünlerde değer bilinmiyor; toplamlar en az bu kadardır.</p>' : ''}
    ${D.error ? `<p class="note warn" role="alert">${esc(Core.errorText(D.error))}</p>` : ''}
  </section>`;
  const groups = Core.groupByMeal(logs, l => l.meal || S.mealTags[l.id]);
  const ids = [...Core.MEAL_IDS, ...(groups.unassigned.length ? ['unassigned'] : [])];
  const meals = ids.map(id => {
    const items = groups[id];
    const kcal = Core.sumNutrients(items.map(l => l.nutrients)).totals.kcal;
    const rows = items.map(l => `<li class="log">
      <div class="log-main"><span class="log-name">${esc(l.name)}</span><span class="log-meta">${esc(fmt(l.amount, l.unit, 0))} · ${sourceBadge(l.source)}</span></div>
      <span class="log-kcal">${esc(fmt(l.nutrients.kcal, 'kcal', 0))}</span>
      <button class="iconbtn danger" type="button" data-act="delete-log" data-id="${esc(l.id)}" aria-label="${esc(l.name)} kaydını sil">${icon('trash')}</button>
    </li>`).join('');
    return `<section class="card meal" aria-labelledby="meal-${id}">
      <div class="meal-head"><h2 id="meal-${id}">${esc(MEAL_LABEL[id])}</h2><span class="meal-kcal">${esc(fmt(kcal, 'kcal', 0))}</span>
      ${id === 'unassigned' ? '' : `<button class="btn small" type="button" data-act="add-to-meal" data-meal="${id}" aria-label="${esc(MEAL_LABEL[id])} öğününe besin ekle">${icon('plus')}Ekle</button>`}</div>
      ${rows ? `<ul class="logs">${rows}</ul>` : '<p class="muted small">Henüz eklenmedi.</p>'}
    </section>`;
  }).join('');
  const mealNote = !S.caps.meals && groups.unassigned.length ? '<p class="note">Öğün bilgisi sunucuda henüz saklanmıyor; bu cihazda bu oturumda eklediklerin öğünlerine yerleşir, diğerleri “Öğünü belirtilmemiş” altında görünür.</p>' : '';
  const empty = logs.length ? '' : stateBlock('empty', { title: 'Bu gün için kayıt yok', text: 'Besin arayarak veya barkod okutarak ilk öğününü ekle.', action: 'go-search', actionLabel: 'Besin ekle' });
  return head + `<div class="today-grid">${summary}<div class="meals">${empty}${meals}${mealNote}</div></div>`;
}

/* ---------- Search, recents, favorites, recipes ---------- */
function productCard(p, extra = '') {
  const v = p.per100;
  const missing = Core.missingKeys(p).filter(k => ['kcal', 'protein', 'carbs', 'fat'].includes(k));
  return `<li><button class="pcard" type="button" data-act="open-product" data-key="${esc(p.key)}">
    <span class="pc-main"><span class="pc-name">${esc(p.name)}</span>${p.brand ? `<span class="pc-brand">${esc(p.brand)}</span>` : ''}
      <span class="pc-macros">P ${esc(fmt(v.protein, 'g'))} · K ${esc(fmt(v.carbs, 'g'))} · Y ${esc(fmt(v.fat, 'g'))}</span>
      <span class="pc-tags">${sourceBadge(p.source)}${missing.length ? '<span class="tag warn">Eksik değer</span>' : ''}${p.barcode ? `<span class="tag mono">${esc(p.barcode)}</span>` : ''}${extra}</span></span>
    <span class="pc-kcal"><strong>${esc(fmt(v.kcal, '', 0))}</strong><small>kcal / 100 ${esc(p.basis)}</small></span>
  </button></li>`;
}
function productList(list, emptyText) {
  return list.length ? `<ul class="plist">${list.map(p => productCard(p)).join('')}</ul>` : `<p class="muted">${esc(emptyText)}</p>`;
}
function search(S) {
  const Q = S.search;
  const sub = [['results', 'Sonuçlar'], ['recents', 'Son kullanılan'], ['favorites', 'Favoriler'], ['recipes', 'Tariflerim']];
  const tabs = `<div class="seg" role="tablist" aria-label="Besin listeleri">${sub.map(([id, label]) => `<button type="button" role="tab" id="st-${id}" aria-controls="sp-${id}" aria-selected="${Q.tab === id}" tabindex="${Q.tab === id ? 0 : -1}" data-act="search-tab" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;
  const form = `<form class="searchbar" data-form="search" role="search">
    <label class="sr" for="q">Marka, ürün adı veya barkod</label>
    <input id="q" name="q" type="search" enterkeyhint="search" autocomplete="off" minlength="2" maxlength="100" placeholder="Marka, ürün adı veya barkod" value="${esc(Q.q)}">
    <button class="btn primary" type="submit" ${Q.loading ? 'disabled' : ''}>${icon('search')}<span class="sr">Ara</span></button>
    <a class="btn" href="#scan" data-route="scan" aria-label="Barkod okut">${icon('scan')}</a>
  </form>
  ${S.pendingMeal ? `<p class="chip-note">Eklenecek öğün: <strong>${esc(MEAL_LABEL[S.pendingMeal])}</strong></p>` : ''}
  ${S.recipe.active ? `<p class="chip-note">Tarif oluşturuluyor: ürün seçip “Tarife ekle”ye dokun. <button class="linkbtn" type="button" data-act="search-tab" data-tab="recipes">Tarife dön</button></p>` : ''}`;
  let panel = '';
  if (Q.tab === 'results') {
    if (Q.loading) panel = skeleton(3);
    else if (Q.error) panel = errorState(Q.error, 'retry-search');
    else if (Q.results === null) panel = `<div class="hint"><p>Ürün adı, marka veya barkod numarasıyla ara. Sonuçlar gerçek ürün etiketlerinden derlenen <strong>Open Food Facts</strong> verisidir; her kartta kaynağı yazar.</p><button class="btn" type="button" data-act="manual-food">Ürünü elle ekle</button></div>`;
    else if (!Q.results.length) panel = stateBlock('empty', { title: 'Sonuç bulunamadı', text: 'Farklı bir yazım dene, barkodu okut ya da ürünü elle ekle. Sunucu yalnızca 100 g değerleri tam olan ürünleri gösterir.', action: 'manual-food', actionLabel: 'Ürünü elle ekle' });
    else panel = productList(Q.results, '') + (Q.attribution ? `<p class="attrib">Kaynak: ${esc(Q.attribution)}</p>` : '') + '<p><button class="linkbtn" type="button" data-act="manual-food">Aradığını bulamadın mı? Elle ekle</button></p>';
  } else if (Q.tab === 'recents') {
    panel = Q.lists.recents.loading ? skeleton(3) : Q.lists.recents.error ? errorState(Q.lists.recents.error, 'reload-list') : productList(Q.lists.recents.items, 'Henüz ürün kullanmadın.');
  } else if (Q.tab === 'favorites') {
    panel = !S.caps.favorites ? stateBlock('unsupported', { text: 'Favoriler Nutrition+ API’si yayımlandığında hesabına kaydedilecek. Şimdilik “Son kullanılan” listesini kullanabilirsin.' })
      : Q.lists.favorites.loading ? skeleton(3) : Q.lists.favorites.error ? errorState(Q.lists.favorites.error, 'reload-list') : productList(Q.lists.favorites.items, 'Ürün detayında yıldıza dokunarak favori ekle.');
  } else {
    panel = recipes(S);
  }
  return `<h1 class="h1">Besin ara</h1>${form}${tabs}<div class="tabpanel" role="tabpanel" id="sp-${esc(Q.tab)}" aria-labelledby="st-${esc(Q.tab)}">${panel}</div>`;
}
function recipes(S) {
  const R = S.recipe, L = S.search.lists.recipes;
  const list = L.loading ? skeleton(2) : L.error ? errorState(L.error, 'reload-list') : productList(L.items, 'Henüz tarif kaydetmedin.');
  if (!R.active) return `<div class="row"><button class="btn primary" type="button" data-act="recipe-start">${icon('plus')}Yeni tarif</button></div>${list}`;
  let calc = null, calcErr = '';
  try { if (R.items.length) calc = Core.recipePer100(R.items, R.cooked); } catch (e) { calcErr = e.message; }
  const rows = R.items.map((i, idx) => `<li class="log"><div class="log-main"><span class="log-name">${esc(i.product.name)}</span><span class="log-meta">${esc(fmt(i.amount, i.product.basis, 0))}</span></div>
    <button class="iconbtn danger" type="button" data-act="recipe-remove" data-idx="${idx}" aria-label="${esc(i.product.name)} malzemesini çıkar">${icon('trash')}</button></li>`).join('');
  const incomplete = calc && ['kcal', 'protein', 'carbs', 'fat'].some(k => calc.per100[k] === null);
  return `<form class="card form" data-form="recipe" aria-labelledby="rc-h">
    <h2 id="rc-h">Yeni tarif</h2>
    <label class="field"><span>Tarif adı</span><input name="name" required minlength="2" maxlength="80" value="${esc(R.name)}" autocomplete="off"></label>
    ${rows ? `<ul class="logs">${rows}</ul>` : '<p class="muted small">Malzeme eklemek için “Sonuçlar” veya “Son kullanılan” listesinden ürün aç ve “Tarife ekle”ye dokun.</p>'}
    <label class="field"><span>Pişmiş toplam ağırlık (g, isteğe bağlı)</span><input name="cooked" inputmode="decimal" value="${esc(R.cooked)}" placeholder="${calc ? esc(calc.rawWeight) : ''}"></label>
    ${calc ? `<p class="small">100 g tarif: ${esc(fmt(calc.per100.kcal, 'kcal', 0))} · P ${esc(fmt(calc.per100.protein, 'g'))} · K ${esc(fmt(calc.per100.carbs, 'g'))} · Y ${esc(fmt(calc.per100.fat, 'g'))}</p>` : ''}
    ${incomplete ? '<p class="note warn">Bir malzemede değer bilinmediği için tarif kaydedilemez. O malzemeyi çıkar veya elle tam değerli ürün ekle.</p>' : ''}
    ${calcErr || R.error ? `<p class="note warn" role="alert">${esc(R.error || calcErr)}</p>` : ''}
    <p class="muted small">Sunucuya tarifin 100 g besin değerleri “${esc(S.recipePrefix)}” adıyla kaydedilir; malzeme listesi şimdilik saklanmaz.</p>
    <div class="row"><button class="btn primary" type="submit" ${!calc || incomplete || R.saving ? 'disabled' : ''}>${R.saving ? 'Kaydediliyor…' : 'Tarifi kaydet'}</button><button class="btn ghost" type="button" data-act="recipe-cancel">Vazgeç</button></div>
  </form>${list}`;
}

/* ---------- Product sheet ---------- */
function sheet(S) {
  const X = S.sheet;
  if (X.kind === 'manual') return manualSheet(S);
  const p = X.product;
  const amount = Core.validAmount(X.amount);
  const portion = amount ? Core.portion(p, amount) : null;
  const chips = [...p.servings.map(s => ({ label: `${s.label} (${fmt(s.amount, p.basis, 0)})`, amount: s.amount })), ...[50, 100, 150, 200].map(a => ({ label: `${a} ${p.basis}`, amount: a }))];
  const rows = Core.NUTRIENTS.map(n => `<tr><th scope="row">${esc(n.label)}</th><td class="${p.per100[n.key] === null ? 'unknown' : ''}">${esc(fmt(p.per100[n.key], n.unit))}</td><td class="${portion?.[n.key] === null ? 'unknown' : ''}">${portion ? esc(fmt(portion[n.key], n.unit)) : '–'}</td></tr>`).join('');
  const missing = Core.missingKeys(p).filter(k => ['kcal', 'protein', 'carbs', 'fat'].includes(k));
  const canLog = !!S.user && (p.basis === 'g' || S.caps.volume) && (p.id || p.sourceId);
  const meals = MEALS.map(m => `<label class="pill"><input type="radio" name="meal" value="${m.id}" ${X.meal === m.id ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('');
  return `<div class="scrim" data-act="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
    <div class="sheet-head"><div><h2 id="sheet-h">${esc(p.name)}</h2>${p.brand ? `<p class="muted">${esc(p.brand)}</p>` : ''}</div>
      ${S.caps.favorites && p.id ? `<button class="iconbtn ${X.favorite ? 'on' : ''}" type="button" data-act="toggle-fav" aria-pressed="${X.favorite ? 'true' : 'false'}" aria-label="Favorilere ${X.favorite ? 'eklendi' : 'ekle'}">${icon('star')}</button>` : ''}
      <button class="iconbtn" type="button" data-act="close-sheet" aria-label="Kapat">${icon('close')}</button></div>
    <div class="src-box">${sourceBadge(p.source)}<span class="muted small">${esc(p.source.detail)}</span>${p.source.url ? ` <a class="small" href="${esc(p.source.url)}" target="_blank" rel="noopener noreferrer">Kaynakta gör</a>` : ''}${p.barcode ? `<span class="tag mono">${esc(p.barcode)}</span>` : ''}</div>
    ${missing.length ? `<p class="note warn">Bilinmeyen değer: ${esc(missing.map(k => Core.NUTRIENTS.find(n => n.key === k).label).join(', '))}. Bu değerler toplamlara eklenmez.</p>` : ''}
    <form class="form" data-form="log">
      <div class="amount-row">
        <label class="field grow"><span>Miktar (${esc(p.basis)})</span><input id="amount" name="amount" type="text" inputmode="decimal" autocomplete="off" pattern="[0-9]+([.,][0-9]+)?" required value="${esc(X.amount)}" aria-describedby="amount-help"></label>
      </div>
      <p id="amount-help" class="sr">Besin değerleri 100 ${esc(p.basis)} için verilir ve girdiğin miktara göre hesaplanır.</p>
      <div class="chips" role="group" aria-label="Hazır miktarlar">${chips.map(c => `<button type="button" class="chip ${Number(X.amount) === c.amount ? 'on' : ''}" data-act="set-amount" data-amount="${esc(c.amount)}">${esc(c.label)}</button>`).join('')}</div>
      ${amount === null ? `<p class="note warn" role="alert">Miktar 0’dan büyük ve en fazla ${Core.MAX_AMOUNT} ${esc(p.basis)} olmalı.</p>` : ''}
      <table class="ntable"><caption class="sr">Besin değerleri</caption><thead><tr><th scope="col">Besin</th><th scope="col">100 ${esc(p.basis)}</th><th scope="col">${amount ? esc(fmt(amount, p.basis, 0)) : 'Porsiyon'}</th></tr></thead><tbody>${rows}</tbody></table>
      <fieldset class="meals-pick"><legend>Öğün</legend><div class="pills">${meals}</div></fieldset>
      ${X.error ? `<p class="note warn" role="alert">${esc(Core.errorText(X.error))}</p>` : ''}
      ${p.basis === 'ml' && !S.caps.volume ? '<p class="note">Sunucu şu an yalnızca gram bazlı kayıt alıyor.</p>' : ''}
      <div class="row sticky-actions">
        <button class="btn primary grow" type="submit" ${!canLog || amount === null || X.saving ? 'disabled' : ''}>${X.saving ? 'Ekleniyor…' : 'Öğüne ekle'}</button>
        ${S.recipe.active ? `<button class="btn" type="button" data-act="recipe-add" ${amount === null ? 'disabled' : ''}>Tarife ekle</button>` : ''}
      </div>
    </form>
  </div>`;
}
function manualSheet(S) {
  const X = S.sheet;
  const f = (name, label, unit, req = true) => `<label class="field"><span>${esc(label)} (${unit})${req ? '' : ' · isteğe bağlı'}</span><input name="${name}" inputmode="decimal" ${req ? 'required' : ''} value="${esc(X.values?.[name] || '')}" autocomplete="off"></label>`;
  return `<div class="scrim" data-act="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
    <div class="sheet-head"><h2 id="sheet-h">Ürünü elle ekle</h2><button class="iconbtn" type="button" data-act="close-sheet" aria-label="Kapat">${icon('close')}</button></div>
    <form class="form" data-form="manual">
      ${X.barcode ? `<p class="muted small">Barkod <span class="mono">${esc(X.barcode)}</span> kaynakta bulunamadı. Değerleri ambalaj etiketinden gir.</p>` : '<p class="muted small">Değerleri ambalaj etiketindeki 100 g sütunundan gir.</p>'}
      <label class="field"><span>Ürün adı</span><input name="name" required minlength="2" maxlength="200" value="${esc(X.values?.name || '')}" autocomplete="off"></label>
      <div class="grid2">${f('kcal', 'Enerji', 'kcal')}${f('protein', 'Protein', 'g')}${f('carbs', 'Karbonhidrat', 'g')}${f('fat', 'Yağ', 'g')}</div>
      ${X.error ? `<p class="note warn" role="alert">${esc(Core.errorText(X.error))}</p>` : ''}
      <p class="muted small">Bu ürün yalnızca senin hesabına “Elle girildi” kaynağıyla kaydedilir.</p>
      <div class="row"><button class="btn primary grow" type="submit" ${X.saving ? 'disabled' : ''}>${X.saving ? 'Kaydediliyor…' : 'Kaydet ve aç'}</button></div>
    </form>
  </div>`;
}

/* ---------- Scan ---------- */
function scan(S) {
  const C = S.scan;
  const camera = C.active || C.starting
    ? `<div class="camera"><video id="scan-video" playsinline muted autoplay aria-label="Kamera görüntüsü"></video><div class="aim" aria-hidden="true"></div>
        <p class="cam-status" role="status">${C.starting ? 'Kamera açılıyor…' : 'Barkodu çerçevenin içine getir'}</p></div>
       <div class="row"><button class="btn" type="button" data-act="scan-stop">Kamerayı kapat</button>${C.torch ? `<button class="btn ghost" type="button" data-act="scan-torch" aria-pressed="${C.torchOn}">${C.torchOn ? 'Feneri kapat' : 'Feneri aç'}</button>` : ''}</div>`
    : `<div class="camera idle">${icon('scan', 'big')}<p>Kamerayla barkod okut</p><button class="btn primary" type="button" data-act="scan-start">Kamerayı aç</button></div>`;
  const camErr = C.error ? `<div class="note warn" role="alert"><strong>${esc(C.error[0])}</strong><br>${esc(C.error[1])}</div>` : '';
  const L = C.lookup;
  let result = '';
  if (L.loading) result = stateBlock('loading', { title: 'Ürün aranıyor…' });
  else if (L.error) {
    const k = Core.errorKind(L.error);
    if (k === 'notFoundBarcode' || k === 'notFound' || k === 'incomplete') result = stateBlock('empty', { title: 'Ürün bulunamadı', text: k === 'incomplete' ? Core.errorText(L.error) : 'Bu barkod kaynakta kayıtlı değil. Ürünü etiket değerleriyle elle ekleyebilirsin.', action: 'manual-food-barcode', actionLabel: 'Ürünü elle ekle' });
    else result = errorState(L.error, 'scan-retry');
  }
  const check = C.check === 'checksum' ? '<p class="note">Kontrol hanesi tutmuyor. Rakamları tekrar kontrol et; yine de arayabilirsin.</p>' : C.check === 'format' ? '<p class="note warn" role="alert">Barkod 8, 12, 13 veya 14 rakam olmalı.</p>' : '';
  return `<h1 class="h1">Barkod okut</h1>
  <div class="scan-grid"><section class="card" aria-label="Kamera">${camera}${camErr}</section>
  <section class="card" aria-labelledby="manual-h"><h2 id="manual-h">Barkodu elle gir</h2>
    <form class="form" data-form="barcode"><label class="field"><span>Barkod numarası</span><input name="code" inputmode="numeric" autocomplete="off" pattern="[0-9 \\-]*" maxlength="18" value="${esc(C.manual)}" placeholder="8690000000000"></label>
    ${check}<button class="btn primary block" type="submit" ${L.loading ? 'disabled' : ''}>Ürünü bul</button></form>
    <div aria-live="polite">${result}</div>
    <p class="muted small">Barkoddan bulunan ürün, kayıt eklenebilmesi için hesabındaki ürün listesine kopyalanır. Kamera görüntüsü cihazda işlenir, sunucuya gönderilmez.</p>
  </section></div>`;
}

/* ---------- Trends ---------- */
function chart(S, data) {
  const c = Core.chartBars(data.daily, S.goals?.kcal);
  const n = c.bars.length, W = 320, H = 150, gap = n > 10 ? 2 : 6, bw = (W - gap * (n - 1)) / Math.max(n, 1);
  const bars = c.bars.map((b, i) => {
    const h = Math.max(b.value ? 2 : 0, b.pct / 100 * H);
    const x = i * (bw + gap);
    const label = n <= 7 ? Core.DAY_SHORT[Core.parseDate(b.date).getDay()] : (i % 5 === 0 || i === n - 1 ? String(Number(b.date.slice(8))) : '');
    return `<g><rect class="cbar ${b.over ? 'over' : ''} ${b.date === S.today ? 'now' : ''}" x="${Core.round(x, 2)}" y="${Core.round(H - h, 2)}" width="${Core.round(bw, 2)}" height="${Core.round(h, 2)}" rx="3"><title>${esc(b.date)}: ${esc(fmt(b.value, 'kcal', 0))}</title></rect>${label ? `<text x="${Core.round(x + bw / 2, 2)}" y="${H + 14}" text-anchor="middle">${esc(label)}</text>` : ''}</g>`;
  }).join('');
  const goal = c.goalPct !== null ? `<line class="goal" x1="0" x2="${W}" y1="${Core.round(H - c.goalPct / 100 * H, 2)}" y2="${Core.round(H - c.goalPct / 100 * H, 2)}"/>` : '';
  const desc = c.bars.map(b => `${b.date} ${b.value} kcal`).join(', ');
  return `<figure class="chart"><svg viewBox="0 -4 ${W} ${H + 22}" role="img" aria-label="Günlük kalori grafiği">${bars}${goal}</svg>
    <figcaption class="muted small">${S.goals ? 'Kesikli çizgi: günlük hedef. ' : ''}<span class="sr">${esc(desc)}</span></figcaption></figure>`;
}
function trends(S) {
  const T = S.trends;
  const seg = `<div class="seg" role="tablist" aria-label="Dönem">${[['daily', 'Gün'], ['weekly', 'Hafta'], ['monthly', 'Ay']].map(([id, l]) => `<button type="button" role="tab" aria-selected="${T.period === id}" tabindex="${T.period === id ? 0 : -1}" data-act="period" data-period="${id}">${l}</button>`).join('')}</div>`;
  const nav = `<div class="day-nav"><button class="iconbtn" type="button" data-act="trend-prev" aria-label="Önceki dönem">${icon('left')}</button><p class="day-title small">${esc(T.data ? (T.data.start === T.data.end ? Core.dayLabel(T.data.start, S.today) : T.data.start + ' – ' + T.data.end) : '')}</p><button class="iconbtn" type="button" data-act="trend-next" aria-label="Sonraki dönem" ${T.anchor >= S.today ? 'disabled' : ''}>${icon('right')}</button></div>`;
  let body;
  if (T.loading && !T.data) body = skeleton(3);
  else if (T.error && !T.data) body = errorState(T.error, 'reload-trends');
  else if (!T.data || !T.data.logs.length) body = stateBlock('empty', { title: 'Bu dönemde kayıt yok', text: 'Kayıt ekledikçe kalori ve makro grafiklerin burada oluşur.' });
  else {
    const d = T.data, s = Core.periodSummary(d), share = Core.macroEnergyShare(d.totals);
    const shareBar = `<div class="share" role="img" aria-label="Enerji dağılımı: protein yüzde ${share.protein}, karbonhidrat yüzde ${share.carbs}, yağ yüzde ${share.fat}"><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="m-protein" x="0" width="${share.protein}" height="10"/><rect class="m-carbs" x="${share.protein}" width="${share.carbs}" height="10"/><rect class="m-fat" x="${share.protein + share.carbs}" width="${share.fat}" height="10"/></svg></div>
      <ul class="legend"><li class="m-protein">Protein %${share.protein}</li><li class="m-carbs">Karbonhidrat %${share.carbs}</li><li class="m-fat">Yağ %${share.fat}</li></ul>`;
    if (T.period === 'daily') {
      const groups = Core.groupByMeal(d.logs, l => l.meal || S.mealTags[l.id]);
      const mealRows = [...Core.MEAL_IDS, 'unassigned'].filter(id => groups[id].length).map(id => {
        const k = Core.sumNutrients(groups[id].map(l => l.nutrients)).totals.kcal;
        return bar(MEAL_LABEL[id], k, d.totals.kcal || 1, 'kcal', 'm-kcal');
      }).join('');
      body = `<section class="card"><h2>Günün dağılımı</h2><dl class="kv"><div><dt>Toplam</dt><dd>${esc(fmt(d.totals.kcal, 'kcal', 0))}</dd></div><div><dt>Protein</dt><dd>${esc(fmt(d.totals.protein, 'g'))}</dd></div><div><dt>Karbonhidrat</dt><dd>${esc(fmt(d.totals.carbs, 'g'))}</dd></div><div><dt>Yağ</dt><dd>${esc(fmt(d.totals.fat, 'g'))}</dd></div></dl>${shareBar}</section>
        <section class="card"><h2>Öğünlere göre kalori</h2>${mealRows}</section>`;
    } else {
      body = `<section class="card"><h2>Kalori</h2>${chart(S, d)}</section>
        <section class="card"><h2>Ortalama (kayıtlı ${s.loggedDays}/${s.days} gün)</h2>
          <dl class="kv"><div><dt>Kalori</dt><dd>${esc(fmt(s.avgKcal, 'kcal', 0))}</dd></div><div><dt>Protein</dt><dd>${esc(fmt(s.avgProtein, 'g', 0))}</dd></div><div><dt>Karbonhidrat</dt><dd>${esc(fmt(s.avgCarbs, 'g', 0))}</dd></div><div><dt>Yağ</dt><dd>${esc(fmt(s.avgFat, 'g', 0))}</dd></div></dl>
          ${shareBar}<p class="muted small">Ortalama yalnızca kayıt girilen günlerden hesaplanır.</p></section>`;
    }
  }
  return `<h1 class="h1">Grafikler</h1>${seg}${nav}<div class="trend-grid">${body}</div>`;
}

/* ---------- Body and goals ---------- */
function body(S) {
  const B = S.body, g = S.goals;
  const goalCard = `<section class="card" aria-labelledby="goal-h"><h2 id="goal-h">Günlük hedefler</h2>
    <form class="form" data-form="goals">
      <div class="grid2">
        <label class="field"><span>Kalori (kcal)</span><input name="kcal" inputmode="numeric" value="${esc(g?.kcal ?? '')}" placeholder="2000"></label>
        <label class="field"><span>Protein (g)</span><input name="protein" inputmode="numeric" value="${esc(g?.protein ?? '')}" placeholder="otomatik"></label>
        <label class="field"><span>Karbonhidrat (g)</span><input name="carbs" inputmode="numeric" value="${esc(g?.carbs ?? '')}" placeholder="otomatik"></label>
        <label class="field"><span>Yağ (g)</span><input name="fat" inputmode="numeric" value="${esc(g?.fat ?? '')}" placeholder="otomatik"></label>
      </div>
      ${B.goalError ? `<p class="note warn" role="alert">${esc(B.goalError)}</p>` : ''}
      <p class="muted small">Makroları boş bırakırsan %25 protein, %50 karbonhidrat, %25 yağ olarak hesaplanır. ${S.caps.serverGoals ? '' : 'Hedeflerin sunucuya kaydedilmez; yalnızca bu sekme açıkken tutulur.'}</p>
      <div class="row"><button class="btn primary" type="submit">Hedefi kaydet</button>${g ? '<button class="btn ghost" type="button" data-act="goal-clear">Hedefi kaldır</button>' : ''}</div>
    </form></section>`;
  const E = B.estimate;
  const sel = (name, opts, v) => `<select name="${name}">${opts.map(([val, l]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const est = `<section class="card" aria-labelledby="est-h"><h2 id="est-h">Kalori ihtiyacı tahmini <span class="tag">İsteğe bağlı</span></h2>
    <form class="form" data-form="estimate">
      <div class="grid2">
        <label class="field"><span>Yaş</span><input name="age" inputmode="numeric" required value="${esc(B.form.age)}"></label>
        <label class="field"><span>Cinsiyet</span>${sel('sex', [['female', 'Kadın'], ['male', 'Erkek']], B.form.sex)}</label>
        <label class="field"><span>Boy (cm)</span><input name="height_cm" inputmode="decimal" required value="${esc(B.form.height_cm)}"></label>
        <label class="field"><span>Kilo (kg)</span><input name="weight_kg" inputmode="decimal" required value="${esc(B.form.weight_kg)}"></label>
        <label class="field"><span>Aktivite</span>${sel('activity', [['sedentary', 'Hareketsiz'], ['light', 'Hafif'], ['moderate', 'Orta'], ['active', 'Aktif'], ['very_active', 'Çok aktif']], B.form.activity)}</label>
        <label class="field"><span>Hedef</span>${sel('goal', [['lose', 'Kilo vermek'], ['maintain', 'Korumak'], ['gain', 'Kilo almak']], B.form.goal)}</label>
      </div>
      <div class="row"><button class="btn" type="submit" ${E.loading ? 'disabled' : ''}>${E.loading ? 'Hesaplanıyor…' : 'Hesapla'}</button></div>
    </form>
    ${E.error ? `<p class="note warn" role="alert">${esc(Core.errorText(E.error))}</p>` : ''}
    ${E.data ? `<dl class="kv"><div><dt>VKİ</dt><dd>${esc(fmt(Core.toNum(E.data.bmi)))} <small>${esc(Core.bmiBand(Core.toNum(E.data.bmi)))}</small></dd></div><div><dt>Bazal</dt><dd>${esc(fmt(Core.toNum(E.data.bmr), 'kcal', 0))}</dd></div><div><dt>Koruma</dt><dd>${esc(fmt(Core.toNum(E.data.maintenance_kcal), 'kcal', 0))}</dd></div><div><dt>Önerilen hedef</dt><dd>${esc(fmt(Core.toNum(E.data.target_kcal), 'kcal', 0))}</dd></div></dl>
      <button class="btn primary" type="button" data-act="use-estimate">Bu hedefi kullan</button>` : ''}
    <p class="muted small">Mifflin–St Jeor formülüyle yapılan genel bir tahmindir; tıbbi veya kişisel beslenme önerisi değildir. Girdiğin ölçüler hesap için sunucuya gönderilir, kaydedilmez.</p>
  </section>`;
  const M = B.measurements;
  let meas;
  if (!S.caps.measurements) meas = stateBlock('unsupported', { text: 'Vücut ölçümü geçmişi Nutrition+ API’si yayımlandığında hesabına kaydedilecek.' });
  else if (M.loading) meas = skeleton(2);
  else if (M.error) meas = errorState(M.error, 'reload-measurements');
  else meas = `<form class="form" data-form="measurement"><div class="grid3">
      <label class="field"><span>Kilo (kg)</span><input name="weight_kg" inputmode="decimal" required></label>
      <label class="field"><span>Bel (cm)</span><input name="waist_cm" inputmode="decimal"></label>
      <label class="field"><span>Yağ oranı (%)</span><input name="body_fat" inputmode="decimal"></label></div>
      <button class="btn" type="submit">Ölçüm ekle</button></form>
    ${M.items.length ? `<table class="ntable"><caption class="sr">Ölçüm geçmişi</caption><thead><tr><th scope="col">Tarih</th><th scope="col">Kilo</th><th scope="col">Bel</th></tr></thead><tbody>${M.items.map(m => `<tr><td>${esc(m.date)}</td><td>${esc(fmt(Core.toNum(m.weight_kg), 'kg'))}</td><td>${esc(fmt(Core.toNum(m.waist_cm), 'cm'))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Henüz ölçüm yok.</p>'}`;
  return `<h1 class="h1">Vücut ve hedefler</h1><div class="body-grid">${goalCard}${est}<section class="card" aria-labelledby="meas-h"><h2 id="meas-h">Vücut ölçümleri</h2>${meas}</section>
    <section class="card privacy" aria-labelledby="priv-h"><h2 id="priv-h">Gizlilik</h2><p class="small">Beslenme kayıtların yalnızca kendi hesabına bağlıdır; yönetici dahil başka kullanıcılar bu kayıtları göremez. Uygulama kişisel kayıtları cihaza kaydetmez ve çevrimdışı önbelleğe almaz. Tahmin ve hedefler sağlık profesyoneli değerlendirmesinin yerini tutmaz.</p></section></div>`;
}

function page(S) {
  if (S.session === 'expired') return sessionScreen(S);
  if (S.boot === 'loading') return `<div class="shell solo"><main id="main" class="main">${stateBlock('loading', { title: 'Nutrition+ açılıyor…' })}</main></div>`;
  if (S.boot === 'error') return `<div class="shell solo"><main id="main" class="main">${errorState(S.bootError, 'boot')}</main></div>`;
  const view = { today, search, scan, trends, body }[S.route] || today;
  return shell(S, view(S));
}

const exported = { page, shell, today, search, scan, trends, body, sheet, stateBlock, errorState, productCard, chart, icon, TABS, MEAL_LABEL };
if (typeof module === 'object' && module.exports) module.exports = exported;
else global.NutritionViews = Object.freeze(exported);
})(typeof globalThis !== 'undefined' ? globalThis : this);
