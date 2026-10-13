/* ===== js/settings/25-cashier-names.js =====
   "Served By" roster: a short list of plain names (not full accounts)
   an Admin maintains in Settings, so a sale can record who actually
   handled it — useful on a shared terminal where everyone checks out
   under one Staff login. Paired with servedByEnabled in Settings and
   the POS checkout dropdown in 18-pos.js. */

function renderCashierNamesList(){
  const box = document.getElementById('cn-list');
  if(!box) return;
  const names = state.cashierNames || [];
  box.innerHTML = names.length
    ? names.map(n => `
        <span class="chip" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:16px;background:var(--panel2);font-size:12.5px;font-weight:600;">
          ${escapeHtml(n.name)}
          <button data-cn-remove="${n.id}" title="Remove" style="border:none;background:none;cursor:pointer;color:var(--dimmer);font-size:13px;line-height:1;padding:0;">✕</button>
        </span>`).join('')
    : `<div class="hint">No names added yet.</div>`;
}

document.getElementById('btnCnAdd').addEventListener('click', async ()=>{
  const input = document.getElementById('cn-new-name');
  const name = input.value.trim();
  if(!name) return toast('Enter a name first', true);
  const btn = document.getElementById('btnCnAdd');
  btn.disabled = true;
  try{
    const created = await dbInsertCashierName(name);
    state.cashierNames.push(created);
    state.cashierNames.sort((a,b)=>a.name.localeCompare(b.name));
    input.value = '';
    renderCashierNamesList();
    toast(`${name} added`, 'success');
  }catch(err){
    toast('Could not add that name: ' + err.message, true);
  }
  btn.disabled = false;
});

document.getElementById('cn-new-name').addEventListener('keydown', e=>{
  if(e.key === 'Enter') document.getElementById('btnCnAdd').click();
});

document.getElementById('cn-list').addEventListener('click', async e=>{
  const btn = e.target.closest('[data-cn-remove]');
  if(!btn) return;
  const id = Number(btn.dataset.cnRemove);
  const entry = (state.cashierNames||[]).find(n=>n.id===id);
  if(!entry) return;
  try{
    await dbDeleteCashierName(id);
    state.cashierNames = state.cashierNames.filter(n=>n.id!==id);
    renderCashierNamesList();
    toast(`${entry.name} removed`, 'success');
  }catch(err){
    toast('Could not remove that name: ' + err.message, true);
  }
});

/* ===================== SERVED BY REPORTS =====================
   The nav link to this page exists at all only while the feature is
   on (see navigate()'s own guard for the route) — this just keeps
   the sidebar in sync with that same flag. */
function applyServedByNavVisibility(){
  const link = document.getElementById('nav-servedby-reports');
  if(link) link.style.display = state.servedByEnabled ? '' : 'none';
}

/* Unset From/To means "all time", not "today" — this is a summary
   report meant to be glanced at over a stretch, not a single shift. */
function sbrDateRange(){
  const from = document.getElementById('sbr-from').value;
  const to   = document.getElementById('sbr-to').value;
  return {
    from: from ? new Date(from+'T00:00:00').getTime() : -Infinity,
    to:   to   ? new Date(to+'T23:59:59.999').getTime() : Infinity
  };
}

function sbrFilteredSales(){
  const {from, to} = sbrDateRange();
  return (state.sales||[]).filter(s =>
    s.status === 'completed' && s.servedByName && s.ts >= from && s.ts <= to);
}

function sbrRows(){
  const sold = sbrFilteredSales();
  const byName = {};
  sold.forEach(s=>{
    const key = s.servedByName;
    byName[key] ||= { name: key, sales: 0, units: 0, revenue: 0 };
    byName[key].sales += 1;
    byName[key].units += (s.items||[]).reduce((t,i)=>t+Number(i.qty||0), 0);
    byName[key].revenue += Number(s.total||0);
  });
  return Object.values(byName).sort((a,b)=>b.revenue-a.revenue);
}

function renderServedByReports(){
  const body = document.getElementById('tbl-sbr');
  if(!body) return;
  const rows = sbrRows();

  document.getElementById('sbr-note').textContent =
    rows.length ? `${rows.length} name${rows.length===1?'':'s'}` : '';

  body.innerHTML = rows.length ? rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${r.sales}</td>
      <td class="num">${round2(r.units)}</td>
      <td class="num strong">${peso(r.revenue)}</td>
      <td class="num muted">${peso(r.sales ? r.revenue/r.sales : 0)}</td>
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="5">No sales with a Served By name in this range.</td></tr>`;

  const foot = document.getElementById('foot-sbr');
  if(rows.length){
    const totSales = rows.reduce((t,r)=>t+r.sales,0);
    const totUnits = rows.reduce((t,r)=>t+r.units,0);
    const totRevenue = rows.reduce((t,r)=>t+r.revenue,0);
    foot.innerHTML = `<tr class="total-row">
      <td>TOTAL</td><td class="num">${totSales}</td><td class="num">${round2(totUnits)}</td>
      <td class="num strong">${peso(totRevenue)}</td>
      <td class="num muted">${peso(totSales ? totRevenue/totSales : 0)}</td>
    </tr>`;
  }else{
    foot.innerHTML = '';
  }
}

['sbr-from','sbr-to'].forEach(id=>
  document.getElementById(id).addEventListener('change', renderServedByReports));
document.getElementById('btnSbrReset').addEventListener('click', ()=>{
  document.getElementById('sbr-from').value = '';
  document.getElementById('sbr-to').value = '';
  renderServedByReports();
});

document.getElementById('btnSbrDownload').addEventListener('click', async ()=>{
  const rows = sbrRows();
  if(!rows.length) return toast('Nothing to download in this range', true);

  const summarySheet = rows.map(r=>({
    Name: r.name, Sales: r.sales, 'Items Sold': round2(r.units),
    'Total Revenue': round2(r.revenue), 'Avg / Sale': round2(r.sales ? r.revenue/r.sales : 0)
  }));

  // One row per transaction — the per-name table above is a summary,
  // this is the detail behind it: every item sold, what was paid, what
  // came back as change, and the logged-in account that rang it up
  // (which can differ from Served By on a shared terminal).
  const detailSheet = sbrFilteredSales()
    .slice().sort((a,b)=> a.servedByName.localeCompare(b.servedByName) || a.ts-b.ts)
    .map(s=>({
      'Served By': s.servedByName,
      'Transaction #': s.txnNumber, Date: new Date(s.ts).toLocaleString(),
      'Logged-in Account': s.cashier || '',
      'Item(s)': (s.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', '),
      Total: round2(s.total),
      'Cash Received': s.cashReceived!=null ? round2(s.cashReceived) : '',
      Change: s.change!=null ? round2(s.change) : ''
    }));

  const sheets = { 'Summary': summarySheet, 'Detail': detailSheet };
  const filename = `served-by-report-${isoDate(new Date())}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, data])=>{
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = Object.keys(data[0]).map(k=>({
        wch: Math.max(k.length+2, ...data.map(r=>String(r[k] ?? '').length+2))
      }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(`${rows.length} name${rows.length===1?'':'s'}, ${detailSheet.length} transaction${detailSheet.length===1?'':'s'} downloaded`);
    return;
  }

  let out = '';
  Object.entries(sheets).forEach(([name, data])=>{
    out += `\n=== ${name} ===\n`;
    const cols = Object.keys(data[0]);
    out += cols.join(',')+'\n';
    data.forEach(r=>{
      out += cols.map(c=>{
        const v = String(r[c] ?? '');
        return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
      }).join(',')+'\n';
    });
  });
  const ok = await saveGeneratedFile(filename+'.csv', new Blob([out], {type:'text/csv;charset=utf-8;'}));
  if(ok) toast('Excel library offline — saved as CSV instead');
});
