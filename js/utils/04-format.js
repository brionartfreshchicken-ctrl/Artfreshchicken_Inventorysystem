/* ===== js/utils/04-format.js =====
   Small formatting helpers: currency (peso), HTML escaping, dates.
   (Lines 406-510 of the original single-file build.) */

/* 04-format.js — Small formatting helpers: currency (peso), HTML escaping, dates. */

function peso(n){
  if(n===null || n===undefined) return '—';
  const v = Math.round(n*100)/100;
  return '₱' + (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getStatus(item){
  if(item.stock<=0) return 'out';
  if(item.stock<=item.threshold) return 'low';
  return 'in';
}

function statusLabel(s){ return s==='in'?'In Stock':s==='low'?'Low Stock':'Out of Stock'; }

function catLabel(c){
  return {snack:'Snack', drink:'Drink', food:'Food', ingredient:'Ingredient'}[c] || 'Item';
}

function tubo(item){ return item.selling!=null ? (item.selling - item.cost) : null; }

function totalTubo(item){ const t = tubo(item); return t!=null ? t*item.stock : null; }

/* PUHUNAN = what one unit costs you.
   TOTAL PUHUNAN = that cost multiplied by how many you have on hand,
   i.e. the money currently tied up in that item. */

function totalPuhunan(item){ return item.cost * item.stock; }

/* SIZE helpers. size is optional — an empty string means the product
   only comes one way, so nothing extra is shown. */

function sizeOf(item){ return (item.size || '').trim(); }

function displayName(item){
  const s = sizeOf(item);
  return s ? `${item.name} (${s})` : item.name;
}

/* If another line has the exact same name and size, tag the price on so
   dropdowns don't show two identical-looking options. */

function pickerLabel(i){
  const nm = displayName(i).toLowerCase();
  const dupes = state.items.filter(x => displayName(x).toLowerCase() === nm);
  if(dupes.length <= 1) return displayName(i);
  return `${displayName(i)} @ ${peso(i.cost)}${i.selling!=null ? ' / '+peso(i.selling) : ''}`;
}

function sizeCell(item){
  const s = sizeOf(item);
  return s ? `<span class="size-tag">${escapeHtml(s)}</span>` : `<span class="muted">—</span>`;
}

/* Adds up a column across a list of items */

function sumBy(items, fn){ return items.reduce((a,i)=>{ const v = fn(i); return a + (v||0); }, 0); }

function byId(id){ return state.items.find(i=>i.id===id); }

function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'just now';
  const m = Math.floor(s/60); if(m<60) return m+'m ago';
  const h = Math.floor(m/60); if(h<24) return h+'h ago';
  const d = Math.floor(h/24); return d+'d ago';
}

function round2(n){ return Math.round((Number(n)||0)*100)/100; }

const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function firstNumber(v){
  const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/* Quantity x unit price, filled in for you. Most rows work this way, but not
   all — a 3-piece bay leaf pack still costs one pack — so typing in Total
   Cost locks that row to manual and auto-fill leaves it alone. */


/* One place that builds a stat tile, so the icon, label, value and caption
   can never drift apart again.
     tone  — cyan | rose | blue | yellow | green | magenta | red
     note  — optional caption under the value                        */
function statTile({tone='', ic='•', label='', value='', note='', nav=null, status='all'}){
  const clickable = nav
    ? ` data-stat-nav="${nav}" data-stat-status="${status}" tabindex="0" role="button" aria-label="${escapeHtml(label)} — open ${nav}"`
    : '';
  return `<div class="stat-box ${tone}${nav ? ' stat-clickable' : ''}"${clickable}>
      <div class="stat-ic">${ic}</div>
      <div class="stat-txt">
        <p class="label">${label}</p>
        <p class="value">${value}</p>
        ${note ? `<p class="note">${note}</p>` : ''}
      </div>
    </div>`;
}
