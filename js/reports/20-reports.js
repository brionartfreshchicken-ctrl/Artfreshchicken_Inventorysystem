/* ===== js/reports/20-reports.js =====
   Reports page: Sales Summary, Best Sellers, Waste & Losses, Movement Log, and the Excel/CSV exports.
   (Lines 5722-6310 of the original single-file build.) */

/* 15-reports.js — Reports page: Sales Summary, Best Sellers, Waste & Losses, Movement Log, and the Excel/CSV exports. */

let reportFilters = { range:'7', cat:'all' };

// A custom From/To pair, set via the date boxes. Either or both may be
// null (unbounded on that side). When neither is set, the preset
// dropdown (reportFilters.range) decides the period instead.
let reportFrom = null, reportTo = null;

function readReportDates(){
  const f = document.getElementById('rp-from').value;
  const t = document.getElementById('rp-to').value;
  reportFrom = f ? new Date(f+'T00:00:00').getTime() : null;
  reportTo   = t ? new Date(t+'T23:59:59.999').getTime() : null;
  if(reportFrom != null && reportTo != null && reportFrom > reportTo){
    toast('The From date is after the To date', true);
  }
}

function reportRangeBounds(){
  if(reportFrom != null || reportTo != null){
    return { from: reportFrom != null ? reportFrom : 0, to: reportTo != null ? reportTo : Date.now() };
  }
  return { from: rangeStart(reportFilters.range), to: Date.now() };
}

/* Shown next to "Sales Summary" and written into the exported Excel file. */
function reportPeriodLabel(){
  if(reportFrom != null || reportTo != null){
    const fmt = ms => new Date(ms).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
    if(reportFrom != null && reportTo != null) return `${fmt(reportFrom)} – ${fmt(reportTo)}`;
    if(reportFrom != null) return `From ${fmt(reportFrom)}`;
    return `Up to ${fmt(reportTo)}`;
  }
  return {'1':'Today','7':'Last 7 days','30':'Last 30 days','0':'All time'}[reportFilters.range];
}

function rangeStart(days){
  if(Number(days) === 0) return 0;               // all time
  const d = new Date();
  d.setHours(0,0,0,0);                            // start of today
  d.setDate(d.getDate() - (Number(days) - 1));    // then walk back
  return d.getTime();
}

function reportRows(){
  const {from, to} = reportRangeBounds();
  return (state.activity||[]).filter(a =>
    a.ts >= from && a.ts <= to &&
    (reportFilters.cat === 'all' || a.category === reportFilters.cat)
  );
}

/* Movement Log's own From/To — independent of the Reports toolbar above
   it. Unset (both null) means "follow whatever Reports is showing";
   setting either narrows just this one table, without touching the
   Sales Summary / Best Sellers / By Category cards. */
let logFrom = null, logTo = null;

function readLogDates(){
  const f = document.getElementById('log-from').value;
  const t = document.getElementById('log-to').value;
  logFrom = f ? new Date(f+'T00:00:00').getTime() : null;
  logTo   = t ? new Date(t+'T23:59:59.999').getTime() : null;
  if(logFrom != null && logTo != null && logFrom > logTo){
    toast('The From date is after the To date', true);
  }
}

function logRows(){
  if(logFrom == null && logTo == null) return reportRows();
  const from = logFrom != null ? logFrom : 0;
  const to   = logTo   != null ? logTo   : Date.now();
  return (state.activity||[]).filter(a =>
    a.ts >= from && a.ts <= to &&
    (reportFilters.cat === 'all' || a.category === reportFilters.cat)
  );
}

function logPeriodLabel(){
  if(logFrom == null && logTo == null) return reportPeriodLabel();
  const fmt = ms => new Date(ms).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  if(logFrom != null && logTo != null) return `${fmt(logFrom)} – ${fmt(logTo)}`;
  if(logFrom != null) return `From ${fmt(logFrom)}`;
  return `Up to ${fmt(logTo)}`;
}

const lineBenta   = a => (a.voided || a.reason!=='sold' || a.selling==null) ? 0 : a.qty*a.selling;

const linePuhunan = a => (a.voided || a.reason!=='sold') ? 0 : a.qty*(a.cost||0);

const lineValue   = a => a.voided ? 0 : a.qty * (a.cost||0);

function renderReports(){
  const rows   = reportRows();
  const sold   = rows.filter(a => (a.reason==='sold' && !a.voided));
  const wasted = rows.filter(a => (a.reason==='waste' && !a.voided));

  const benta   = sold.reduce((t,a)=>t+lineBenta(a),0);
  const puhunan = sold.reduce((t,a)=>t+linePuhunan(a),0);
  const tubo    = benta - puhunan;
  const margin  = benta > 0 ? (tubo/benta*100) : 0;
  const wasteV  = wasted.reduce((t,a)=>t+lineValue(a),0);

  const label = reportPeriodLabel();
  document.getElementById('rp-period').textContent =
    `${label}${reportFilters.cat!=='all' ? ' · '+catLabel(reportFilters.cat)+'s' : ''}`;

  document.getElementById('rp-money').innerHTML =
    statTile({tone:'cyan',    ic:'🛒', label:'Revenue',   value:peso(benta),
              note:`${sold.length} sale${sold.length===1?'':'s'}`}) +
    statTile({tone:'magenta', ic:'💰', label:'Cost', value:peso(puhunan),
              note:'cost of what sold'}) +
    statTile({tone:'green',   ic:'🌿', label:'Profit',    value:peso(tubo),
              note:'revenue minus cost'}) +
    statTile({tone: margin>=30?'green':margin>=15?'yellow':'red',
              ic:'📊', label:'Margin', value:margin.toFixed(1)+'%',
              note:'profit per ₱1 of revenue'});

  /* ---- Best sellers ---- */
  const perItem = {};
  sold.forEach(a=>{
    const k = a.itemId ?? a.name;
    perItem[k] ||= {name:a.name, category:a.category, qty:0, benta:0, puhunan:0};
    const e = perItem[k];
    e.qty += a.qty; e.benta += lineBenta(a); e.puhunan += linePuhunan(a);
  });
  const best = Object.values(perItem).sort((a,b)=>(b.benta-b.puhunan)-(a.benta-a.puhunan));

  const bestBody = document.getElementById('tbl-best');
  const bestFoot = document.getElementById('foot-best');
  if(!best.length){
    bestBody.innerHTML = `<tr class="empty-row"><td colspan="7">No sales recorded in this period.</td></tr>`;
    bestFoot.innerHTML = '';
  }else{
    bestBody.innerHTML = best.map(e=>{
      const t = e.benta-e.puhunan;
      const m = e.benta>0 ? (t/e.benta*100).toFixed(1)+'%' : '—';
      return `<tr>
        <td>${escapeHtml(e.name)}</td>
        <td><span class="cat-tag">${catLabel(e.category)}</span></td>
        <td>${Math.round(e.qty*100)/100}</td>
        <td>${peso(e.benta)}</td>
        <td>${peso(e.puhunan)}</td>
        <td class="strong green-text">${peso(t)}</td>
        <td class="muted">${m}</td>
      </tr>`;
    }).join('');
    bestFoot.innerHTML = `<tr class="total-row">
      <td colspan="3">TOTAL — ${best.length} item${best.length===1?'':'s'} sold</td>
      <td class="strong">${peso(benta)}</td>
      <td class="strong">${peso(puhunan)}</td>
      <td class="strong green-text">${peso(tubo)}</td>
      <td></td></tr>`;
  }

  /* ---- By category ---- */
  const cats = {};
  sold.forEach(a=>{
    cats[a.category] ||= {qty:0, benta:0, puhunan:0};
    cats[a.category].qty += a.qty;
    cats[a.category].benta += lineBenta(a);
    cats[a.category].puhunan += linePuhunan(a);
  });
  const catRows = Object.entries(cats).sort((a,b)=>b[1].benta-a[1].benta);
  document.getElementById('tbl-bycat').innerHTML = catRows.length
    ? catRows.map(([c,e])=>`<tr>
        <td><span class="cat-tag">${catLabel(c)}</span></td>
        <td>${Math.round(e.qty*100)/100}</td>
        <td>${peso(e.benta)}</td>
        <td>${peso(e.puhunan)}</td>
        <td class="strong green-text">${peso(e.benta-e.puhunan)}</td>
        <td class="muted">${benta>0 ? (e.benta/benta*100).toFixed(1)+'%' : '—'}</td>
      </tr>`).join('')
    : `<tr class="empty-row"><td colspan="6">Nothing sold in this period.</td></tr>`;

  /* ---- Waste ---- */
  const wasteMap = {};
  wasted.forEach(a=>{
    const k = a.itemId ?? a.name;
    wasteMap[k] ||= {name:a.name, qty:0, val:0, unit:a.unit, last:0};
    wasteMap[k].qty += a.qty;
    wasteMap[k].val += lineValue(a);
    wasteMap[k].last = Math.max(wasteMap[k].last, a.ts);
  });
  const wasteRows = Object.values(wasteMap).sort((a,b)=>b.val-a.val);
  document.getElementById('tbl-waste').innerHTML = wasteRows.length
    ? wasteRows.map(w=>`<tr>
        <td>${escapeHtml(w.name)}</td>
        <td>${Math.round(w.qty*100)/100} <span class="muted">${escapeHtml(w.unit||'')}</span></td>
        <td class="strong" style="color:var(--red)">${peso(w.val)}</td>
        <td class="muted">${timeAgo(w.last)}</td>
      </tr>`).join('')
    : `<tr class="empty-row"><td colspan="4">No spoilage recorded. Good.</td></tr>`;
  document.getElementById('foot-waste').innerHTML = wasteRows.length
    ? `<tr class="total-row"><td colspan="2">TOTAL LOST</td>
       <td class="strong" style="color:var(--red)">${peso(wasteV)}</td><td></td></tr>` : '';

  /* ---- Movement log ---- */
  const logData = logRows();
  document.getElementById('rp-logcount').textContent =
    `${logPeriodLabel()} · ${logData.length} entr${logData.length===1?'y':'ies'}`;
  document.getElementById('tbl-log').innerHTML = logData.length
    ? logData.map(a=>{
        const origValue = a.reason==='sold' ? a.qty*(a.selling||0) : a.qty*(a.cost||0);
        const valueCell = a.voided
          ? `<span class="muted" style="text-decoration:line-through;">${peso(origValue)}</span>`
          : (a.reason==='sold' ? `<span class="green-text strong">${peso(lineBenta(a))}</span>` : peso(lineValue(a)));
        const reasonCell = `<span class="cat-tag">${escapeHtml(reasonLabel(a.reason))}</span>` +
          (a.ref ? ` <span class="muted" style="font-size:11px;" title="Reference">${escapeHtml(a.ref)}</span>` : '') +
          (a.voided ? ` <span class="cat-tag" style="color:var(--red);border-color:var(--red);" title="Voided by ${escapeHtml(a.voidedBy||'—')} — ${escapeHtml(a.voidReason||'')}">Voided</span>` : '');
        const actionCell = isAdmin()
          ? `${a.voided ? '' : `<button class="btn small danger" data-void="${a.id}" title="Void this record">Void</button> `}` +
            `<button class="btn small ghost" data-delperm="${a.id}" title="Permanently delete this record" style="color:var(--red);">Delete</button>` +
            (a.voided ? `<div class="muted" style="font-size:11px;margin-top:3px;">voided ${timeAgo(a.voidedAt)}</div>` : '')
          : (a.voided ? `<span class="muted" style="font-size:11.5px;">${timeAgo(a.voidedAt)}</span>` : '');
        return `<tr${a.voided ? ' style="opacity:.65;"' : ''}>
        <td class="muted">${new Date(a.ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
        <td>${escapeHtml(a.name)}</td>
        <td class="${a.type==='in'?'plus':'minus'}">${a.type==='in'?'+ IN':'− OUT'}</td>
        <td>${Math.round(a.qty*100)/100} <span class="muted">${escapeHtml(a.unit||'')}</span></td>
        <td>${reasonCell}</td>
        <td>${valueCell}</td>
        <td class="muted">${escapeHtml(a.by||'—')}</td>
        <td class="num">${actionCell}</td>
      </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="8">No movements in this period.</td></tr>`;

  /* ---- Restock list (current stock, not date filtered) ---- */
  const low = state.items
    .filter(i => getStatus(i)!=='in')
    .filter(i => reportFilters.cat==='all' || i.category===reportFilters.cat)
    .sort((a,b)=> (getStatus(a)==='out'?0:1) - (getStatus(b)==='out'?0:1));
  document.getElementById('tbl-restock').innerHTML = low.length
    ? low.map(i=>{
      const s = getStatus(i);
      return `<tr>
        <td>${escapeHtml(displayName(i))}</td>
        <td><span class="cat-tag">${catLabel(i.category)}</span></td>
        <td>${i.stock} <span class="muted">${escapeHtml(i.unit)}</span></td>
        <td class="muted">${i.threshold} ${escapeHtml(i.unit)}</td>
        <td>${peso(i.cost)}</td>
        <td><span class="status-pill"><span class="dot ${s}"></span>${statusLabel(s)}</span></td>
      </tr>`;
    }).join('')
    : `<tr class="empty-row"><td colspan="6">Everything is well stocked.</td></tr>`;
}

document.getElementById('rp-range').addEventListener('change', e=>{
  reportFilters.range = e.target.value;
  // Picking a preset again means "go back to preset mode" — drop any custom range.
  document.getElementById('rp-from').value = '';
  document.getElementById('rp-to').value = '';
  reportFrom = null; reportTo = null;
  renderReports();
});

document.getElementById('rp-cat').addEventListener('change', e=>{
  reportFilters.cat = e.target.value; renderReports();
});

['rp-from','rp-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ readReportDates(); renderReports(); }));

document.getElementById('btnRpReset').addEventListener('click', ()=>{
  document.getElementById('rp-from').value = '';
  document.getElementById('rp-to').value = '';
  readReportDates();
  renderReports();
});

/* ---------- Excel export ----------
   Builds a real .xlsx when the SheetJS library is available, and falls
   back to CSV (which Excel opens just as happily) when it is not. */

function buildReportSheets(){
  const rows   = reportRows();
  const sold   = rows.filter(a=>(a.reason==='sold' && !a.voided));
  const benta  = sold.reduce((t,a)=>t+lineBenta(a),0);
  const puh    = sold.reduce((t,a)=>t+linePuhunan(a),0);
  const gastos = rows.filter(a=>a.reason==='purchase').reduce((t,a)=>t+lineValue(a),0);
  const wasteV = rows.filter(a=>(a.reason==='waste' && !a.voided)).reduce((t,a)=>t+lineValue(a),0);
  const label  = reportPeriodLabel();

  const perItem = {};
  sold.forEach(a=>{
    const k = a.itemId ?? a.name;
    perItem[k] ||= {Item:a.name, Category:catLabel(a.category), 'Qty Sold':0, Revenue:0, Cost:0};
    perItem[k]['Qty Sold'] += a.qty;
    perItem[k].Revenue   += lineBenta(a);
    perItem[k].Cost += linePuhunan(a);
  });
  const best = Object.values(perItem)
    .map(e=>({...e, Profit: round2(e.Revenue-e.Cost),
              Revenue: round2(e.Revenue), Cost: round2(e.Cost),
              'Qty Sold': round2(e['Qty Sold'])}))
    .sort((a,b)=>b.Profit-a.Profit);

  const waste = rows.filter(a=>(a.reason==='waste' && !a.voided));

  return {
    'Summary': [
      {Item:'Report period',   Value: label},
      {Item:'Category filter', Value: reportFilters.cat==='all' ? 'All' : catLabel(reportFilters.cat)},
      {Item:'Generated',       Value: new Date().toLocaleString()},
      {Item:'Generated by',    Value: currentUser ? currentUser.name : '—'},
      {Item:'', Value:''},
      {Item:'Revenue (sales)',   Value: round2(benta)},
      {Item:'Cost (cost of goods sold)', Value: round2(puh)},
      {Item:'Profit (gross profit)',   Value: round2(benta-puh)},
      {Item:'Margin %',        Value: benta>0 ? round2((benta-puh)/benta*100) : 0},
      {Item:'', Value:''},
      {Item:'Expenses (restocking)', Value: round2(gastos)},
      {Item:'Waste value',     Value: round2(wasteV)},
      {Item:'Net cash (revenue - expenses)', Value: round2(benta-gastos)},
      {Item:'', Value:''},
      {Item:'Total cost in stock now', Value: round2(state.items.reduce((t,i)=>t+i.cost*i.stock,0))},
      {Item:'Items low or out of stock',  Value: state.items.filter(i=>getStatus(i)!=='in').length}
    ],
    'Best Sellers': best,
    'Waste & Losses': waste.map(a=>({
      When: new Date(a.ts).toLocaleString(),
      Item: a.name,
      Category: catLabel(a.category),
      Qty: round2(a.qty),
      Unit: a.unit,
      'Cost/unit': a.cost ?? '',
      'Value lost': round2(lineValue(a)),
      By: a.by || ''
    })),
    'Movement Log': rows.map(a=>({
      When: new Date(a.ts).toLocaleString(),
      Item: a.name,
      Category: catLabel(a.category),
      Direction: a.type==='in' ? 'IN' : 'OUT',
      Reason: reasonLabel(a.reason),
      Qty: round2(a.qty),
      Unit: a.unit,
      'Cost/unit': a.cost ?? '',
      'Selling/unit': a.selling ?? '',
      Revenue: round2(lineBenta(a)),
      'Stock value': round2(lineValue(a)),
      By: a.by || ''
    })),
    'Inventory': state.items.map(i=>({
      Product: i.name, Size: i.size || '', Category: catLabel(i.category),
      Stock: i.stock, Unit: i.unit,
      'Cost/unit': i.cost,
      'Selling/unit': i.selling ?? '',
      'Profit/unit': i.selling!=null ? round2(i.selling-i.cost) : '',
      'Total Cost': round2(i.cost*i.stock),
      'Alert At': i.threshold,
      Status: statusLabel(getStatus(i))
    })),
    'Restock List': state.items.filter(i=>getStatus(i)!=='in').map(i=>({
      Item: displayName(i), Category: catLabel(i.category),
      Left: i.stock, Unit: i.unit, 'Alert At': i.threshold,
      'Cost/unit': i.cost, Status: statusLabel(getStatus(i))
    }))
  };
}

async function exportReport(){
  const sheets = buildReportSheets();
  const d = new Date();
  const stampStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const filename = `cafeteria-report-${stampStr}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, data])=>{
      const rows = data.length ? data : [{Note:'No records for this period'}];
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map(k=>({
        wch: Math.max(k.length+2, ...rows.map(r=>String(r[k] ?? '').length+2))
      }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast('Excel report downloaded');
    return;
  }

  // CSV fallback — one file, sheets stacked with headings. Excel opens
  // this as a single sheet (no tabs), so a contents list up front makes
  // it obvious every section is actually in the file.
  let out = 'CONTENTS OF THIS REPORT (scroll down for each — Ctrl+F the section name)\n';
  Object.entries(sheets).forEach(([name, data])=>{
    out += `${name},${data.length} row${data.length===1?'':'s'}\n`;
  });
  out += '\n';
  Object.entries(sheets).forEach(([name, data])=>{
    out += `\n=== ${name} ===\n`;
    if(!data.length){ out += 'No records for this period\n'; return; }
    const cols = Object.keys(data[0]);
    out += cols.join(',')+'\n';
    data.forEach(r=>{
      out += cols.map(c=>{
        const v = String(r[c] ?? '');
        return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
      }).join(',')+'\n';
    });
  });
  const blob = new Blob([out], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead (see Contents list at the top)');
}

document.getElementById('btnExportExcel').addEventListener('click', exportReport);

/* ---- Movement Log: its own date filter, download, and clear ---- */

['log-from','log-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ readLogDates(); renderReports(); }));

document.getElementById('btnLogReset').addEventListener('click', ()=>{
  document.getElementById('log-from').value = '';
  document.getElementById('log-to').value = '';
  readLogDates();
  renderReports();
});

async function downloadMovementLog(){
  const data = logRows();
  if(!data.length) return toast('No movements in this period', true);
  const filename = `movement-log-${isoDate(new Date())}`;
  const rowsOut = data.map(a=>({
    When: new Date(a.ts).toLocaleString(),
    Item: a.name,
    Category: catLabel(a.category),
    Direction: a.type==='in' ? 'IN' : 'OUT',
    Reason: reasonLabel(a.reason),
    Qty: round2(a.qty),
    Unit: a.unit,
    Value: round2((a.reason==='sold' && !a.voided) ? lineBenta(a) : lineValue(a)),
    By: a.by || ''
  }));

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rowsOut);
    ws['!cols'] = Object.keys(rowsOut[0]).map(k=>({
      wch: Math.max(k.length+2, ...rowsOut.map(r=>String(r[k] ?? '').length+2))
    }));
    XLSX.utils.book_append_sheet(wb, ws, 'Movement Log');
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(`Downloaded ${data.length} record${data.length===1?'':'s'}`);
    return;
  }
  const cols = Object.keys(rowsOut[0]);
  const csv = [cols.join(',')].concat(rowsOut.map(r=>cols.map(c=>{
    const v = String(r[c] ?? '');
    return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }).join(','))).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

document.getElementById('btnDownloadLog').addEventListener('click', downloadMovementLog);

/* ---- Void movements in range (was "Clear" — see item 15). Same pattern
   as btnClearHistory above, scoped to whatever the Movement Log's own
   date filter is currently showing. ---- */

document.getElementById('btnClearLog').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Only an Admin can void the log', true);

  const records = logRows().filter(a => !a.voided);
  if(!records.length) return toast('Nothing to void in this range', true);

  const sales = records.filter(a=>(a.reason==='sold' && !a.voided));
  const everything = logFrom == null && logTo == null;

  openModal(everything ? 'Void ALL movements' : 'Void movements in range',
    `<div class="hint">This voids <strong style="color:var(--text)">${records.length}</strong>
       record${records.length===1?'':'s'} from <strong style="color:var(--text)">${escapeHtml(logPeriodLabel())}</strong>
       — ${sales.length} sale${sales.length===1?'':'s'}, plus
       ${records.length - sales.length} other movement${records.length-sales.length===1?'':'s'}.</div>
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       Your current stock levels stay exactly as they are — this does not reverse stock.
     </div>
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       Voided records drop out of Reports, Revenue and Profit totals, but stay visible in the
       Movement Log — marked Voided, with your name, the reason and the time. Nothing is deleted.
     </div>
     <div class="field" style="margin-top:14px;"><label>Reason for voiding (required)</label>
       <input id="clearlog-reason" type="text" placeholder="e.g. test data, duplicate import"/></div>
     <div class="hint" id="clearlog-err" style="margin-top:6px;color:var(--red);display:none;">A reason is required to void these records.</div>`,
    `<button class="btn ghost" id="clearlog-cancel">Cancel</button>
     <button class="btn danger" id="clearlog-ok">${everything ? 'Void everything' : 'Void these records'}</button>`);

  document.getElementById('clearlog-cancel').addEventListener('click', closeModal);
  document.getElementById('clearlog-ok').addEventListener('click', ()=>{
    const reasonEl = document.getElementById('clearlog-reason');
    const reason = reasonEl.value.trim();
    if(!reason){
      document.getElementById('clearlog-err').style.display = 'block';
      reasonEl.focus();
      return;
    }
    const ids = new Set(records.map(a=>a.id));
    const by = currentUser ? currentUser.name : '—';
    const now = Date.now();
    state.activity.forEach(a=>{
      if(!ids.has(a.id)) return;
      a.voided = true;
      a.voidReason = reason;
      a.voidedBy = by;
      a.voidedAt = now;
    });
    closeModal();
    saveState();
    renderAll();
    toast(`${records.length} record${records.length===1?'':'s'} voided`);
  });
});

/* ---- Delete ALL movements in range, permanently. Same range as
   "Void in Range" above, but nothing survives — no Voided tag, no
   audit trail, gone from the Movement Log, Reports, and every export.
   Records still active (not yet voided) also have their stock effect
   reversed first, the same as deleting one at a time would. ---- */

document.getElementById('btnDeleteAllLog').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Only an Admin can delete records', true);

  const records = logRows();
  if(!records.length) return toast('Nothing to delete in this range', true);

  const stillActive = records.filter(a => !a.voided);
  const everything = logFrom == null && logTo == null;

  openModal(everything ? 'Delete ALL movements' : 'Delete movements in range',
    `<div class="hint">Permanently delete <strong style="color:var(--text)">${records.length}</strong>
       record${records.length===1?'':'s'} from <strong style="color:var(--text)">${escapeHtml(logPeriodLabel())}</strong>?</div>
     ${stillActive.length ? `
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       ${stillActive.length} of these ${stillActive.length===1?'is':'are'} not voided yet — deleting will also
       reverse ${stillActive.length===1?'its':'their'} stock effect, the same as voiding would.
     </div>` : `
     <div class="hint" style="margin-top:12px;line-height:1.6;">
       All of these are already voided, so their stock effect was already reversed — deleting them now just clears the records.
     </div>`}
     <div class="hint" style="margin-top:12px;color:var(--red);line-height:1.6;">
       <strong>This cannot be undone.</strong> Unlike Void, nothing is kept — these records disappear from
       the Movement Log, Reports, and every Excel export for good. Download what you need first.
     </div>
     <div class="field" style="margin-top:14px;"><label>Type DELETE to confirm</label>
       <input id="deleteall-confirm" type="text" placeholder="DELETE"/></div>
     <div class="hint" id="deleteall-err" style="margin-top:6px;color:var(--red);display:none;">Type DELETE (all caps) to confirm.</div>`,
    `<button class="btn ghost" id="deleteall-cancel">Cancel</button>
     <button class="btn danger" id="deleteall-ok">Delete Permanently</button>`);

  document.getElementById('deleteall-cancel').addEventListener('click', closeModal);
  document.getElementById('deleteall-ok').addEventListener('click', ()=>{
    const confirmEl = document.getElementById('deleteall-confirm');
    if(confirmEl.value.trim() !== 'DELETE'){
      document.getElementById('deleteall-err').style.display = 'block';
      confirmEl.focus();
      return;
    }
    records.forEach(a=>{
      if(a.voided) return;
      reverseMovementStock(a);
    });
    const ids = new Set(records.map(a=>a.id));
    state.activity = state.activity.filter(a => !ids.has(a.id));
    closeModal();
    saveState();
    renderAll();
    toast(`${records.length} record${records.length===1?'':'s'} permanently deleted`);
  });
});

/* ============================= SALES (POINT OF SALE) =============================
   This is what feeds the Sales Summary on the Reports page. Completing a
   sale writes one 'sold' movement per line, which is the only thing the
   reports count as benta. */
