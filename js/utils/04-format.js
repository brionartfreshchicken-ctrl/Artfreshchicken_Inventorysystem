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

/* Recipe/cooking quantities are often written as fractions rather than
   decimals — accepts a plain number, a simple fraction ("1/2"), a mixed
   number ("1 1/2" or "1-1/2"), or a fraction glyph ("½", "1½"), and
   returns a decimal. Returns NaN (same as a failed parseFloat) for
   anything else, so existing isNaN() checks at every call site keep
   working unchanged. */
const FRACTION_GLYPHS = {
  '¼':0.25, '½':0.5, '¾':0.75, '⅓':1/3, '⅔':2/3,
  '⅕':0.2, '⅖':0.4, '⅗':0.6, '⅘':0.8,
  '⅙':1/6, '⅚':5/6, '⅛':0.125, '⅜':0.375, '⅝':0.625, '⅞':0.875
};

function parseQtyInput(raw){
  const s = String(raw ?? '').trim();
  if(s === '') return NaN;
  if(/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);

  let m = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);           // "3/4"
  if(m) return Number(m[1]) / Number(m[2]);

  m = s.match(/^(-?\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);    // "1 1/2" or "1-1/2"
  if(m){
    const whole = Number(m[1]), num = Number(m[2]), den = Number(m[3]);
    return whole + (whole < 0 ? -1 : 1) * (num / den);
  }

  if(FRACTION_GLYPHS[s] != null) return FRACTION_GLYPHS[s];  // "½"

  m = s.match(/^(-?\d+)\s*([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/);       // "1½"
  if(m && FRACTION_GLYPHS[m[2]] != null) return Number(m[1]) + FRACTION_GLYPHS[m[2]];

  return NaN;
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
