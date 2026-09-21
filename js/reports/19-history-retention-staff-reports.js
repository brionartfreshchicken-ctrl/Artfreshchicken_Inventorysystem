/* ===== js/reports/19-history-retention-staff-reports.js =====
   NOTE — this file covers several related areas that grew together during development rather than one single topic: Sales History & the Transactions table, History Retention, the Staff Directory / LPG Usage ("Others") page, Profit & Loss / Man Power reporting and its Detailed Report + Excel download, and the full "Download Everything" backup export. It's the one file in this split that isn't single-purpose — see the README for why.
   (Lines 3791-5721 of the original single-file build.) */

/* 14-history.js — Sales History page: daily/weekly/monthly totals and Plan History. */

let historyMode = 'daily';

let historyFrom = null, historyTo = null;   // ms, null = unbounded

/* Reads the two date boxes. 'To' covers the whole day, not just midnight. */

function readHistoryDates(){
  const f = document.getElementById('hs-from').value;
  const t = document.getElementById('hs-to').value;
  historyFrom = f ? new Date(f+'T00:00:00').getTime() : null;
  historyTo   = t ? new Date(t+'T23:59:59.999').getTime() : null;
  if(historyFrom != null && historyTo != null && historyFrom > historyTo){
    toast('The From date is after the To date', true);
  }
}

/* Every recorded sale inside the chosen dates */

function historySales(){
  return (state.activity||[]).filter(a =>
    (a.reason==='sold' && !a.voided) &&
    (historyFrom == null || a.ts >= historyFrom) &&
    (historyTo   == null || a.ts <= historyTo));
}

/* Everything inside the chosen dates, sales and stock movements alike */

function historyAllRecords(){
  return (state.activity||[]).filter(a =>
    (historyFrom == null || a.ts >= historyFrom) &&
    (historyTo   == null || a.ts <= historyTo));
}

function rangeLabel(){
  const fmt = ts => new Date(ts).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  if(historyFrom == null && historyTo == null) return 'All time';
  if(historyFrom != null && historyTo != null) return `${fmt(historyFrom)} – ${fmt(historyTo)}`;
  return historyFrom != null ? `From ${fmt(historyFrom)}` : `Up to ${fmt(historyTo)}`;
}

/* Works out which bucket a timestamp belongs to, plus that bucket's
   start, end, label and filename. */

function periodInfo(ts, mode){
  const d = new Date(ts); d.setHours(0,0,0,0);
  const DAY = 86400000;

  if(mode === 'weekly'){
    const offset = (d.getDay() + 6) % 7;              // Monday starts the week
    const mon = new Date(d); mon.setDate(d.getDate() - offset);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt = x => x.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return {
      key:'w'+mon.getTime(), start:mon.getTime(), end:sun.getTime()+DAY-1,
      label:`${fmt(mon)} – ${fmt(sun)}, ${sun.getFullYear()}`,
      file:`weekly-sales-${isoDate(mon)}`,
      title:'Weekly Sales Report'
    };
  }

  if(mode === 'monthly'){
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last  = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return {
      key:'m'+first.getTime(), start:first.getTime(), end:last.getTime()+DAY-1,
      label:first.toLocaleDateString(undefined,{month:'long',year:'numeric'}),
      file:`monthly-sales-${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}`,
      title:'Monthly Sales Report'
    };
  }

  return {
    key:'d'+d.getTime(), start:d.getTime(), end:d.getTime()+DAY-1,
    label:d.toLocaleDateString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric'}),
    file:`daily-sales-${isoDate(d)}`,
    title:'Daily Sales Report'
  };
}

function historyBuckets(){
  const sales = historySales();
  const map = {};
  sales.forEach(a=>{
    const p = periodInfo(a.ts, historyMode);
    map[p.key] ||= {...p, rows:[]};
    map[p.key].rows.push(a);
  });
  return Object.values(map).sort((a,b)=>b.start - a.start);   // newest first
}

/* ============================= TRANSACTIONS (per-sale Sales History) =============================
   Spec item 14. A Sale here is a header record capturing what the POS
   screen actually charged (subtotal, discount, total, payment method,
   cash/change) — separate from the per-line 'sold' activity rows, which
   remain the source of truth for stock and for every Report/Profitability
   number (those are unaffected by discount — see the hint on this page).
   Voiding a sale here also voids its linked activity lines (the ones
   tagged with this transaction's number as their reference) so the two
   stay in agreement, and gives the stock back. */

function paymentLabel(m){
  return {cash:'Cash', gcash:'GCash', card:'Card', other:'Other'}[m] || 'Cash';
}

let txnFrom = null, txnTo = null;

function readTxnDates(){
  const f = document.getElementById('txn-from').value;
  const t = document.getElementById('txn-to').value;
  txnFrom = f ? new Date(f+'T00:00:00').getTime() : null;
  txnTo   = t ? new Date(t+'T23:59:59.999').getTime() : null;
  if(txnFrom != null && txnTo != null && txnFrom > txnTo){
    toast('The From date is after the To date', true);
  }
}

function txnRows(){
  const all = (state.sales||[]).slice().sort((a,b)=>b.ts-a.ts);
  if(txnFrom == null && txnTo == null) return all;
  const from = txnFrom != null ? txnFrom : 0;
  const to   = txnTo   != null ? txnTo   : Date.now();
  return all.filter(s => s.ts >= from && s.ts <= to);
}

function txnPeriodLabel(){
  if(txnFrom == null && txnTo == null) return 'All time';
  const fmt = ms => new Date(ms).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  if(txnFrom != null && txnTo != null) return `${fmt(txnFrom)} – ${fmt(txnTo)}`;
  if(txnFrom != null) return `From ${fmt(txnFrom)}`;
  return `Up to ${fmt(txnTo)}`;
}

function renderTransactions(){
  const body = document.getElementById('tbl-transactions');
  if(!body) return;
  const list = txnRows();
  document.getElementById('txn-count').textContent =
    `${txnPeriodLabel()} · ${list.length} transaction${list.length===1?'':'s'}`;

  body.innerHTML = list.length ? list.map(s=>{
    const statusColor = s.status==='voided' ? 'var(--red)' : (s.status==='refunded' ? 'var(--yellow)' : 'var(--green)');
    const stLabel = s.status==='voided' ? 'Voided' : (s.status==='refunded' ? 'Refunded' : 'Completed');
    const itemsSummary = s.items.map(i=>`${i.qty}x ${i.name}`).join(', ');
    return `<tr${s.status!=='completed' ? ' style="opacity:.65;"' : ''}>
      <td>${escapeHtml(s.txnNumber)}</td>
      <td class="muted">${new Date(s.ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
      <td>${escapeHtml(s.cashier||'—')}</td>
      <td class="muted" title="${escapeHtml(itemsSummary)}">${s.items.length} item${s.items.length===1?'':'s'}</td>
      <td class="num">${peso(s.subtotal)}</td>
      <td class="num">${s.discount>0 ? peso(s.discount) : '—'}</td>
      <td class="num strong">${peso(s.total)}</td>
      <td><span class="cat-tag">${paymentLabel(s.paymentMethod)}</span></td>
      <td><span class="status-pill"><span class="dot" style="background:${statusColor};"></span>${stLabel}</span></td>
      <td>
        <button class="btn small" data-view-sale="${s.id}">View</button>
        ${(isAdmin() && s.status==='completed') ? `<button class="btn small danger" data-void-sale="${s.id}">Void</button>` : ''}
        ${isAdmin() ? `<button class="btn small ghost" data-del-sale="${s.id}" style="color:var(--red);">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="10">No transactions in this period.</td></tr>`;
}

/* ---- Download the Transactions table: one sheet per transaction header
   (what's shown on screen), plus a second sheet with every line item —
   product, qty, unit price — one row each, for anyone who needs the
   line-level detail behind a transaction. ---- */
async function downloadTransactionsReport(){
  const list = txnRows();
  if(!list.length) return toast('No transactions to download in this period', true);

  const statusLabelOf = s => s.status==='voided' ? 'Voided' : (s.status==='refunded' ? 'Refunded' : 'Completed');

  const txnSheet = list.map(s=>({
    'Transaction #': s.txnNumber, Date: new Date(s.ts).toLocaleString(), Cashier: s.cashier||'',
    'Product(s)': (s.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', '),
    Items: s.items.length, Subtotal: round2(s.subtotal), Discount: round2(s.discount),
    Total: round2(s.total), Payment: paymentLabel(s.paymentMethod),
    'Cash Received': s.cashReceived!=null ? round2(s.cashReceived) : '',
    Change: s.change!=null ? round2(s.change) : '',
    Status: statusLabelOf(s), 'Void Reason': s.voidReason||''
  }));

  const lineSheet = [];
  list.forEach(s=>{
    (s.items||[]).forEach(i=>{
      lineSheet.push({
        'Transaction #': s.txnNumber, Date: new Date(s.ts).toLocaleString(),
        Product: i.name, Qty: round2(i.qty), 'Unit Price': round2(i.unitPrice),
        'Line Total': round2(i.lineTotal), Status: statusLabelOf(s)
      });
    });
  });

  const sheets = { 'Transactions': txnSheet, 'Line Items': lineSheet };
  const filename = `transactions-${isoDate(new Date())}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows])=>{
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map(k=>({
        wch: Math.max(k.length+2, ...rows.map(r=>String(r[k] ?? '').length+2))
      }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(`${list.length} transaction${list.length===1?'':'s'} downloaded`);
    return;
  }

  let out = '';
  Object.entries(sheets).forEach(([name, rows])=>{
    out += `\n=== ${name} ===\n`;
    const cols = Object.keys(rows[0]);
    out += cols.join(',')+'\n';
    rows.forEach(r=>{
      out += cols.map(c=>{
        const v = String(r[c] ?? '');
        return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
      }).join(',')+'\n';
    });
  });
  const blob = new Blob([out], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

document.getElementById('btnDownloadTransactions').addEventListener('click', downloadTransactionsReport);

/* ---- Transactions: date range filter, shared by the table, the
   Download button, and Delete All below ---- */

['txn-from','txn-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ readTxnDates(); renderTransactions(); }));

document.getElementById('btnTxnReset').addEventListener('click', ()=>{
  document.getElementById('txn-from').value = '';
  document.getElementById('txn-to').value = '';
  readTxnDates();
  renderTransactions();
});

/* ---- Delete ALL transactions in range, permanently. Same shape as the
   Stock Movements "Delete All in Range": removes the sale header AND
   every activity/movement row linked to it, reverses stock for any that
   weren't already voided, and requires typing DELETE to confirm since
   it can affect many sales at once. Nothing survives — no Void tag, no
   trace in the Movement Log, Reports, or any export. ---- */

document.getElementById('btnDeleteAllTransactions').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Only an Admin can delete transactions', true);

  const sales = txnRows();
  if(!sales.length) return toast('No transactions to delete in this period', true);

  const saleIds = new Set(sales.map(s=>s.id));
  const txnNumbers = new Set(sales.map(s=>s.txnNumber));
  const linkedLines = (state.activity||[]).filter(a => a.reason==='sold' && txnNumbers.has(a.ref));
  const stillActive = linkedLines.filter(a => !a.voided);
  const everything = txnFrom == null && txnTo == null;

  openModal(everything ? 'Delete ALL transactions' : 'Delete transactions in range',
    `<div class="hint">Permanently delete <strong style="color:var(--text)">${sales.length}</strong>
       transaction${sales.length===1?'':'s'} from <strong style="color:var(--text)">${escapeHtml(txnPeriodLabel())}</strong>?</div>
     ${stillActive.length ? `<div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       ${stillActive.length} item${stillActive.length===1?'':'s'} across these sales ${stillActive.length===1?'has not':'have not'}
       been voided yet — deleting will also return ${stillActive.length===1?'it':'them'} to stock, the same as voiding would.
     </div>` : `<div class="hint" style="margin-top:12px;line-height:1.6;">
       All of these are already voided, so stock was already restored — deleting them now just clears the records.
     </div>`}
     <div class="hint" style="margin-top:12px;color:var(--red);line-height:1.6;">
       <strong>This cannot be undone.</strong> Nothing is kept — these transactions disappear from Sales History,
       the Movement Log, Reports, and every Excel export for good. Download what you need first.
     </div>
     <div class="field" style="margin-top:14px;"><label>Type DELETE to confirm</label>
       <input id="delalltxn-confirm" type="text" placeholder="DELETE"/></div>
     <div class="hint" id="delalltxn-err" style="margin-top:6px;color:var(--red);display:none;">Type DELETE (all caps) to confirm.</div>`,
    `<button class="btn ghost" id="delalltxn-cancel">Cancel</button>
     <button class="btn danger" id="delalltxn-ok">Delete Permanently</button>`);

  document.getElementById('delalltxn-cancel').addEventListener('click', closeModal);
  document.getElementById('delalltxn-ok').addEventListener('click', async ()=>{
    const confirmEl = document.getElementById('delalltxn-confirm');
    if(confirmEl.value.trim() !== 'DELETE'){
      document.getElementById('delalltxn-err').style.display = 'block';
      confirmEl.focus();
      return;
    }
    try{
      for(const s of sales) await dbDeleteSalePermanently(s.id);
    }catch(err){
      closeModal();
      return toast(err.message || 'Could not delete every transaction in range', true);
    }

    // Mirror what each delete_sale_permanently() call just did server-side.
    linkedLines.forEach(a=>{
      if(a.voided) return;
      reverseMovementStock(a);
    });
    const linkedIds = new Set(linkedLines.map(a=>a.id));
    state.activity = state.activity.filter(a => !linkedIds.has(a.id));
    state.sales = state.sales.filter(s => !saleIds.has(s.id));
    closeModal();
    saveState();
    renderAll();
    toast(`${sales.length} transaction${sales.length===1?'':'s'} permanently deleted`);
  });
});

function viewSaleDetail(sale){
  const body = `
    <div class="hint">Cashier: <strong style="color:var(--text)">${escapeHtml(sale.cashier||'—')}</strong></div>
    <div class="hint">Date: ${new Date(sale.ts).toLocaleString()}</div>
    <div class="hint">Payment: ${paymentLabel(sale.paymentMethod)}${sale.paymentMethod==='cash' ? ` — cash ${peso(sale.cashReceived)}, change ${peso(sale.change)}` : ''}</div>
    ${sale.status!=='completed' ? `<div class="hint" style="color:var(--red);">Status: ${sale.status==='voided'?'Voided':'Refunded'}${sale.voidReason?` — ${escapeHtml(sale.voidReason)} (${escapeHtml(sale.voidedBy||'—')})`:''}</div>` : ''}
    <table style="margin-top:12px;"><thead><tr>
      <th>Product</th><th>Qty</th><th class="num">Unit Price</th><th class="num">Line Total</th>
    </tr></thead><tbody>
      ${sale.items.map(i=>`<tr>
        <td>${escapeHtml(i.name)}</td>
        <td>${i.qty}</td>
        <td class="num">${peso(i.unitPrice)}</td>
        <td class="num">${peso(i.lineTotal)}</td>
      </tr>`).join('')}
    </tbody><tfoot>
      <tr class="total-row"><td colspan="3">Subtotal</td><td class="num">${peso(sale.subtotal)}</td></tr>
      ${sale.discount>0 ? `<tr class="total-row"><td colspan="3">Discount</td><td class="num">− ${peso(sale.discount)}</td></tr>` : ''}
      <tr class="total-row"><td colspan="3">TOTAL</td><td class="num strong">${peso(sale.total)}</td></tr>
    </tfoot></table>
  `;
  openModal(sale.txnNumber, body, `<button class="btn ghost" id="f-cancel">Close</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
}

function voidSale(saleId){
  if(!isAdmin()) return toast('Only an Admin can void a sale', true);
  const sale = state.sales.find(s=>s.id===saleId);
  if(!sale) return toast('That sale no longer exists', true);
  if(sale.status !== 'completed') return toast('That sale is already ' + sale.status, true);

  openModal('Void Sale',
    `<div class="hint">Void <strong style="color:var(--text)">${escapeHtml(sale.txnNumber)}</strong> —
       ${sale.items.length} item${sale.items.length===1?'':'s'}, ${peso(sale.total)}?</div>
     <div class="hint" style="margin-top:10px;color:var(--yellow);line-height:1.6;">
       Every item in this sale goes back into stock, and the sale drops out of Revenue and
       Profit totals. It stays visible here and in the Movement Log, marked Voided.
     </div>
     <div class="field" style="margin-top:14px;"><label>Reason for voiding (required)</label>
       <input id="voidsale-reason" type="text" placeholder="e.g. customer refund, rung up by mistake"/></div>
     <div class="hint" id="voidsale-err" style="margin-top:6px;color:var(--red);display:none;">A reason is required to void a sale.</div>`,
    `<button class="btn ghost" id="voidsale-cancel">Cancel</button>
     <button class="btn danger" id="voidsale-ok">Void Sale</button>`);

  document.getElementById('voidsale-cancel').addEventListener('click', closeModal);
  document.getElementById('voidsale-ok').addEventListener('click', async ()=>{
    const reasonEl = document.getElementById('voidsale-reason');
    const reason = reasonEl.value.trim();
    if(!reason){
      document.getElementById('voidsale-err').style.display = 'block';
      reasonEl.focus();
      return;
    }
    const by = currentUser ? currentUser.name : '—';
    const now = Date.now();

    try{
      await dbVoidSale(saleId, reason);
    }catch(err){
      return toast(err.message || 'Could not void that sale', true);
    }

    // Mirror what void_sale() just did server-side, for instant UI feedback.
    state.activity.forEach(a=>{
      if(a.ref !== sale.txnNumber || a.reason !== 'sold' || a.voided) return;
      reverseMovementStock(a);
      a.voided = true;
      a.voidReason = reason;
      a.voidedBy = by;
      a.voidedAt = now;
    });

    sale.status = 'voided';
    sale.voidReason = reason;
    sale.voidedBy = by;
    sale.voidedAt = now;

    closeModal();
    saveState();
    renderAll();
    toast(`${sale.txnNumber} voided — stock restored`);
  });
}

/* Permanent delete — removes the sale header AND every activity/movement
   row linked to it (matched by ref === txnNumber). If the sale hasn't
   been voided yet, deleting it also reverses stock for each of those
   lines first, same as voidSale would. If it's already voided, stock was
   reversed then, so this just clears the records out for good. Unlike
   Void, nothing is left behind — not here, not in the Movement Log, not
   in Reports or any export. */
function deleteSalePermanently(saleId){
  if(!isAdmin()) return toast('Only an Admin can delete a sale', true);
  const sale = state.sales.find(s=>s.id===saleId);
  if(!sale) return toast('That sale no longer exists', true);

  const linkedLines = state.activity.filter(a => a.ref === sale.txnNumber && a.reason === 'sold');
  const stillActive = linkedLines.filter(a => !a.voided);

  openModal('Delete Sale Permanently',
    `<div class="hint">Permanently delete <strong style="color:var(--text)">${escapeHtml(sale.txnNumber)}</strong> —
       ${sale.items.length} item${sale.items.length===1?'':'s'}, ${peso(sale.total)}?</div>
     ${stillActive.length
       ? `<div class="hint" style="margin-top:10px;color:var(--yellow);">This sale hasn't been voided yet — deleting it will also return ${stillActive.length} item${stillActive.length===1?'':'s'} to stock, the same as voiding would.</div>`
       : `<div class="hint" style="margin-top:10px;">This sale is already voided — its stock was already restored, so deleting it now only removes the records.</div>`}
     <div class="hint" style="margin-top:10px;color:var(--red);"><strong>This cannot be undone.</strong> Unlike Void, no trace of this sale is kept anywhere — not here, not in the Movement Log, Reports, or any Excel export.</div>`,
    `<button class="btn ghost" id="dels-cancel">Cancel</button>
     <button class="btn danger" id="dels-ok">Delete Permanently</button>`);

  document.getElementById('dels-cancel').addEventListener('click', closeModal);
  document.getElementById('dels-ok').addEventListener('click', async ()=>{
    try{
      await dbDeleteSalePermanently(saleId);
    }catch(err){
      return toast(err.message || 'Could not delete that sale', true);
    }

    // Mirror what delete_sale_permanently() just did server-side.
    linkedLines.forEach(a=>{
      if(!a.voided) reverseMovementStock(a);
    });
    const linkedIds = new Set(linkedLines.map(a=>a.id));
    state.activity = state.activity.filter(a => !linkedIds.has(a.id));
    state.sales = state.sales.filter(s => s.id !== saleId);

    closeModal();
    saveState();
    renderAll();
    toast(`${sale.txnNumber} permanently deleted`);
  });
}

document.getElementById('tbl-transactions').addEventListener('click', e=>{
  const viewBtn = e.target.closest('[data-view-sale]');
  if(viewBtn){
    const s = state.sales.find(x=>x.id===Number(viewBtn.dataset.viewSale));
    if(s) viewSaleDetail(s);
    return;
  }
  const voidBtn = e.target.closest('[data-void-sale]');
  if(voidBtn){ voidSale(Number(voidBtn.dataset.voidSale)); return; }
  const delBtn = e.target.closest('[data-del-sale]');
  if(delBtn) deleteSalePermanently(Number(delBtn.dataset.delSale));
});

function renderHistory(){
  const buckets = historyBuckets();
  const tbody = document.getElementById('tbl-history');
  const tfoot = document.getElementById('foot-history');

  // Let them know before the oldest records start rolling off
  const total = (state.activity||[]).length;
  const warnBox = document.getElementById('hs-capacity');
  if(total >= ACTIVITY_WARN){
    warnBox.style.display = 'block';
    warnBox.innerHTML = `<strong>${total.toLocaleString()}</strong> of ${ACTIVITY_CAP.toLocaleString()}
      records stored. Once full, the oldest are dropped as new ones arrive —
      download the history you want to keep, then clear old dates.`;
  }else{
    warnBox.style.display = 'none';
  }

  const unit = historyMode==='daily'?'day':historyMode==='weekly'?'week':'month';
  document.getElementById('hs-note').textContent = buckets.length
    ? `${rangeLabel()} · ${buckets.length} ${unit}${buckets.length===1?'':'s'} with sales`
    : rangeLabel();

  const filtered = historyFrom != null || historyTo != null;
  document.getElementById('btnDownloadAll').textContent = filtered ? '⬇ Download Range' : '⬇ Download All';

  if(!buckets.length){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${filtered
      ? 'No sales in these dates. Try a wider range.'
      : 'No sales recorded yet. Ring one up on the Sales page.'}</td></tr>`;
    tfoot.innerHTML = '';
    document.getElementById('btnDownloadAll').disabled = true;
    return;
  }
  document.getElementById('btnDownloadAll').disabled = false;

  let gB=0, gP=0, gU=0, gN=0;
  tbody.innerHTML = buckets.map(b=>{
    const benta = b.rows.reduce((t,a)=>t+lineBenta(a),0);
    const puh   = b.rows.reduce((t,a)=>t+linePuhunan(a),0);
    const units = b.rows.reduce((t,a)=>t+a.qty,0);
    gB+=benta; gP+=puh; gU+=units; gN+=b.rows.length;
    const tubo = benta-puh;
    return `<tr>
      <td class="name">${escapeHtml(b.label)}</td>
      <td>${b.rows.length}</td>
      <td>${Math.round(units*100)/100}</td>
      <td>${peso(benta)}</td>
      <td class="muted">${peso(puh)}</td>
      <td class="strong green-text">${peso(tubo)}</td>
      <td class="muted">${benta>0 ? (tubo/benta*100).toFixed(1)+'%' : '—'}</td>
      <td class="num"><button class="btn small" data-hdl="${b.key}" title="Download this period">⬇</button></td>
    </tr>`;
  }).join('');

  tfoot.innerHTML = `<tr class="total-row">
    <td>ALL TIME</td><td>${gN}</td><td>${Math.round(gU*100)/100}</td>
    <td class="strong">${peso(gB)}</td>
    <td class="strong">${peso(gP)}</td>
    <td class="strong green-text">${peso(gB-gP)}</td>
    <td>${gB>0 ? ((gB-gP)/gB*100).toFixed(1)+'%' : '—'}</td><td></td>
  </tr>`;
}

document.getElementById('hs-mode').addEventListener('change', e=>{
  historyMode = e.target.value;
  renderHistory();
});

/* Download one period */

document.getElementById('tbl-history').addEventListener('click', e=>{
  const btn = e.target.closest('[data-hdl]');
  if(!btn) return;
  const b = historyBuckets().find(x => x.key === btn.dataset.hdl);
  if(!b) return toast('That period is no longer available', true);
  downloadSalesReport(b.rows.slice().reverse(), b.title, b.label, b.file);
});

/* Download everything ever sold */

document.getElementById('btnDownloadAll').addEventListener('click', ()=>{
  const rows = historySales().slice().reverse();     // oldest first for reading
  if(!rows.length) return toast('No sales in this range', true);
  const filtered = historyFrom != null || historyTo != null;
  downloadSalesReport(rows,
    filtered ? 'Sales Report' : 'Complete Sales History',
    rangeLabel(),
    `sales-history-${isoDate(new Date())}`);
});

/* ---- Date controls ---- */

['hs-from','hs-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ readHistoryDates(); renderHistory(); }));

document.getElementById('btnHsReset').addEventListener('click', ()=>{
  document.getElementById('hs-from').value = '';
  document.getElementById('hs-to').value = '';
  readHistoryDates();
  renderHistory();
});

/* ---- Plan History's own date controls (separate from Sales History's) ---- */

['php-from','php-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ readPlanHistoryDates(); renderCosHistory(); }));

document.getElementById('btnPhpReset').addEventListener('click', ()=>{
  document.getElementById('php-from').value = '';
  document.getElementById('php-to').value = '';
  readPlanHistoryDates();
  renderCosHistory();
});

/* Quick pickers fill the two date boxes */

document.getElementById('hs-presets-card').addEventListener('click', e=>{
  const btn = e.target.closest('[data-preset]');
  if(!btn) return;
  const p = btn.dataset.preset;
  const from = document.getElementById('hs-from'), to = document.getElementById('hs-to');
  const today = new Date(); today.setHours(0,0,0,0);

  if(p === 'all'){ from.value = ''; to.value = ''; }
  else if(p === 'today'){ from.value = isoDate(today); to.value = isoDate(today); }
  else if(p === 'month'){
    from.value = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
    to.value   = isoDate(today);
  }
  else if(p === 'lastmonth'){
    from.value = isoDate(new Date(today.getFullYear(), today.getMonth()-1, 1));
    to.value   = isoDate(new Date(today.getFullYear(), today.getMonth(), 0));
  }
  else {                                   // 7 or 30 days, today included
    const start = new Date(today); start.setDate(today.getDate() - (Number(p)-1));
    from.value = isoDate(start);
    to.value   = isoDate(today);
  }
  readHistoryDates();
  renderHistory();
});

/* ---- Void history in range (was "Clear History" — see item 15: financial
   records are corrected, never erased. This marks matching records voided
   instead of deleting them; they drop out of every revenue/cost total but
   stay visible, tagged, in the Movement Log.) ---- */

document.getElementById('btnClearHistory').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Only an Admin can void history', true);

  const records = historyAllRecords().filter(a => !a.voided);
  if(!records.length) return toast('Nothing to void in this range', true);

  const sales = records.filter(a=>(a.reason==='sold' && !a.voided));
  const benta = sales.reduce((t,a)=>t+lineBenta(a),0);
  const everything = historyFrom == null && historyTo == null;

  openModal(everything ? 'Void ALL history' : 'Void history in range',
    `<div class="hint">This voids <strong style="color:var(--text)">${records.length}</strong>
       record${records.length===1?'':'s'} from <strong style="color:var(--text)">${escapeHtml(rangeLabel())}</strong>
       — ${sales.length} sale${sales.length===1?'':'s'} worth ${peso(benta)},
       plus ${records.length - sales.length} stock movement${records.length-sales.length===1?'':'s'}.</div>
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       Your current stock levels stay exactly as they are — this does not reverse stock.
       Correct individual items on the Products page if stock needs fixing too.
     </div>
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       Voided records drop out of Reports, Revenue and Profit totals, but stay visible in the
       Movement Log — marked Voided, with your name, the reason and the time. Nothing is deleted.
     </div>
     <div class="field" style="margin-top:14px;"><label>Reason for voiding (required)</label>
       <input id="clear-reason" type="text" placeholder="e.g. test data, duplicate import"/></div>
     <div class="hint" id="clear-err" style="margin-top:6px;color:var(--red);display:none;">A reason is required to void these records.</div>`,
    `<button class="btn ghost" id="clear-cancel">Cancel</button>
     <button class="btn danger" id="clear-ok">${everything ? 'Void everything' : 'Void these records'}</button>`);

  document.getElementById('clear-cancel').addEventListener('click', closeModal);
  document.getElementById('clear-ok').addEventListener('click', async ()=>{
    const reasonEl = document.getElementById('clear-reason');
    const reason = reasonEl.value.trim();
    if(!reason){
      document.getElementById('clear-err').style.display = 'block';
      reasonEl.focus();
      return;
    }
    const ids = records.map(a=>a.id);
    try{
      await dbVoidActivityRange(ids, reason);
    }catch(err){
      return toast(err.message || 'Could not void those records', true);
    }

    // Mirror what void_activity_range() just did server-side (no stock reversal).
    const idSet = new Set(ids);
    const by = currentUser ? currentUser.name : '—';
    const now = Date.now();
    state.activity.forEach(a=>{
      if(!idSet.has(a.id)) return;
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

/* ============================= ONE-TIME CODES =============================
   Codes are generated and shown on screen — there is no mail service wired
   up. That means anyone at this device can read the code, so treat it as a
   confirmation step, not a security control. The security question is what
   actually guards an account. */


/* ============================= HISTORY RETENTION =============================
   Records pile up. This deletes anything older than the chosen limit, once,
   when the system starts. It never touches stock levels — same reasoning as
   Clear History: it erases the record of what happened, not the result. */

const DAY_MS = 86400000;

function retentionDays(){ return Number(state.retentionDays) || 0; }

/* Oldest timestamp allowed to survive, or null when keeping everything */
function retentionCutoff(){
  const d = retentionDays();
  return d > 0 ? Date.now() - d * DAY_MS : null;
}

function recordsPastRetention(){
  const cut = retentionCutoff();
  if(!cut) return [];
  return (state.activity || []).filter(a => a.ts < cut);
}

/* Returns how many were removed. Runs at login (see enterApp() in
   07-login.js) and from the "Delete old records now" button. Deletes
   server-side via purge_old_activity() (0011/0019) so old records don't
   just come back on the next hydration — then re-fetches activity to
   reflect that locally. */
async function applyRetention(quiet){
  let removed;
  try{
    const { data, error } = await sb.rpc('purge_old_activity');
    if(error) throw error;
    removed = data || 0;
  }catch(err){
    if(!quiet) toast(err.message || 'Could not check retention', true);
    return 0;
  }
  if(!removed) return 0;

  await hydrateActivityTail();
  state.lastPurge = Date.now();
  saveState();

  if(!quiet) toast(`${removed} record${removed===1?'':'s'} older than ${retentionDays()} days deleted`);
  return removed;
}

function renderRetention(){
  const sel = document.getElementById('ret-days');
  if(!sel) return;
  if(document.activeElement !== sel) sel.value = String(retentionDays());

  const note = document.getElementById('ret-note');
  const last = document.getElementById('ret-last');
  const total = (state.activity || []).length;

  if(!retentionDays()){
    note.innerHTML = `Keeping everything — <strong>${total.toLocaleString()}</strong>
      record${total===1?'':'s'} stored. Nothing is deleted automatically.`;
  }else{
    const doomed = recordsPastRetention();
    const oldest = doomed.length
      ? new Date(Math.min(...doomed.map(a=>a.ts))).toLocaleDateString()
      : null;
    note.innerHTML = doomed.length
      ? `<span style="color:var(--red)"><strong>${doomed.length.toLocaleString()}</strong>
         of ${total.toLocaleString()} records are older than ${retentionDays()} days
         (back to ${oldest}) and will be deleted at the next start.</span>
         Download them from the History page first if you need them.`
      : `<span style="color:var(--green)">Nothing is past the limit yet.</span>
         All ${total.toLocaleString()} record${total===1?'':'s'} are within ${retentionDays()} days.`;
  }

  last.textContent = state.lastPurge
    ? `Last cleared ${new Date(state.lastPurge).toLocaleString()}`
    : 'Never cleared automatically';
}

/* ============================= OTHERS (Staff Directory + LPG Usage) =============================
   A shared page — both Admin and Staff see and can edit it. Two plain
   lists with no knock-on effects elsewhere: staff here are names on a
   roster, not login accounts, and LPG cost has no link to any other
   report — it is just kept somewhere sensible. */

/* Daily wages are normalized to a monthly figure (26 working days is the
   common assumption for PH small businesses) so Staff Directory and Man
   Power can show one comparable "monthly cost" number regardless of how
   each person is actually paid. Returns null if no wage is on file. */
function monthlyWage(s){
  if(s.wage == null || isNaN(s.wage)) return null;
  if(s.wagePeriod === 'month') return s.wage;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const dates = Array.isArray(s.workDates) ? s.workDates : [];
  const count = dates.filter(d => d.startsWith(ym)).length;
  return s.wage * count;
}

function renderOthers(){
  const staffBody = document.getElementById('tbl-staff');
  if(!staffBody) return;   // guard for any build that drops this page

  const staff = state.staffList || [];
  staffBody.innerHTML = staff.length
    ? staff.map(s=>{
        const mw = monthlyWage(s);
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const daysThisMonth = (s.workDates||[]).filter(d=>d.startsWith(ym)).length;
        const schedNote = (s.wage!=null && s.wagePeriod!=='month')
          ? `<div class="muted" style="font-size:11px;margin-top:2px;">${daysThisMonth} day${daysThisMonth===1?'':'s'} marked this month</div>`
          : '';
        return `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.position ? escapeHtml(s.position) : '<span class="muted">—</span>'}</td>
        <td class="num">${s.wage!=null ? peso(s.wage)+' / '+(s.wagePeriod==='month'?'mo':'day') : '<span class="muted">—</span>'}</td>
        <td class="num">${mw!=null ? peso(mw) : '<span class="muted">—</span>'}${schedNote}</td>
        <td class="num" style="white-space:nowrap;">
          <button class="btn small ghost" data-staff-edit="${s.id}" title="Edit ${escapeHtml(s.name)}">✎ Edit</button>
          <button class="btn small danger" data-staff-del="${s.id}" title="Remove ${escapeHtml(s.name)}">× Delete</button>
        </td>
      </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="5">No staff on file yet.</td></tr>`;

  const staffFoot = document.getElementById('foot-staff');
  if(staffFoot){
    const totalMonthly = staff.reduce((t,s)=>t+(monthlyWage(s)||0),0);
    staffFoot.innerHTML = staff.length
      ? `<tr class="total-row"><td colspan="3">TOTAL — ${staff.length} staff</td>
           <td class="num strong">${peso(totalMonthly)}</td><td></td></tr>`
      : '';
  }

  const lpgBody = document.getElementById('tbl-lpg');
  const lpgFoot = document.getElementById('foot-lpg');
  const logs = (state.lpgLogs || []).slice()
    .sort((a,b)=> String(b.dateStart||'').localeCompare(String(a.dateStart||'')));

  const DAY_MS = 86400000;
  const daysUsed = l=>{
    if(!l.dateStart || !l.dateEnd) return null;
    const d = Math.round((new Date(l.dateEnd) - new Date(l.dateStart)) / DAY_MS);
    return d >= 0 ? d : null;
  };
  const fmtDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString() : '';

  lpgBody.innerHTML = logs.length
    ? logs.map(l=>{
        const d = daysUsed(l);
        const perDay = (d && d > 0 && l.price != null) ? l.price / d : null;
        return `<tr>
          <td>${fmtDate(l.dateStart) || '<span class="muted">—</span>'}</td>
          <td>${l.dateEnd ? fmtDate(l.dateEnd) : '<span class="muted">still in use</span>'}</td>
          <td class="num">${d != null ? d + ' day' + (d===1?'':'s') : '<span class="muted">—</span>'}</td>
          <td class="num">${l.price != null ? peso(l.price) : '<span class="muted">—</span>'}</td>
          <td class="num">${perDay != null ? peso(perDay) : '<span class="muted">—</span>'}</td>
          <td class="num" style="white-space:nowrap;">
            <button class="btn small ghost" data-lpg-edit="${l.id}" title="Edit this record">✎ Edit</button>
            <button class="btn small danger" data-lpg-del="${l.id}" title="Delete this record">× Delete</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="6">No LPG usage recorded yet.</td></tr>`;

  if(logs.length){
    const total = logs.reduce((t,l)=>t+(l.price||0),0);
    const totalDays = logs.reduce((t,l)=>t+(daysUsed(l)||0),0);
    lpgFoot.innerHTML = `<tr class="total-row">
      <td colspan="2">TOTAL — ${logs.length} tank${logs.length===1?'':'s'}</td>
      <td class="num">${totalDays ? totalDays+' days' : '—'}</td>
      <td class="num strong">${peso(total)}</td>
      <td class="num">${totalDays>0 ? peso(total/totalDays) : '—'}</td>
      <td></td></tr>`;
  }else{
    lpgFoot.innerHTML = '';
  }
}

/* Admin-only: Product Profitability (Snacks/Drinks/Ingredients/Food, all-time
   sold history) and Food Costing Profitability (every food in every saved
   plan).

   Accounting rule (spec item 32): Net Profit is never computed as
   Revenue − Cost − Waste. The only profit figure shown is Gross Profit =
   Revenue − COGS. Waste and unsold servings are surfaced as their own
   columns/tiles for visibility, never netted into a profit figure — a
   real Net Profit needs Operating Expenses, which this build doesn't
   track yet (see Phase 5).
     - Products:      Gross Profit = Revenue − Cost. Waste is that item's
                       waste value, shown separately.
     - Food Costing:  Gross Profit = potential profit if every planned
                       serving sold (foodTotals().profit). Actual Profit =
                       what the plan actually made given servings sold
                       (foodTotals().actualProfit) — ingredient cost is
                       spent whether a serving sells or not, so this is a
                       second, realistic Gross Profit figure, not a
                       "Net Profit" in the accounting sense. */
function renderProfitability(){
  const prodBody = document.getElementById('tbl-profit-products');
  if(!prodBody) return;   // guard for any build without this page

  const perItem = {};
  (state.activity||[]).forEach(a=>{
    if(a.voided || (a.reason !== 'sold' && a.reason !== 'waste')) return;
    const k = a.itemId ?? a.name;
    perItem[k] ||= { name:a.name, category:a.category, revenue:0, puhunan:0, waste:0 };
    if(a.reason==='sold'){
      perItem[k].revenue += lineBenta(a);
      perItem[k].puhunan += linePuhunan(a);
    }else{
      perItem[k].waste += lineValue(a);
    }
  });
  const prodRows = Object.values(perItem).sort((a,b)=>b.revenue-a.revenue);

  prodBody.innerHTML = prodRows.length
    ? prodRows.map(r=>{
        const gross = r.revenue - r.puhunan;
        return `<tr>
          <td>${escapeHtml(r.name)}</td>
          <td><span class="cat-tag">${catLabel(r.category)}</span></td>
          <td class="num">${peso(r.revenue)}</td>
          <td class="num">${peso(r.puhunan)}</td>
          <td class="num strong" style="${gross<0?'color:var(--red)':'color:var(--green)'}">${peso(gross)}</td>
          <td class="num muted" style="${r.waste>0?'color:var(--red)':''}">${peso(r.waste)}</td>
          <td class="num muted">${r.revenue>0 ? (gross/r.revenue*100).toFixed(1)+'%' : '—'}</td>
        </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="7">No sales recorded yet.</td></tr>`;

  const prodFoot = document.getElementById('foot-profit-products');
  let pTotRev = 0, pTotPuh = 0, pTotGross = 0, pTotWaste = 0;
  if(prodRows.length){
    pTotRev = prodRows.reduce((t,r)=>t+r.revenue,0);
    pTotPuh = prodRows.reduce((t,r)=>t+r.puhunan,0);
    pTotWaste = prodRows.reduce((t,r)=>t+r.waste,0);
    pTotGross = pTotRev - pTotPuh;
    prodFoot.innerHTML = `<tr class="total-row">
      <td colspan="2">TOTAL — ${prodRows.length} product${prodRows.length===1?'':'s'}</td>
      <td class="num">${peso(pTotRev)}</td><td class="num">${peso(pTotPuh)}</td>
      <td class="num strong">${peso(pTotGross)}</td>
      <td class="num" style="${pTotWaste>0?'color:var(--red)':''}">${peso(pTotWaste)}</td>
      <td class="num">${pTotRev>0 ? (pTotGross/pTotRev*100).toFixed(1)+'%' : '—'}</td></tr>`;
  }else{
    prodFoot.innerHTML = '';
  }

  const foodBody = document.getElementById('tbl-profit-food');
  const foodFoot = document.getElementById('foot-profit-food');
  const foodRows = [];
  cosPlans().forEach(p=>{
    (p.foods||[]).forEach(f=>{
      foodRows.push({ plan: planLabel(p), food: f.name || 'Untitled', t: foodTotals(f) });
    });
  });

  foodBody.innerHTML = foodRows.length
    ? foodRows.map(r=>`<tr>
        <td class="muted">${escapeHtml(r.plan)}</td>
        <td>${escapeHtml(r.food)}</td>
        <td class="num">${peso(r.t.sales)}</td>
        <td class="num">${peso(r.t.cost)}</td>
        <td class="num strong">${peso(r.t.profit)}</td>
        <td class="num strong" style="${r.t.actualProfit<0?'color:var(--red)':'color:var(--green)'}">${peso(r.t.actualProfit)}</td>
        <td class="num muted">${r.t.sales>0 ? r.t.margin.toFixed(1)+'%' : '—'}</td>
      </tr>`).join('')
    : `<tr class="empty-row"><td colspan="7">No foods planned yet.</td></tr>`;

  let fTotSales = 0, fTotCost = 0, fTotGross = 0, fTotActual = 0, fTotSalesActual = 0;
  if(foodRows.length){
    fTotSales = foodRows.reduce((t,r)=>t+r.t.sales,0);
    fTotCost  = foodRows.reduce((t,r)=>t+r.t.cost,0);
    fTotGross = foodRows.reduce((t,r)=>t+r.t.profit,0);
    fTotActual = foodRows.reduce((t,r)=>t+r.t.actualProfit,0);
    fTotSalesActual = foodRows.reduce((t,r)=>t+r.t.actualSales,0);
    foodFoot.innerHTML = `<tr class="total-row">
      <td colspan="2">TOTAL — ${foodRows.length} food${foodRows.length===1?'':'s'}</td>
      <td class="num">${peso(fTotSales)}</td><td class="num">${peso(fTotCost)}</td>
      <td class="num strong">${peso(fTotGross)}</td>
      <td class="num strong">${peso(fTotActual)}</td>
      <td class="num">${fTotSales>0 ? (fTotGross/fTotSales*100).toFixed(1)+'%' : '—'}</td></tr>`;
  }else{
    foodFoot.innerHTML = '';
  }

  /* ---- Profit & Loss: Products + Food Costing combined ----
     Uses REALIZED figures throughout (actual sales, not "if everything
     sold") so Revenue, Cost and Gross Profit stay internally consistent:
     revenue − cost = gross always holds here. Net Profit now follows the
     spec exactly: Gross Profit − Operating Expenses = Net Profit. Waste
     stays separate — its accounting treatment was never specified, so it
     is shown but never subtracted into either profit figure. */
  const totalGrid = document.getElementById('statGridProfitTotal');
  if(totalGrid){
    const revenue = pTotRev + fTotSalesActual;
    const cost    = pTotPuh + fTotCost;
    const gross   = pTotGross + fTotActual;
    const waste   = pTotWaste;
    const totalExpenses = (state.expenses||[]).reduce((t,e)=>t+e.amount,0);
    const netProfit = gross - totalExpenses;
    totalGrid.innerHTML =
      statTile({tone:'cyan',    ic:'💵', label:'Revenue',      value:peso(revenue),
                note:'products + food costing, realized'}) +
      statTile({tone:'magenta', ic:'💰', label:'Cost',         value:peso(cost),
                note:'cost of goods sold'}) +
      statTile({tone:'green',   ic:'📈', label:'Gross Profit', value:peso(gross),
                note:'revenue minus COGS'}) +
      statTile({tone:'magenta', ic:'🧯', label:'Operating Expenses', value:peso(totalExpenses),
                note:'all-time, every category'}) +
      statTile({tone: netProfit>=0?'green':'red', ic:'🏆', label:'Net Profit',
                value:peso(netProfit), note:'Gross Profit minus Operating Expenses'}) +
      statTile({tone: waste>0?'red':'green', ic:'🗑', label:'Waste',
                value:peso(waste), note:'shown separately, not subtracted above'});

    /* ---- Man Power: labor cost against Gross Profit — a supporting
       view, not a substitute for the real Net Profit tile above ---- */
    const mpGrid = document.getElementById('statGridManpower');
    if(mpGrid){
      const staff = state.staffList || [];
      const laborCost = staff.reduce((t,s)=>t+(monthlyWage(s)||0),0);
      const afterLabor = gross - laborCost;
      mpGrid.innerHTML =
        statTile({tone:'blue', ic:'🧑‍🤝‍🧑', label:'Staff Count', value:staff.length,
                  note:'on the Staff Directory'}) +
        statTile({tone:'magenta', ic:'💰', label:'Monthly Labor Cost', value:peso(laborCost),
                  note:'wage × days marked this month, per staff'}) +
        statTile({tone: afterLabor>=0?'green':'red', ic:'🌿', label:'Gross Profit After Labor',
                  value:peso(afterLabor), note:"Gross Profit minus labor cost only"});
    }
  }
}

/* ---- Detailed Profit & Loss report: every product AND every food item,
   one row each, plus a category breakdown of Operating Expenses and a
   Man Power breakdown — so anyone can see exactly what adds up to the
   totals on the cards above. Recomputes the same per-item data
   renderProfitability() builds for the tables further down this page,
   just combined into one view, with an Excel/CSV download alongside it. */
function buildDetailedPLData(){
  const perItem = {};
  (state.activity||[]).forEach(a=>{
    if(a.voided || (a.reason !== 'sold' && a.reason !== 'waste')) return;
    const k = a.itemId ?? a.name;
    perItem[k] ||= { name:a.name, category:a.category, revenue:0, puhunan:0, waste:0 };
    if(a.reason==='sold'){
      perItem[k].revenue += lineBenta(a);
      perItem[k].puhunan += linePuhunan(a);
    }else{
      perItem[k].waste += lineValue(a);
    }
  });
  const productRows = Object.values(perItem).map(r=>({
    name: r.name, category: catLabel(r.category), revenue: r.revenue, cost: r.puhunan,
    gross: r.revenue - r.puhunan, waste: r.waste
  }));

  const foodRows = [];
  cosPlans().forEach(p=>{
    (p.foods||[]).forEach(f=>{
      const t = foodTotals(f);
      foodRows.push({
        name: `${f.name || 'Untitled'} (${planLabel(p)})`, category: 'Food Costing',
        revenue: t.actualSales, cost: t.cost, gross: t.actualProfit, waste: 0
      });
    });
  });

  const allRows = productRows.concat(foodRows).sort((a,b)=>b.revenue-a.revenue);
  const totRev = allRows.reduce((t,r)=>t+r.revenue,0);
  const totCost = allRows.reduce((t,r)=>t+r.cost,0);
  const totGross = allRows.reduce((t,r)=>t+r.gross,0);
  const totWaste = allRows.reduce((t,r)=>t+r.waste,0);

  const expByCategory = {};
  (state.expenses||[]).forEach(e=>{
    expByCategory[e.category] = (expByCategory[e.category]||0) + e.amount;
  });
  const expRows = Object.entries(expByCategory).sort((a,b)=>b[1]-a[1]);
  const totExpenses = expRows.reduce((t,[,v])=>t+v,0);
  const netProfit = totGross - totExpenses;

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const staffRows = (state.staffList||[]).map(s=>{
    const daysThisMonth = (s.workDates||[]).filter(d=>d.startsWith(ym)).length;
    return {
      name: s.name, position: s.position||'', wage: s.wage, per: s.wagePeriod,
      daysThisMonth: s.wagePeriod==='month' ? null : daysThisMonth,
      monthlyCost: monthlyWage(s)||0
    };
  });
  const totalLabor = staffRows.reduce((t,s)=>t+s.monthlyCost,0);
  const grossAfterLabor = totGross - totalLabor;

  return {allRows, totRev, totCost, totGross, totWaste, expRows, totExpenses, netProfit, staffRows, totalLabor, grossAfterLabor};
}

function openDetailedPLReport(){
  const d = buildDetailedPLData();

  const body = `
    <div class="hint" style="margin-bottom:10px;">Every product and food item that makes up Revenue, Cost and Gross Profit above.</div>
    <div style="max-height:280px;overflow-y:auto;">
      <table><thead><tr>
        <th>Item</th><th>Category</th><th class="num">Revenue</th><th class="num">Cost</th>
        <th class="num">Gross Profit</th><th class="num">Margin</th><th class="num">Waste</th>
      </tr></thead><tbody>
        ${d.allRows.length ? d.allRows.map(r=>`<tr>
          <td>${escapeHtml(r.name)}</td>
          <td><span class="cat-tag">${escapeHtml(r.category)}</span></td>
          <td class="num">${peso(r.revenue)}</td>
          <td class="num">${peso(r.cost)}</td>
          <td class="num strong" style="${r.gross<0?'color:var(--red)':''}">${peso(r.gross)}</td>
          <td class="num muted">${r.revenue>0 ? (r.gross/r.revenue*100).toFixed(1)+'%' : '—'}</td>
          <td class="num muted" style="${r.waste>0?'color:var(--red)':''}">${r.waste>0?peso(r.waste):'—'}</td>
        </tr>`).join('') : `<tr class="empty-row"><td colspan="7">No sales recorded yet.</td></tr>`}
      </tbody><tfoot><tr class="total-row">
        <td colspan="2">TOTAL — ${d.allRows.length} item${d.allRows.length===1?'':'s'}</td>
        <td class="num">${peso(d.totRev)}</td><td class="num">${peso(d.totCost)}</td>
        <td class="num strong">${peso(d.totGross)}</td><td></td>
        <td class="num" style="${d.totWaste>0?'color:var(--red)':''}">${d.totWaste>0?peso(d.totWaste):'—'}</td>
      </tr></tfoot></table>
    </div>

    <div class="hint" style="margin:16px 0 8px;font-weight:600;">Operating Expenses by category</div>
    <table><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>
      ${d.expRows.length ? d.expRows.map(([cat,amt])=>`<tr><td>${escapeHtml(cat)}</td><td class="num">${peso(amt)}</td></tr>`).join('')
        : `<tr class="empty-row"><td colspan="2">No expenses logged yet.</td></tr>`}
    </tbody><tfoot><tr class="total-row"><td>TOTAL</td><td class="num strong">${peso(d.totExpenses)}</td></tr></tfoot></table>

    <div class="hint" style="margin:16px 0 8px;font-weight:600;">Man Power</div>
    <table><thead><tr>
      <th>Staff</th><th>Position</th><th class="num">Wage</th><th>Per</th>
      <th class="num">Days This Month</th><th class="num">Monthly Cost</th>
    </tr></thead><tbody>
      ${d.staffRows.length ? d.staffRows.map(s=>`<tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.position?escapeHtml(s.position):'<span class="muted">—</span>'}</td>
        <td class="num">${s.wage!=null?peso(s.wage):'<span class="muted">—</span>'}</td>
        <td>${s.per==='month'?'Month':'Day'}</td>
        <td class="num">${s.daysThisMonth!=null?s.daysThisMonth:'<span class="muted">—</span>'}</td>
        <td class="num strong">${peso(s.monthlyCost)}</td>
      </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No staff on file yet.</td></tr>`}
    </tbody><tfoot><tr class="total-row"><td colspan="5">TOTAL LABOR</td><td class="num strong">${peso(d.totalLabor)}</td></tr></tfoot></table>

    <div class="hint" style="margin-top:16px;padding-top:12px;border-top:1px dashed var(--border);line-height:1.8;">
      Revenue <strong>${peso(d.totRev)}</strong> − Cost <strong>${peso(d.totCost)}</strong> =
      Gross Profit <strong>${peso(d.totGross)}</strong><br>
      Gross Profit <strong>${peso(d.totGross)}</strong> − Operating Expenses <strong>${peso(d.totExpenses)}</strong> =
      Net Profit <strong style="color:${d.netProfit>=0?'var(--green)':'var(--red)'}">${peso(d.netProfit)}</strong><br>
      <span class="muted">(Man Power is informational — Total Labor above only feeds Net Profit if also logged as an Operating Expense.)</span>
    </div>
  `;
  openModal('Detailed Profit & Loss Report', body,
    `<button class="btn ghost" id="f-cancel">Close</button>
     <button class="btn primary" id="btnDetailedPLDownload">⬇ Download Excel</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('btnDetailedPLDownload').addEventListener('click', downloadDetailedPLReport);
}

async function downloadDetailedPLReport(){
  const d = buildDetailedPLData();
  const filename = `detailed-pl-report-${isoDate(new Date())}`;

  const itemSheet = d.allRows.length ? d.allRows.map(r=>({
    Item:r.name, Category:r.category, Revenue:round2(r.revenue), Cost:round2(r.cost),
    'Gross Profit':round2(r.gross), Margin: r.revenue>0?round2(r.gross/r.revenue*100)+'%':'',
    Waste: round2(r.waste)
  })) : [{Note:'No sales recorded yet'}];

  const expenseSheet = d.expRows.length
    ? d.expRows.map(([cat,amt])=>({Category:cat, Amount:round2(amt)}))
    : [{Note:'No expenses logged yet'}];

  const staffSheetD = d.staffRows.length ? d.staffRows.map(s=>({
    Staff:s.name, Position:s.position, Wage: s.wage!=null?round2(s.wage):'',
    Per: s.per==='month'?'Month':'Day', 'Days This Month': s.daysThisMonth!=null?s.daysThisMonth:'',
    'Monthly Cost': round2(s.monthlyCost)
  })) : [{Note:'No staff on file yet'}];

  const summarySheet = [
    {Item:'Revenue', Value: round2(d.totRev)},
    {Item:'Cost (COGS)', Value: round2(d.totCost)},
    {Item:'Gross Profit', Value: round2(d.totGross)},
    {Item:'Operating Expenses', Value: round2(d.totExpenses)},
    {Item:'Net Profit', Value: round2(d.netProfit)},
    {Item:'Waste (not subtracted above)', Value: round2(d.totWaste)},
    {Item:'', Value:''},
    {Item:'Total Labor (Man Power)', Value: round2(d.totalLabor)},
    {Item:'Gross Profit After Labor', Value: round2(d.grossAfterLabor)}
  ];

  const sheets = {
    'Summary': summarySheet,
    'Item Profitability': itemSheet,
    'Operating Expenses': expenseSheet,
    'Man Power': staffSheetD
  };

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows])=>{
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map(k=>({
        wch: Math.max(k.length+2, ...rows.map(r=>String(r[k] ?? '').length+2))
      }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast('Detailed report downloaded');
    return;
  }

  let out = '';
  Object.entries(sheets).forEach(([name, rows])=>{
    out += `\n=== ${name} ===\n`;
    const cols = Object.keys(rows[0]);
    out += cols.join(',')+'\n';
    rows.forEach(r=>{
      out += cols.map(c=>{
        const v = String(r[c] ?? '');
        return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
      }).join(',')+'\n';
    });
  });
  const blob = new Blob([out], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

document.getElementById('btnDetailedPL').addEventListener('click', openDetailedPLReport);

/* ---- Staff Directory: add / edit / delete ---- */

/* Small month-view calendar used inside Add/Edit Staff — click a date to
   mark it as a day this staff member worked. Returns the inner HTML; the
   caller re-renders this into #staff-cal-box whenever the month changes
   or a date is toggled. */
function calendarGridHtml(year, month, selectedDates){
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const monthLabel = first.toLocaleDateString(undefined, {month:'long', year:'numeric'});
  const todayStr = isoDate(new Date());

  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const iso = isoDate(new Date(year, month, d));
    const isSelected = selectedDates.includes(iso);
    const isToday = iso === todayStr;
    cells += `<button type="button" class="cal-day${isSelected?' selected':''}${isToday?' today':''}" data-date="${iso}" title="${isSelected?'Worked — click to unmark':'Click to mark as worked'}">${d}</button>`;
  }

  return `
    <div class="cal-header">
      <button type="button" class="btn small ghost" id="cal-prev">‹</button>
      <div class="cal-month-label">${monthLabel}</div>
      <button type="button" class="btn small ghost" id="cal-next">›</button>
    </div>
    <div class="cal-grid cal-weekdays">${['S','M','T','W','T','F','S'].map(d=>`<div class="cal-wd">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
  `;
}

function openStaffModal(mode, staff){
  let staffWorkDates = (staff && Array.isArray(staff.workDates)) ? staff.workDates.slice() : [];
  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();   // 0-indexed

  const body = `
    <div class="field"><label>Staff Name</label>
      <input id="f-staff-name" type="text" placeholder="e.g. Maria Santos" value="${staff?escapeHtml(staff.name):''}"/></div>
    <div class="field"><label>Position</label>
      <input id="f-staff-pos" type="text" placeholder="e.g. Cashier, Cook" value="${staff?escapeHtml(staff.position||''):''}"/></div>
    <div class="field-row">
      <div class="field"><label>Wage</label>
        <input id="f-staff-wage" type="number" min="0" step="any" placeholder="0.00" value="${staff&&staff.wage!=null?staff.wage:''}"/></div>
      <div class="field"><label>Per</label>
        <select id="f-staff-wage-period">
          <option value="day"${staff&&staff.wagePeriod==='month'?'':' selected'}>Day</option>
          <option value="month"${staff&&staff.wagePeriod==='month'?' selected':''}>Month</option>
        </select></div>
    </div>
    <div class="field" id="wrap-workdays">
      <label>Work Calendar <span class="muted">(click the days this staff member actually worked)</span></label>
      <div id="staff-cal-box"></div>
    </div>
    <div class="hint" id="staff-workdays-hint" style="margin-top:8px;"></div>
    <div class="hint" style="margin-top:8px;">Monthly Cost on the Staff Directory and Man Power uses days marked in the <strong>current</strong> month. Leave wage blank if you don't want to track it.</div>
  `;
  const foot = `<button class="btn ghost" id="staff-cancel">Cancel</button>
    <button class="btn primary" id="staff-save">${mode==='add'?'Add Staff':'Save Changes'}</button>`;
  openModal(mode==='add' ? 'Add Staff' : 'Edit Staff', body, foot);
  document.getElementById('staff-cancel').addEventListener('click', closeModal);
  document.getElementById('f-staff-name').focus();

  function renderCal(){
    document.getElementById('staff-cal-box').innerHTML = calendarGridHtml(calYear, calMonth, staffWorkDates);
    document.getElementById('cal-prev').addEventListener('click', ()=>{
      calMonth--; if(calMonth<0){ calMonth=11; calYear--; }
      renderCal();
    });
    document.getElementById('cal-next').addEventListener('click', ()=>{
      calMonth++; if(calMonth>11){ calMonth=0; calYear++; }
      renderCal();
    });
    document.getElementById('staff-cal-box').querySelectorAll('[data-date]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const iso = btn.dataset.date;
        if(staffWorkDates.includes(iso)) staffWorkDates = staffWorkDates.filter(d=>d!==iso);
        else staffWorkDates.push(iso);
        renderCal();
        updateWorkdaysHint();
      });
    });
  }

  function updateWorkdaysHint(){
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const thisMonthCount = staffWorkDates.filter(d=>d.startsWith(ym)).length;
    document.getElementById('staff-workdays-hint').innerHTML =
      `<span class="calc-caption">🧮 Calculated automatically</span>${thisMonthCount} day${thisMonthCount===1?'':'s'} marked so far this month`;
  }

  function toggleWorkdaysVisibility(){
    const isMonth = document.getElementById('f-staff-wage-period').value === 'month';
    document.getElementById('wrap-workdays').style.display = isMonth ? 'none' : '';
    document.getElementById('staff-workdays-hint').style.display = isMonth ? 'none' : '';
  }

  document.getElementById('f-staff-wage-period').addEventListener('change', toggleWorkdaysVisibility);
  toggleWorkdaysVisibility();
  renderCal();
  updateWorkdaysHint();

  document.getElementById('staff-save').addEventListener('click', async ()=>{
    const name = document.getElementById('f-staff-name').value.trim();
    const position = document.getElementById('f-staff-pos').value.trim();
    const wageStr = document.getElementById('f-staff-wage').value;
    const wage = wageStr === '' ? null : Number(wageStr);
    const wagePeriod = document.getElementById('f-staff-wage-period').value;
    const workDates = staffWorkDates.slice().sort();
    if(!name) return toast('Enter a name', true);
    const data = { name, position, wage, wagePeriod, workDates };
    try{
      if(mode==='add'){
        const created = await dbInsertStaff(data);
        state.staffList.push(created);
        toast('Staff added');
      }else{
        const updated = await dbUpdateStaff(staff.id, data);
        Object.assign(staff, updated);
        toast('Staff updated');
      }
    }catch(err){
      toast(err.message || 'Could not save that staff record', true);
      return;
    }
    saveState();
    closeModal();
    renderOthers();
  });
}

document.getElementById('btnAddStaff').addEventListener('click', ()=>openStaffModal('add'));

document.getElementById('tbl-staff').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-staff-edit]');
  if(editBtn){
    const s = (state.staffList||[]).find(x=>x.id === Number(editBtn.dataset.staffEdit));
    if(s) openStaffModal('edit', s);
    return;
  }
  const delBtn = e.target.closest('[data-staff-del]');
  if(delBtn){
    const s = (state.staffList||[]).find(x=>x.id === Number(delBtn.dataset.staffDel));
    if(!s) return;
    confirmAction('Remove staff',
      `<div class="hint">Remove <strong style="color:var(--text)">${escapeHtml(s.name)}</strong> from the staff directory?</div>`,
      'Remove', async ()=>{
        try{
          await dbDeleteStaff(s.id);
        }catch(err){
          return toast(err.message || 'Could not remove that staff record', true);
        }
        state.staffList = state.staffList.filter(x=>x.id !== s.id);
        saveState();
        renderOthers();
        toast('Staff removed');
      });
  }
});

/* ---- LPG Usage: add / edit / delete ---- */

function openLpgModal(mode, log){
  const body = `
    <div class="field-row">
      <div class="field"><label>Date Start</label><input id="f-lpg-start" type="date" value="${log?log.dateStart||'':''}"/></div>
      <div class="field"><label>Date End</label><input id="f-lpg-end" type="date" value="${log&&log.dateEnd?log.dateEnd:''}"/></div>
    </div>
    <div class="hint" style="margin:-4px 0 12px;">Leave Date End blank if this tank is still in use.</div>
    <div class="field"><label>Price</label>
      <input id="f-lpg-price" type="number" min="0" step="any" placeholder="0.00" value="${log&&log.price!=null?log.price:''}"/></div>
  `;
  const foot = `<button class="btn ghost" id="lpg-cancel">Cancel</button>
    <button class="btn primary" id="lpg-save">${mode==='add'?'Add Record':'Save Changes'}</button>`;
  openModal(mode==='add' ? 'Add LPG Record' : 'Edit LPG Record', body, foot);
  document.getElementById('lpg-cancel').addEventListener('click', closeModal);
  document.getElementById('f-lpg-start').focus();

  document.getElementById('lpg-save').addEventListener('click', async ()=>{
    const dateStart = document.getElementById('f-lpg-start').value || null;
    const dateEnd   = document.getElementById('f-lpg-end').value || null;
    const priceStr  = document.getElementById('f-lpg-price').value;
    const price = priceStr === '' ? null : Number(priceStr);
    if(!dateStart) return toast('Enter a start date', true);
    if(dateEnd && dateEnd < dateStart) return toast('End date is before the start date', true);
    const data = { dateStart, dateEnd, price };
    try{
      if(mode==='add'){
        const created = await dbInsertLpg(data);
        state.lpgLogs.push(created);
        toast('LPG record added');
      }else{
        const updated = await dbUpdateLpg(log.id, data);
        Object.assign(log, updated);
        toast('LPG record updated');
      }
    }catch(err){
      toast(err.message || 'Could not save that LPG record', true);
      return;
    }
    saveState();
    closeModal();
    renderOthers();
  });
}

document.getElementById('btnAddLpg').addEventListener('click', ()=>openLpgModal('add'));

document.getElementById('tbl-lpg').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-lpg-edit]');
  if(editBtn){
    const l = (state.lpgLogs||[]).find(x=>x.id === Number(editBtn.dataset.lpgEdit));
    if(l) openLpgModal('edit', l);
    return;
  }
  const delBtn = e.target.closest('[data-lpg-del]');
  if(delBtn){
    const l = (state.lpgLogs||[]).find(x=>x.id === Number(delBtn.dataset.lpgDel));
    if(!l) return;
    confirmAction('Delete LPG record',
      `<div class="hint">Delete this LPG usage record? This cannot be undone.</div>`,
      'Delete', async ()=>{
        try{
          await dbDeleteLpg(l.id);
        }catch(err){
          return toast(err.message || 'Could not delete that record', true);
        }
        state.lpgLogs = state.lpgLogs.filter(x=>x.id !== l.id);
        saveState();
        renderOthers();
        toast('Record deleted');
      });
  }
});

/* ---- Admin-only: download Staff Directory + LPG Usage together ---- */

async function downloadOthersReport(){
  if(!isAdmin()) return toast('Only an Admin can download this report', true);

  const staff = state.staffList || [];
  const logs = (state.lpgLogs || []).slice()
    .sort((a,b)=> String(a.dateStart||'').localeCompare(String(b.dateStart||'')));

  if(!staff.length && !logs.length) return toast('Nothing to download yet', true);

  const DAY_MS = 86400000;
  const daysUsed = l=>{
    if(!l.dateStart || !l.dateEnd) return null;
    const d = Math.round((new Date(l.dateEnd) - new Date(l.dateStart)) / DAY_MS);
    return d >= 0 ? d : null;
  };
  const fmtDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString() : '';

  // One combined sheet, staff on top and LPG right below it, so the LPG
  // section is impossible to miss — no second tab to remember to click.
  const sheet = [];
  sheet.push(['STAFF DIRECTORY']);
  sheet.push(['Name','Position']);
  if(staff.length){
    staff.forEach(s => sheet.push([s.name, s.position || '']));
  }else{
    sheet.push(['No staff on file yet']);
  }
  sheet.push([]);
  sheet.push([]);
  sheet.push(['LPG USAGE']);
  sheet.push(['Date Start','Date End','Days Used','Price','Cost / Day']);
  if(logs.length){
    let totalPrice = 0, totalDays = 0;
    logs.forEach(l=>{
      const d = daysUsed(l);
      const perDay = (d && d > 0 && l.price != null) ? l.price / d : '';
      if(l.price != null) totalPrice += l.price;
      if(d) totalDays += d;
      sheet.push([
        fmtDate(l.dateStart),
        l.dateEnd ? fmtDate(l.dateEnd) : 'Still in use',
        d != null ? d : '',
        l.price != null ? round2(l.price) : '',
        perDay !== '' ? round2(perDay) : ''
      ]);
    });
    sheet.push([]);
    sheet.push(['', 'TOTAL', totalDays || '', round2(totalPrice), totalDays>0 ? round2(totalPrice/totalDays) : '']);
  }else{
    sheet.push(['No LPG usage recorded yet']);
  }

  const filename = `others-report-${isoDate(new Date())}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws['!cols'] = [{wch:22},{wch:16},{wch:12},{wch:10},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Others Report');
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast('Report downloaded — staff on top, LPG below it on the same sheet');
    return;
  }

  const csv = sheet.map(r => (r||[]).map(c=>{
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead (LPG section is further down the same file)');
}

document.getElementById('btnDownloadOthers').addEventListener('click', downloadOthersReport);

/* ---- Settings: download every report/record in the system, all-time,
   ignoring whatever date filters happen to be set on the Reports or
   History pages — this is meant to be a full, unconditional backup.
   Never includes account passwords or password hashes. ---- */
async function downloadEverything(){
  if(!isAdmin()) return toast('Only an Admin can download this', true);

  const all = state.activity || [];
  const sold = all.filter(a=>(a.reason==='sold' && !a.voided));
  const benta = sold.reduce((t,a)=>t+lineBenta(a),0);
  const puh   = sold.reduce((t,a)=>t+linePuhunan(a),0);
  const gastos = all.filter(a=>a.reason==='purchase').reduce((t,a)=>t+lineValue(a),0);
  const wasteV = all.filter(a=>(a.reason==='waste' && !a.voided)).reduce((t,a)=>t+lineValue(a),0);

  const summarySheet = [
    {Item:'Generated',    Value: new Date().toLocaleString()},
    {Item:'Generated by', Value: currentUser ? currentUser.name : '—'},
    {Item:'', Value:''},
    {Item:'Revenue (all-time sales)',              Value: round2(benta)},
    {Item:'Cost (cost of goods sold)',        Value: round2(puh)},
    {Item:'Profit (gross profit)',                 Value: round2(benta-puh)},
    {Item:'Margin %',                            Value: benta>0 ? round2((benta-puh)/benta*100) : 0},
    {Item:'', Value:''},
    {Item:'Expenses (restocking, all-time)',       Value: round2(gastos)},
    {Item:'Waste value (all-time)',              Value: round2(wasteV)},
    {Item:'', Value:''},
    {Item:'Total cost in stock now',          Value: round2(state.items.reduce((t,i)=>t+i.cost*i.stock,0))},
    {Item:'Items low or out of stock',           Value: state.items.filter(i=>getStatus(i)!=='in').length},
    {Item:'Staff on file',                       Value: (state.staffList||[]).length},
    {Item:'LPG records',                         Value: (state.lpgLogs||[]).length},
    {Item:'Food plans saved',                    Value: cosPlans().length}
  ];

  const perItem = {};
  sold.forEach(a=>{
    const k = a.itemId ?? a.name;
    perItem[k] ||= {Item:a.name, Category:catLabel(a.category), 'Qty Sold':0, Revenue:0, Cost:0};
    perItem[k]['Qty Sold'] += a.qty;
    perItem[k].Revenue   += lineBenta(a);
    perItem[k].Cost += linePuhunan(a);
  });
  const bestSheet = Object.values(perItem)
    .map(e=>({...e, Profit: round2(e.Revenue-e.Cost), Revenue: round2(e.Revenue),
              Cost: round2(e.Cost), 'Qty Sold': round2(e['Qty Sold'])}))
    .sort((a,b)=>b.Profit-a.Profit);

  const wasteSheet = all.filter(a=>(a.reason==='waste' && !a.voided)).map(a=>({
    When: new Date(a.ts).toLocaleString(), Item:a.name, Category:catLabel(a.category),
    Qty: round2(a.qty), Unit:a.unit, 'Cost/unit': a.cost ?? '',
    'Value lost': round2(lineValue(a)), By: a.by || ''
  }));

  const logSheet = all.map(a=>({
    When: new Date(a.ts).toLocaleString(), Item:a.name, Category:catLabel(a.category),
    Direction: a.type==='in' ? 'IN' : 'OUT', Reason: reasonLabel(a.reason),
    Qty: round2(a.qty), Unit:a.unit, 'Cost/unit': a.cost ?? '', 'Selling/unit': a.selling ?? '',
    Revenue: round2(lineBenta(a)), 'Stock value': round2(lineValue(a)), By: a.by || '',
    Reference: a.ref || '', Voided: a.voided ? `Yes — ${a.voidReason||''}` : ''
  }));

  const invSheet = state.items.map(i=>{
    const sup = (state.suppliers||[]).find(s=>s.id===i.supplierId);
    return {
      Product:i.name, SKU: i.sku||'', Size:i.size||'', Category:catLabel(i.category), Stock:i.stock, Unit:i.unit,
      'Cost/unit':i.cost, 'Selling/unit':i.selling ?? '',
      'Profit/unit': i.selling!=null ? round2(i.selling-i.cost) : '',
      'Total Cost': round2(i.cost*i.stock), 'Min Stock': i.threshold, 'Max Stock': i.maxStock ?? '',
      Supplier: sup ? sup.name : '', Status: statusLabel(getStatus(i))
    };
  });

  const restockSheet = state.items.filter(i=>getStatus(i)!=='in').map(i=>({
    Item: displayName(i), Category: catLabel(i.category), Left:i.stock, Unit:i.unit,
    'Alert At': i.threshold, 'Cost/unit': i.cost, Status: statusLabel(getStatus(i))
  }));

  const staffSheet = (state.staffList||[]).map(s=>{
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const daysThisMonth = (s.workDates||[]).filter(d=>d.startsWith(ym)).length;
    return {
      Name:s.name, Position:s.position||'',
      Wage: s.wage!=null ? round2(s.wage) : '',
      'Per': s.wage!=null ? (s.wagePeriod==='month'?'Month':'Day') : '',
      'Days Marked This Month': (s.wage!=null && s.wagePeriod!=='month') ? daysThisMonth : '',
      'Monthly Cost': monthlyWage(s)!=null ? round2(monthlyWage(s)) : ''
    };
  });

  const DAY_MS = 86400000;
  const daysUsed = l=>{
    if(!l.dateStart || !l.dateEnd) return null;
    const d = Math.round((new Date(l.dateEnd) - new Date(l.dateStart)) / DAY_MS);
    return d >= 0 ? d : null;
  };
  const fmtDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString() : '';
  const lpgSheet = (state.lpgLogs||[]).map(l=>{
    const d = daysUsed(l);
    const perDay = (d && d > 0 && l.price != null) ? l.price / d : null;
    return {
      'Date Start': fmtDate(l.dateStart),
      'Date End': l.dateEnd ? fmtDate(l.dateEnd) : 'Still in use',
      'Days Used': d != null ? d : '',
      Price: l.price != null ? round2(l.price) : '',
      'Cost / Day': perDay != null ? round2(perDay) : ''
    };
  });

  const perItem2 = {};
  all.forEach(a=>{
    if(a.voided || (a.reason !== 'sold' && a.reason !== 'waste')) return;
    const k = a.itemId ?? a.name;
    perItem2[k] ||= { Item:a.name, Category:catLabel(a.category), revenue:0, puhunan:0, waste:0 };
    if(a.reason==='sold'){ perItem2[k].revenue += lineBenta(a); perItem2[k].puhunan += linePuhunan(a); }
    else { perItem2[k].waste += lineValue(a); }
  });
  const prodProfitSheet = Object.values(perItem2).map(r=>{
    const gross = r.revenue - r.puhunan;
    return { Item:r.Item, Category:r.Category, Revenue: round2(r.revenue), Cost: round2(r.puhunan),
      'Gross Profit': round2(gross), Waste: round2(r.waste),
      Margin: r.revenue>0 ? round2(gross/r.revenue*100)+'%' : '—' };
  }).sort((a,b)=>b.Revenue-a.Revenue);

  const foodProfitSheet = [];
  cosPlans().forEach(p=>{
    (p.foods||[]).forEach(f=>{
      const t = foodTotals(f);
      foodProfitSheet.push({
        Plan: planLabel(p), Food: f.name || 'Untitled',
        Revenue: round2(t.sales), Cost: round2(t.cost),
        'Gross Profit': round2(t.profit), 'Actual Profit': round2(t.actualProfit),
        Margin: t.sales>0 ? round2(t.margin)+'%' : '—'
      });
    });
  });

  /* Every sale as its own line — not grouped by item, not summed into a
     total. Same source data as Best Sellers, just not added together,
     so you can see exactly which transaction made how much. */
  const salesDetailSheet = sold.map(a=>{
    const revenue = lineBenta(a), puhunan = linePuhunan(a);
    return {
      When: new Date(a.ts).toLocaleString(), Item: a.name, Category: catLabel(a.category),
      Qty: round2(a.qty), Unit: a.unit,
      'Selling Price/unit': a.selling ?? '', 'Cost/unit': a.cost ?? '',
      Revenue: round2(revenue), Cost: round2(puhunan),
      Profit: round2(revenue-puhunan), By: a.by || ''
    };
  });

  /* Every ingredient inside every food inside every plan — the numbers
     Food Plan Profitability adds up into one row per food, shown here
     unadded, one row per ingredient. */
  const foodPlanDetailSheet = [];
  cosPlans().forEach(p=>{
    (p.foods||[]).forEach(f=>{
      (f.lines||[]).forEach(l=>{
        foodPlanDetailSheet.push({
          Plan: planLabel(p), Food: f.name || 'Untitled', Ingredient: l.name || '',
          Quantity: l.qty || '', 'Unit Price': l.priceNum != null ? round2(l.priceNum) : '',
          'Total Cost': round2(l.total || 0)
        });
      });
    });
  });

  /* Man Power: revenue/gross profit don't apply to an individual staff
     member in this system (nothing attributes sales to one person), so
     this sheet gives the one number that IS real — labor cost — plus
     what Gross Profit looks like after paying it. Net Profit here uses
     Operating Expenses as actually logged, same as the Reports page —
     wages only count toward it if also logged there as a "Salaries"
     expense; the labor figures below are a separate, supporting view. */
  const totalRevenueAll = prodProfitSheet.reduce((t,r)=>t+r.Revenue,0) + foodProfitSheet.reduce((t,r)=>t+r.Revenue,0);
  const totalGrossAll   = prodProfitSheet.reduce((t,r)=>t+r['Gross Profit'],0) + foodProfitSheet.reduce((t,r)=>t+r['Actual Profit'],0);
  const totalWasteAll   = prodProfitSheet.reduce((t,r)=>t+r.Waste,0);
  const laborCostAll    = (state.staffList||[]).reduce((t,s)=>t+(monthlyWage(s)||0),0);
  const totalExpensesAll = (state.expenses||[]).reduce((t,e)=>t+e.amount,0);
  const manPowerSheet = [
    {Item:'Staff on file', Value: (state.staffList||[]).length},
    {Item:'Total Monthly Labor Cost', Value: round2(laborCostAll)},
    {Item:'', Value:''},
    {Item:'Revenue (products + food costing, realized)', Value: round2(totalRevenueAll)},
    {Item:'Gross Profit (Revenue - COGS)', Value: round2(totalGrossAll)},
    {Item:'Waste (not subtracted above)', Value: round2(totalWasteAll)},
    {Item:'Gross Profit After Labor', Value: round2(totalGrossAll - laborCostAll)},
    {Item:'Total Operating Expenses (all logged expenses)', Value: round2(totalExpensesAll)},
    {Item:'Net Profit (Gross Profit - Operating Expenses)', Value: round2(totalGrossAll - totalExpensesAll)}
  ];

  const expenseSheet = (state.expenses||[]).slice().sort((a,b)=>a.date-b.date).map(e=>({
    'Expense #': e.expenseNumber, Date: new Date(e.date).toLocaleDateString(), Category: e.category,
    Description: e.description||'', Amount: round2(e.amount), Payment: paymentLabel(e.paymentMethod),
    'Recorded By': e.recordedBy||'', Notes: e.notes||''
  }));

  const recipeSheet = (state.recipes||[]).map(r=>{
    const t = recipeTotals(r);
    const linked = r.linkedItemId ? byId(r.linkedItemId) : null;
    return {
      Recipe: r.name, Category: catLabel(r.category), Servings: r.servings,
      'Cost/Serving': round2(t.perServing), 'Selling Price': r.price!=null?round2(r.price):'',
      'Profit/Serving': t.profitPerServing!=null?round2(t.profitPerServing):'',
      Margin: t.margin!=null?round2(t.margin)+'%':'', 'Linked Item': linked?displayName(linked):''
    };
  });

  const productionSheet = [];
  (state.productions||[]).forEach(p=>{
    (p.ingredientsConsumed||[]).forEach(l=>{
      productionSheet.push({
        'Prod #': p.prodNumber, Date: new Date(p.date).toLocaleString(), Recipe: p.recipeName,
        'Qty Produced': round2(p.qtyProduced), Ingredient: l.name, 'Qty Used': round2(l.qty), Unit: l.unit,
        'Total Cost': round2(p.totalCost), 'Produced By': p.producedBy||''
      });
    });
  });

  const supplierSheet = (state.suppliers||[]).map(s=>{
    const productsSupplied = state.items.filter(i=>i.supplierId===s.id).length;
    const totalPurchases = (state.purchases||[]).filter(p=>p.supplierId===s.id).reduce((t,p)=>t+p.totalCost,0);
    return {
      Supplier: s.name, Contact: s.contact||'', Phone: s.phone||'', Email: s.email||'',
      Address: s.address||'', 'Products Supplied': productsSupplied,
      'Total Purchases': round2(totalPurchases), Status: s.status==='inactive'?'Inactive':'Active', Notes: s.notes||''
    };
  });

  const purchaseSheet = [];
  (state.purchases||[]).forEach(p=>{
    const sup = (state.suppliers||[]).find(s=>s.id===p.supplierId);
    (p.lines||[]).forEach(l=>{
      purchaseSheet.push({
        'PO #': p.poNumber, Date: new Date(p.createdAt).toLocaleString(),
        Supplier: sup?sup.name:'', Product: l.name, Qty: round2(l.qty), Unit: l.unit,
        'Unit Cost': round2(l.unitCost), 'Line Total': round2(l.qty*l.unitCost),
        'Received By': p.receivedBy||'', Notes: p.notes||''
      });
    });
  });

  const transactionSheet = (state.sales||[]).slice().sort((a,b)=>a.ts-b.ts).map(s=>({
    'Transaction #': s.txnNumber, Date: new Date(s.ts).toLocaleString(), Cashier: s.cashier||'',
    Items: s.items.length, Subtotal: round2(s.subtotal), Discount: round2(s.discount),
    Total: round2(s.total), Payment: paymentLabel(s.paymentMethod),
    'Cash Received': s.cashReceived!=null ? round2(s.cashReceived) : '',
    Change: s.change!=null ? round2(s.change) : '',
    Status: s.status==='voided'?'Voided':(s.status==='refunded'?'Refunded':'Completed'),
    'Void Reason': s.voidReason || ''
  }));

  const sheets = {
    'Summary': summarySheet,
    'Transactions': transactionSheet,
    'Sales Detail': salesDetailSheet,
    'Best Sellers': bestSheet,
    'Waste & Losses': wasteSheet,
    'Movement Log': logSheet,
    'Inventory': invSheet,
    'Restock List': restockSheet,
    'Suppliers': supplierSheet,
    'Purchases': purchaseSheet,
    'Recipes': recipeSheet,
    'Production': productionSheet,
    'Operating Expenses': expenseSheet,
    'Staff Directory': staffSheet,
    'Man Power': manPowerSheet,
    'LPG Usage': lpgSheet,
    'Product Profitability': prodProfitSheet,
    'Food Costing Profitability': foodProfitSheet,
    'Food Costing Detail': foodPlanDetailSheet
  };

  const filename = `foodtrack-full-backup-${isoDate(new Date())}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, data])=>{
      const rows = data.length ? data : [{Note:'No records'}];
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map(k=>({
        wch: Math.max(k.length+2, ...rows.map(r=>String(r[k] ?? '').length+2))
      }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast('Full backup downloaded');
    return;
  }

  let out = 'CONTENTS OF THIS BACKUP (scroll down for each — Ctrl+F the section name)\n';
  Object.entries(sheets).forEach(([name, data])=>{
    out += `${name},${data.length} row${data.length===1?'':'s'}\n`;
  });
  out += '\n';
  Object.entries(sheets).forEach(([name, data])=>{
    out += `\n=== ${name} ===\n`;
    if(!data.length){ out += 'No records\n'; return; }
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

document.getElementById('btnDownloadEverything').addEventListener('click', downloadEverything);

document.getElementById('btnSaveRetention').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Admins only', true);
  const days = Number(document.getElementById('ret-days').value) || 0;

  const commit = async ()=>{
    try{
      await dbUpdateSettings({ retentionDays: days });
    }catch(err){
      toast(err.message || 'Could not save that setting', true);
      return;
    }
    state.retentionDays = days;
    saveState();
    renderRetention();
    toast(days ? `Records older than ${days} days will be deleted` : 'Keeping all records');
  };

  if(!days) return commit();

  // Show the damage before agreeing to it
  const preview = (state.activity||[]).filter(a => a.ts < Date.now() - days*DAY_MS);
  const sold = preview.filter(a => (a.reason==='sold' && !a.voided));
  const benta = sold.reduce((t,a)=>t+lineBenta(a),0);

  confirmAction('Set retention limit',
    `<div class="hint">Records older than <strong style="color:var(--text)">${days} days</strong>
       will be deleted automatically each time the system starts.</div>
     ${preview.length ? `
     <div class="hint" style="margin-top:12px;color:var(--red);">
       <strong>${preview.length.toLocaleString()}</strong> existing record${preview.length===1?'':'s'}
       already fall outside that — ${sold.length} sale${sold.length===1?'':'s'} worth ${peso(benta)}.
       They go at the next start.
     </div>` : `
     <div class="hint" style="margin-top:12px;color:var(--green);">
       Nothing you have is past that limit yet.
     </div>`}
     <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
       Deleted records cannot be recovered, and your Reports totals for those
       dates will change. Stock levels are not affected.<br><br>
       Download what you need from the History page before this runs.
     </div>`,
    'Set limit', commit);
});

document.getElementById('btnPurgeNow').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Admins only', true);
  if(!retentionDays()) return toast('Set a limit first', true);

  const doomed = recordsPastRetention();
  if(!doomed.length) return toast('Nothing is past the limit', true);

  const sold = doomed.filter(a => (a.reason==='sold' && !a.voided));
  const benta = sold.reduce((t,a)=>t+lineBenta(a),0);

  confirmAction('Delete old records now',
    `<div class="hint">Delete <strong style="color:var(--text)">${doomed.length.toLocaleString()}</strong>
       record${doomed.length===1?'':'s'} older than ${retentionDays()} days —
       including ${sold.length} sale${sold.length===1?'':'s'} worth ${peso(benta)}?</div>
     <div class="hint" style="margin-top:12px;color:var(--yellow);">
       This cannot be undone. Stock levels stay exactly as they are.
     </div>`,
    'Delete them', async ()=>{
      const n = await applyRetention(true);
      renderAll();
      renderRetention();
      toast(`${n.toLocaleString()} old record${n===1?'':'s'} deleted`);
    });
});

document.getElementById('ret-days').addEventListener('change', ()=>{
  // preview the effect of the choice without committing to it
  const days = Number(document.getElementById('ret-days').value) || 0;
  const total = (state.activity||[]).length;
  const n = days ? (state.activity||[]).filter(a => a.ts < Date.now()-days*DAY_MS).length : 0;
  document.getElementById('ret-note').innerHTML = days
    ? `Press <strong>Save setting</strong> to apply. ${n.toLocaleString()} of
       ${total.toLocaleString()} records would fall outside ${days} days.`
    : `Press <strong>Save setting</strong> to keep everything.`;
});


/* A shortcut to the same setting, right where the reports are, because
   nobody thinks to look in Settings for it. */
function openRetentionModal(){
  if(!isAdmin()) return toast('Only an Admin can change this', true);

  const cur = retentionDays();
  const opts = [[0,'Keep forever'],[7,'7 days'],[30,'30 days'],[60,'60 days'],
                [90,'90 days (3 months)'],[180,'180 days (6 months)'],
                [365,'365 days (1 year)'],[730,'730 days (2 years)']];

  openModal('Auto-delete old reports', `
    <div class="hint" style="margin-bottom:14px;">
      Records older than the limit are deleted automatically each time the
      system starts. Stock levels are never affected.
    </div>
    <div class="field"><label>Delete records older than</label>
      <select id="rt-days">
        ${opts.map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}</option>`).join('')}
      </select></div>
    <div class="hint" id="rt-preview" style="margin-top:12px;"></div>
  `, `<button class="btn ghost" id="rt-cancel">Cancel</button>
      <button class="btn primary" id="rt-save">Save</button>`);

  const preview = ()=>{
    const d = Number(document.getElementById('rt-days').value) || 0;
    const total = (state.activity||[]).length;
    const box = document.getElementById('rt-preview');
    if(!d){
      box.innerHTML = `Keeping all <strong>${total.toLocaleString()}</strong> records.
        Nothing is deleted automatically.`;
      return;
    }
    const n = (state.activity||[]).filter(a => a.ts < Date.now() - d*DAY_MS);
    const sold = n.filter(a => (a.reason==='sold' && !a.voided));
    const benta = sold.reduce((t,a)=>t+lineBenta(a),0);
    box.innerHTML = n.length
      ? `<span style="color:var(--red)"><strong>${n.length.toLocaleString()}</strong> of
         ${total.toLocaleString()} records are already older than ${d} days —
         ${sold.length} sale${sold.length===1?'':'s'} worth ${peso(benta)}.
         They go when you save.</span><br><br>
         Export first if you need them.`
      : `<span style="color:var(--green)">Nothing you have is past ${d} days yet.</span>
         All ${total.toLocaleString()} records stay for now.`;
  };
  document.getElementById('rt-days').addEventListener('change', preview);
  preview();

  document.getElementById('rt-cancel').addEventListener('click', closeModal);
  document.getElementById('rt-save').addEventListener('click', ()=>{
    const d = Number(document.getElementById('rt-days').value) || 0;
    state.retentionDays = d;
    const removed = d ? applyRetention(true) : 0;
    saveState();
    closeModal();
    renderAll();
    renderRetention();
    toast(d
      ? `Older than ${d} days will be deleted${removed ? ` — ${removed.toLocaleString()} removed now` : ''}`
      : 'Keeping all records');
  });
}

document.getElementById('btnAutoDelete').addEventListener('click', openRetentionModal);
