/* FORM CLUB mobile tables. Copies each column header into the cell's data-label so table-cards.css can
   show every row as a small labelled card at 768px and below. Desktop tables are untouched.
   Opt out with <table data-stack="off"> (then the wrapper scrolls horizontally instead). */
(() => {
'use strict';
function label(table) {
  if (table.dataset.stack === 'off' || !table.tHead || !table.tHead.rows.length) return;
  const heads = [...table.tHead.rows[0].cells].map(c => c.textContent.trim());
  table.classList.add('fc-stack');
  for (const body of table.tBodies) for (const row of body.rows) {
    let i = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan || 1;
      // Row headers (<th scope="row">) and spanning cells become the card's full-width title line.
      if (span > 1 || cell.tagName === 'TH') cell.classList.add('fc-full');
      else if (!cell.hasAttribute('data-label')) cell.setAttribute('data-label', heads[i] || '');
      i += span;
    }
  }
}
let queued = false;
const run = () => { queued = false; document.querySelectorAll('table').forEach(label); };
const later = () => { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(run); } };
if (typeof MutationObserver === 'function') new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', run);
run();
})();
