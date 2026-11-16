/* Shared admin dashboard. All metrics derive from /api/state and /api/v6/analytics. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormClubDashboard = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const date = value => String(value || '').slice(0, 10);
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const money = value => num(value).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
  const integer = value => num(value).toLocaleString('tr-TR');
  const percent = value => value === null ? 'Veri yok' : `%${Math.round(value)}`;
  const ratio = (a, b) => b ? 100 * a / b : null;
  const monthLabel = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const shortMonth = month => new Date(2024, month - 1, 1).toLocaleDateString('tr-TR', { month: 'short' });
  const defaults = (now = new Date()) => ({ year: now.getFullYear(), month: now.getMonth() + 1, mode: 'monthly', compare: true });
  function selection(options, field, value) {
    if (field === 'compare') options.compare = Boolean(value);
    else if (field === 'mode' && ['monthly', 'yearly'].includes(value)) options.mode = value;
    else if (field === 'year' && /^\d{4}$/.test(String(value))) options.year = Number(value);
    else if (field === 'month' && Number(value) >= 1 && Number(value) <= 12) options.month = Number(value);
    return options;
  }
  function model(state, analytics, options, now = new Date()) {
    const today = localDate(now), selected = { ...defaults(now), ...options };
    const monthly = Array.isArray(analytics?.monthly) ? analytics.monthly : [];
    const available = Array.isArray(analytics?.monthly);
    const payments = state.payments || [], bookings = state.bookings || [], members = state.members || [];
    const key = `${selected.year}-${String(selected.month).padStart(2, '0')}`;
    const previousMonth = new Date(selected.year, selected.month - 2, 1);
    const prevKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;
    const periodKey = selected.mode === 'yearly' ? String(selected.year) : key;
    const previousKey = selected.mode === 'yearly' ? String(selected.year - 1) : prevKey;
    const matches = (value, prefix) => date(value).startsWith(prefix);
    const sum = (rows, field) => rows.reduce((total, row) => total + num(row[field]), 0);
    const total = prefix => {
      const rows = monthly.filter(row => row.month.startsWith(prefix));
      const collected = sum(rows, 'collected'), attended = sum(rows, 'attended'), marked = sum(rows, 'marked');
      return { collected: available ? collected : null, attended: available ? attended : null, marked, attendance: available ? ratio(attended, marked) : null };
    };
    const makeSeries = (year, month, yearly) => {
      const length = yearly ? 12 : new Date(year, month, 0).getDate();
      return Array.from({ length }, (_, i) => {
        const prefix = yearly ? `${year}-${String(i + 1).padStart(2, '0')}` : `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        const future = prefix > today.slice(0, yearly ? 7 : 10);
        let collected, attended, marked;
        if (yearly) {
          const rows = monthly.filter(row => row.month === prefix);
          collected = sum(rows, 'collected'); attended = sum(rows, 'attended'); marked = sum(rows, 'marked');
        } else {
          collected = payments.filter(row => row.status === 'Ödendi' && matches(row.paid_at || row.due_date, prefix)).reduce((a, row) => a + num(row.amount), 0);
          const rows = bookings.filter(row => matches(row.starts_at, prefix));
          attended = rows.filter(row => row.status === 'attended').length;
          marked = rows.filter(row => ['attended', 'absent'].includes(row.status)).length;
        }
        return { label: yearly ? shortMonth(i + 1) : String(i + 1), collected: available && !future ? collected : null, attendance: available && !future ? ratio(attended, marked) : null, attended, marked };
      });
    };
    const current = total(periodKey), previous = total(previousKey);
    const series = makeSeries(selected.year, selected.month, selected.mode === 'yearly');
    const prevSeries = makeSeries(selected.mode === 'yearly' ? selected.year - 1 : previousMonth.getFullYear(), previousMonth.getMonth() + 1, selected.mode === 'yearly');
    // Months have different lengths: never turn a non-existent day into zero.
    const paired = Array.from({ length: Math.max(series.length, selected.compare ? prevSeries.length : 0) }, (_, i) => ({ label: series[i]?.label || prevSeries[i].label, current: series[i] || null, previous: prevSeries[i] || null }));
    const due = payments.filter(p => matches(p.due_date, periodKey));
    const paid = due.filter(p => p.status === 'Ödendi');
    const dated = paid.filter(p => p.paid_at);
    const onTime = dated.filter(p => date(p.paid_at) <= date(p.due_date)).length;
    const lastDay = new Date(now); lastDay.setDate(lastDay.getDate() + 7);
    const expiring = members.filter(m => m.status === 'Aktif' && date(m.expires) >= today && date(m.expires) <= localDate(lastDay)).sort((a, b) => date(a.expires).localeCompare(date(b.expires)));
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 30);
    const periodStart = `${periodKey}${selected.mode === 'yearly' ? '-01-01' : '-01'}`;
    function occupancyFor(prefix) {
      const grouped = new Map();
      for (const c of state.classes || []) {
        if (!matches(c.starts_at, prefix)) continue;
        const entry = grouped.get(c.title) || { title: c.title, booked: 0, capacity: 0, classes: 0 };
        entry.booked += num(c.booked); entry.capacity += num(c.capacity); entry.classes++;
        grouped.set(c.title, entry);
      }
      return grouped;
    }
    const occupancy = occupancyFor(periodKey), previousOccupancy = occupancyFor(previousKey);
    const classNames = [...new Set([...occupancy.keys(), ...(selected.compare ? previousOccupancy.keys() : [])])];
    const occupancyRows = classNames.map(title => {
      const c = occupancy.get(title) || { title, booked: 0, capacity: 0, classes: 0 };
      const previous = previousOccupancy.get(title);
      return { ...c, rate: ratio(c.booked, c.capacity), previous: previous ? { ...previous, rate: ratio(previous.booked, previous.capacity) } : null };
    }).sort((a, b) => num(b.rate) - num(a.rate));
    const years = [...new Set([now.getFullYear(), selected.year, ...monthly.map(r => Number(r.month.slice(0, 4))), ...payments.map(p => Number(date(p.paid_at || p.due_date).slice(0, 4)))])].filter(y => Number.isInteger(y) && y >= 1900 && y <= 9999).sort((a, b) => b - a);
    return { selected, today, available, years, key, periodKey, previousKey, current, previous, paired,
      monthRevenue: total(key).collected,
      active: state.stats?.active ?? members.filter(m => m.status === 'Aktif').length,
      entries: state.stats?.todayEntries ?? (state.checkins || []).filter(c => date(c.created_at) === today).length,
      pending: payments.filter(p => p.status === 'Bekliyor').reduce((a, p) => a + num(p.amount), 0),
      expiring, occupancy: occupancyRows,
      occupancyPartial: periodStart < localDate(cutoff),
      previousOccupancyPartial: `${previousKey}${selected.mode === 'yearly' ? '-01-01' : '-01'}` < localDate(cutoff),
      payment: { total: due.length, onTime, late: dated.length - onTime, unknown: paid.length - dated.length, pending: due.length - paid.length, score: ratio(onTime, due.length) }
    };
  }
  const empty = message => `<div class="fc-empty">${esc(message)}</div>`;
  function delta(current, previous, compare, format) {
    if (!compare) return '';
    if (current === null || previous === null) return '<span class="fc-change">Karşılaştırma verisi yok</span>';
    const difference = current - previous;
    const change = previous === 0 ? (current === 0 ? 'Değişim yok' : 'Önceki dönem sıfır; yüzde hesaplanmaz') : `${difference > 0 ? '+' : ''}${Math.round(100 * difference / previous)}%`;
    return `<span class="fc-change">Önceki: ${esc(format(previous))} · ${esc(change)}</span>`;
  }
  function chart(data, field, title, format) {
    const rows = data.paired;
    const values = rows.flatMap(r => [r.current?.[field], ...(data.selected.compare ? [r.previous?.[field]] : [])]).filter(v => v !== null && v !== undefined);
    if (!values.length || (field === 'collected' && values.every(v => v === 0))) return empty(field === 'collected' ? 'Bu dönemlerde tahsilat kaydı yok.' : 'Bu dönemlerde işlenmiş yoklama yok.');
    const max = field === 'attendance' ? 100 : Math.max(1, ...values);
    const bar = (row, previous) => {
      const value = row?.[field];
      if (value === null || value === undefined) return '<span class="fc-missing" title="Veri yok veya dönem henüz gelmedi">—</span>';
      return `<span class="fc-bar ${previous ? 'fc-bar-previous' : ''}" style="height:${value === 0 ? 0 : Math.max(2, 100 * value / max)}%" title="${esc((previous ? 'Önceki: ' : 'Seçili: ') + format(value))}"></span>`;
    };
    return `<div class="fc-legend"><span><i></i>Seçili dönem</span>${data.selected.compare ? '<span><i class="fc-blue"></i>Önceki dönem</span>' : ''}</div><p class="fc-caption">${field === 'attendance' ? 'Ölçek: %0–100' : `Üst sınır: ${esc(money(max))}`} · Tam değerler aşağıdaki tabloda</p><div class="fc-chart-scroll"><div class="fc-chart ${rows.length > 12 ? 'fc-chart-days' : ''}" role="img" aria-label="${esc(title)}"><div class="fc-chart-columns">${rows.map(r => `<div class="fc-column"><div class="fc-bar-pair">${bar(r.current, false)}${data.selected.compare ? bar(r.previous, true) : ''}</div><span>${esc(r.label)}</span></div>`).join('')}</div></div></div><details class="fc-data"><summary>Grafik verilerini tablo olarak göster</summary><div class="fc-table-wrap"><table><caption>${esc(title)}</caption><thead><tr><th>Dönem</th><th>Seçili</th>${data.selected.compare ? '<th>Önceki</th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.current?.[field] == null ? '—' : esc(format(r.current[field]))}</td>${data.selected.compare ? `<td>${r.previous?.[field] == null ? '—' : esc(format(r.previous[field]))}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
  }
  function render(state, analytics, options, error = '', now = new Date()) {
    const d = model(state, analytics, options, now), o = d.selected;
    const label = o.mode === 'yearly' ? `${o.year} yılı` : monthLabel(o.year, o.month);
    const previousLabel = o.mode === 'yearly' ? `${o.year - 1} yılı` : monthLabel(Number(d.previousKey.slice(0, 4)), Number(d.previousKey.slice(5, 7)));
    const kpi = (title, value, note) => `<article class="fc-kpi"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
    return `<div class="fc-dashboard">${error ? `<div class="fc-alert" role="alert">Analitik verileri yüklenemedi: ${esc(error)}. Finans ve devamlılık grafikleri kullanılamıyor.</div>` : ''}<section class="fc-kpis" aria-label="Salonun güncel özeti">${kpi('Aktif üye', integer(d.active), 'Güncel üye durumu')}${kpi('Aylık tahsilat', d.monthRevenue === null ? '—' : money(d.monthRevenue), monthLabel(o.year, o.month))}${kpi('Bekleyen ödeme', money(d.pending), 'Tüm açık ödemeler')}${kpi('Bugünkü giriş', integer(d.entries), 'Güncel giriş kayıtları')}${kpi('Yaklaşan üyelik bitişi', integer(d.expiring.length), 'Önümüzdeki 7 gün')}</section>
      <section class="fc-filters" aria-label="Grafik dönemini seç"><div><h2>Finans ve devamlılık</h2><p>${esc(label)}${o.compare ? ` · Karşılaştırma: ${esc(previousLabel)}` : ''}</p></div><div class="fc-filter-inputs"><label>Görünüm<select data-dashboard="mode"><option value="monthly" ${o.mode === 'monthly' ? 'selected' : ''}>Aylık · günler</option><option value="yearly" ${o.mode === 'yearly' ? 'selected' : ''}>Yıllık · aylar</option></select></label><label>Yıl<select data-dashboard="year">${d.years.map(y => `<option ${o.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label><label>Ay<select data-dashboard="month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${o.month === i + 1 ? 'selected' : ''}>${esc(shortMonth(i + 1))}</option>`).join('')}</select></label><label class="fc-check"><input type="checkbox" data-dashboard="compare" ${o.compare ? 'checked' : ''}>Önceki dönemle karşılaştır</label></div></section>
      <div class="fc-middle"><section class="fc-panel"><div class="fc-panel-heading"><h2>${o.mode === 'yearly' ? 'Yıllık' : 'Aylık'} tahsilat</h2><strong>${d.current.collected === null ? '—' : money(d.current.collected)}</strong></div>${delta(d.current.collected, d.previous.collected, o.compare, money)}${d.available ? chart(d, 'collected', 'Tahsilat karşılaştırması', money) : empty('Tahsilat verisi kullanılamıyor.')}<p class="fc-caption">Yalnızca ödenmiş kayıtlar. Ödeme tarihi eksikse mevcut API vade tarihini kullanır.</p></section><section class="fc-panel"><div class="fc-panel-heading"><h2>Öğrenci devamlılığı</h2><strong>${percent(d.current.attendance)}</strong></div>${delta(d.current.attendance, d.previous.attendance, o.compare, percent)}${d.available ? chart(d, 'attendance', 'Devamlılık karşılaştırması', percent) : empty('Devamlılık verisi kullanılamıyor.')}<p class="fc-caption">${integer(d.current.attended)} geldi / ${integer(d.current.marked)} işlenmiş yoklama. İşlenmemiş yoklamalar orana dahil edilmez.</p></section></div>
      <div class="fc-bottom"><section class="fc-panel"><h2>Ders doluluğu</h2><p class="fc-caption">${esc(label)} · Dolu kontenjan / toplam kontenjan</p>${d.occupancyPartial ? '<p class="fc-alert">Kısmi tarihçe: mevcut ders API’si son 30 günden itibaren kayıtları getirir. Bu dönem için tam doluluk karşılaştırması yapılamaz.</p>' : ''}${d.occupancy.length ? d.occupancy.map(c => `<div class="fc-occupancy"><div><strong>${esc(c.title)}</strong><span>${percent(c.rate)}</span></div><div class="fc-track"><span style="width:${Math.min(100, num(c.rate))}%"></span></div><small>Seçili: ${integer(c.booked)} / ${integer(c.capacity)} kontenjan · ${integer(c.classes)} ders</small>${o.compare ? `<div class="fc-track fc-track-previous"><span style="width:${Math.min(100, num(c.previous?.rate))}%"></span></div><small>Önceki${d.previousOccupancyPartial ? ' (kısmi tarihçe)' : ''}: ${percent(c.previous?.rate ?? null)}${c.previous ? ` · ${integer(c.previous.booked)} / ${integer(c.previous.capacity)}` : ''}</small>` : ''}</div>`).join('') : empty('Erişilebilir ders kayıtlarında bu dönem için veri yok.')}</section>
      <section class="fc-panel"><h2>Ödeme düzeni</h2><strong class="fc-score">${percent(d.payment.score)}</strong><p class="fc-caption">${esc(label)} vadeli ödemelerde zamanında ödendiği doğrulanan / tüm ödeme kayıtları</p><dl class="fc-payment-list"><div><dt>Zamanında ödenen</dt><dd>${integer(d.payment.onTime)}</dd></div><div><dt>Geç ödenen</dt><dd>${integer(d.payment.late)}</dd></div><div><dt>Bekleyen</dt><dd>${integer(d.payment.pending)}</dd></div><div><dt>Ödeme tarihi eksik</dt><dd>${integer(d.payment.unknown)}</dd></div><div><dt>Toplam kayıt</dt><dd>${integer(d.payment.total)}</dd></div></dl><p class="fc-caption">Tarihi eksik ödemeler zamanında ödendi kabul edilmez.</p></section>
      <section class="fc-panel"><h2>Yaklaşan üyelik bitişleri</h2><p class="fc-caption">Güncel liste · önümüzdeki 7 gün</p>${d.expiring.length ? `<ul class="fc-expiring">${d.expiring.map(m => `<li><div><strong>${esc(m.name)}</strong><small>${esc(m.plan)}</small></div><time datetime="${esc(date(m.expires))}">${esc(new Date(date(m.expires) + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }))}</time></li>`).join('')}</ul>` : empty('Önümüzdeki 7 gün içinde bitecek aktif üyelik yok.')}</section></div><p class="fc-caption">Kaynak: mevcut ödeme, yoklama, ders ve üyelik API kayıtları. Sıfır, ilgili dönemde kayıt bulunmadığını; “—”, eksik veya gelecekteki dönemi gösterir. Yıllık görünümde ay seçimi üstteki aylık tahsilat kartını değiştirir. Devam eden dönemler, önceki dönemin tamamıyla karşılaştırılır.</p></div>`;
  }
  return { defaults, selection, model, render };
});
