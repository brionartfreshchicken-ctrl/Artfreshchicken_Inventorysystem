/* ===== js/pos/18-pos.js =====
   Point of Sale: the cart, checkout (cash/GCash), and Today's Sales.
   (Lines 3227-3790 of the original single-file build.) */

/* 13-pos.js — Point of Sale: the cart, checkout, and Today's Sales. */

let cart = [];   // [{itemId, qty}] — cleared once the sale is completed

const sellable = i => i.category !== 'ingredient' && i.selling != null;

const POS_CAT_ORDER = ['food','snack','drink'];
const POS_CAT_LABEL = {food:'🍽 Food Serve', snack:'🍿 Snacks', drink:'🥤 Drinks'};
let posExpandedCats = new Set();   // empty = every section starts collapsed

function renderPOS(){
  const term = filters['sales-search'];
  const cat  = filters['sales-cat'];
  const list = state.items
    .filter(sellable)
    .filter(i => i.stock > 0)   // out of stock = off the counter entirely, not just disabled
    .filter(i => (cat==='all' || i.category===cat) && matchesSearch(i, term))
    .sort((a,b)=> a.name.localeCompare(b.name) || sizeOf(a).localeCompare(sizeOf(b)));

  const grid = document.getElementById('posGrid');
  if(!list.length){
    grid.innerHTML = `<div class="cart-empty">No sellable items match.</div>`;
    return;
  }

  const tileHtml = i=>{
    const inCart = cart.find(c=>c.itemId===i.id);
    const left = i.stock - (inCart ? inCart.qty : 0);
    const status = getStatus(i);
    const thumb = i.image ? `<img class="pt-photo" src="${i.image}"/>` : '';
    return `<button class="pos-tile ${status==='low'?'low':''}" data-sell="${i.id}" ${left<=0?'disabled':''}>
      ${thumb}
      <div class="pt-info">
        <div class="pt-name">${escapeHtml(i.name)}</div>
        <div class="pt-size">${sizeOf(i) ? escapeHtml(sizeOf(i)) : '&nbsp;'}</div>
      </div>
      <div class="pt-right">
        <div class="pt-price">${peso(i.selling)}</div>
        <div class="pt-stock">${left<=0 ? 'none left' : `${Math.round(left*100)/100} ${escapeHtml(i.unit)} left`}</div>
      </div>
    </button>`;
  };

  // Grouped by category (Food Serve / Snacks / Drinks), each its own
  // collapsible section — click the header to show/hide its items. A
  // group is skipped entirely if nothing in it matches the current
  // search/filter, so picking one category from the dropdown just shows
  // that one section instead of three, one of them empty.
  grid.innerHTML = POS_CAT_ORDER
    .map(c => ({ c, items: list.filter(i=>i.category===c) }))
    .filter(({items})=>items.length)
    .map(({c, items})=>{
      const open = posExpandedCats.has(c);
      return `
      <div class="pos-cat-group">
        <div class="pos-cat-label" data-cat-toggle="${c}">
          <span class="pos-cat-arrow">${open?'▾':'▸'}</span>
          ${POS_CAT_LABEL[c]} <span class="pos-cat-count">— ${items.length} item${items.length===1?'':'s'}</span>
        </div>
        <div class="pos-grid" style="${open?'':'display:none;'}">${items.map(tileHtml).join('')}</div>
      </div>`;
    })
    .join('');
}

document.getElementById('posGrid').addEventListener('click', e=>{
  const label = e.target.closest('[data-cat-toggle]');
  if(!label) return;
  const c = label.dataset.catToggle;
  if(posExpandedCats.has(c)) posExpandedCats.delete(c);
  else posExpandedCats.add(c);
  renderPOS();
});

function computeCartTotals(){
  let benta=0, puhunan=0, units=0;
  cart.forEach(c=>{
    const i = byId(c.itemId); if(!i) return;
    benta += c.qty * i.selling;
    puhunan += c.qty * i.cost;
    units += c.qty;
  });
  return {benta, puhunan, tubo: benta-puhunan, units};
}

function renderCart(){
  const box = document.getElementById('cartBox');
  const tot = computeCartTotals();

  document.getElementById('cartCount').textContent =
    cart.length ? `${cart.length} line${cart.length===1?'':'s'} · ${Math.round(tot.units*100)/100} item${tot.units===1?'':'s'}` : 'empty';

  box.innerHTML = cart.length ? cart.map(c=>{
    const i = byId(c.itemId);
    if(!i) return '';
    return `<div class="cart-row">
      <div>
        <div class="cr-name">${escapeHtml(displayName(i))}</div>
        <div class="cr-sub">${peso(i.selling)} each · ${peso(c.qty*i.selling)}</div>
      </div>
      <div class="cart-qty">
        <button data-cart="minus" data-id="${i.id}" title="Less">−</button>
        <span class="cq-num">${Math.round(c.qty*100)/100}</span>
        <button data-cart="plus" data-id="${i.id}" title="More" ${c.qty>=i.stock?'disabled':''}>+</button>
        <button data-cart="drop" data-id="${i.id}" title="Remove" style="color:var(--red);">×</button>
      </div>
    </div>`;
  }).join('') : `<div class="cart-empty">Nothing added yet.<br>Tap an item on the left to start a sale.</div>`;

  document.getElementById('cartTotals').innerHTML = cart.length ? `
    <div class="cart-totals">
      ${isAdmin() ? `
        <div class="ct-line"><span>Cost</span><span class="ct-val">${peso(tot.puhunan)}</span></div>
        <div class="ct-line tubo"><span>Profit</span><span class="ct-val">${peso(tot.tubo)}</span></div>` : ''}
      <div class="ct-line"><span>Subtotal</span><span class="ct-val">${peso(tot.benta)}</span></div>
      <div class="ct-line" id="ct-discount-line" style="display:none;"><span>Discount</span><span class="ct-val" id="ct-discount-val"></span></div>
      <div class="ct-line big"><span>Total to charge</span><span class="ct-val" id="ct-grand-total">${peso(tot.benta)}</span></div>
    </div>` : '';

  document.getElementById('btnCompleteSale').disabled = cart.length === 0;
  document.getElementById('pos-cash-row').style.display =
    (cart.length && document.getElementById('pos-paymethod').value === 'cash') ? '' : 'none';
  updatePosTotals();
}

/* Discount / payment method / cash & change — these live in static inputs
   (not rebuilt by renderCart) so typing in them never loses focus. This
   only recomputes the derived numbers next to them. */

function cartDiscount(){
  const raw = parseFloat(document.getElementById('pos-discount').value);
  const subtotal = computeCartTotals().benta;
  if(isNaN(raw) || raw < 0) return 0;
  return Math.min(raw, subtotal);   // never discount past ₱0
}

function cartGrandTotal(){
  return Math.max(0, computeCartTotals().benta - cartDiscount());
}

function updatePosTotals(){
  if(!cart.length){
    document.getElementById('pos-gcash-card').classList.remove('show');
    document.getElementById('btnCompleteSale').disabled = true;
    return;
  }
  const discount = cartDiscount();
  const total = cartGrandTotal();

  const discLine = document.getElementById('ct-discount-line');
  if(discLine){
    discLine.style.display = discount > 0 ? '' : 'none';
    document.getElementById('ct-discount-val').textContent = `− ${peso(discount)}`;
  }
  const totalEl = document.getElementById('ct-grand-total');
  if(totalEl) totalEl.textContent = peso(total);

  const method = document.getElementById('pos-paymethod').value;
  document.getElementById('pos-cash-row').style.display = method === 'cash' ? '' : 'none';
  if(method === 'cash'){
    const cash = parseFloat(document.getElementById('pos-cash').value) || 0;
    document.getElementById('pos-change').value = peso(Math.max(0, cash - total));
  }

  const gcashCard = document.getElementById('pos-gcash-card');
  if(method === 'gcash'){
    gcashCard.classList.add('show');
    renderGcashQr(total);
  }else{
    gcashCard.classList.remove('show');
  }

  // Complete Sale needs a confirmed GCash payment for this exact amount;
  // every other method keeps the old rule (just needs items in the cart —
  // Cash still checks the amount received, but only once you click it).
  const gcashReady = method !== 'gcash' || (gcashConfirmed && gcashConfirmedAmount === total);
  document.getElementById('btnCompleteSale').disabled = cart.length === 0 || !gcashReady;
}

/* ---- GCash: a simulated QR payment card. There's no real payment
   gateway here — no bank or e-wallet API is wired up — so "Check
   Payment" doesn't verify anything with GCash itself. It's a stand-in
   for the cashier confirming, on their own phone/GCash app, that the
   customer's payment came through, then telling FoodTrack that it did.
   Re-generates whenever the amount due changes, and any change to the
   amount clears a prior confirmation — you're always confirming the
   number actually on screen. */

let gcashConfirmed = false;
let gcashConfirmedAmount = null;
let gcashQrInstance = null;
let gcashLastQrAmount = null;

function setGcashStatus(mode){
  const el = document.getElementById('gcash-status');
  el.className = 'gcash-status' + (mode==='confirmed' ? ' confirmed' : mode==='checking' ? ' checking' : '');
  el.innerHTML = mode==='confirmed'
    ? '<span class="gcash-status-dot"></span> Payment confirmed'
    : mode==='checking'
      ? '<span class="gcash-status-dot"></span> Checking…'
      : '<span class="gcash-status-dot"></span> Waiting for payment';
}

function renderGcashQr(total){
  document.getElementById('gcash-amount-val').textContent = peso(total);

  // A real uploaded merchant QR is static — same image every time,
  // amount or no amount — so just show it and skip the generated code
  // entirely. Still resets confirmation on amount change, same as below.
  if(state.gcashQrImage){
    if(gcashLastQrAmount !== total){
      gcashConfirmed = false;
      setGcashStatus('waiting');
      document.getElementById('btnCheckGcashPayment').disabled = false;
      gcashLastQrAmount = total;
    }
    const box = document.getElementById('pos-qr-code');
    if(box.dataset.mode !== 'uploaded'){
      box.innerHTML = `<img src="${state.gcashQrImage}" style="width:148px;height:148px;object-fit:contain;"/>`;
      box.dataset.mode = 'uploaded';
    }
    return;
  }

  // Amount changed since we last drew the code (or since it was
  // confirmed) — any earlier confirmation no longer applies.
  if(gcashLastQrAmount !== total){
    gcashConfirmed = false;
    setGcashStatus('waiting');
    document.getElementById('btnCheckGcashPayment').disabled = false;
    gcashLastQrAmount = total;

    // A fake-but-plausible payload — this is a UI mockup, not a real
    // GCash merchant request, since that needs real merchant API access.
    const payload = `GCASH-PAY|AMOUNT:${total.toFixed(2)}|REF:${Date.now().toString(36).toUpperCase()}`;
    const box = document.getElementById('pos-qr-code');
    box.dataset.mode = 'generated';
    if(typeof QRCode === 'undefined'){
      box.innerHTML = `<div class="hint" style="width:128px;height:128px;display:flex;align-items:center;justify-content:center;">QR code library did not load (offline?)</div>`;
      gcashQrInstance = null;
      return;
    }
    if(!gcashQrInstance){
      box.innerHTML = '';
      gcashQrInstance = new QRCode(box, {
        text: payload, width: 148, height: 148,
        colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M
      });
    }else{
      gcashQrInstance.makeCode(payload);
    }
  }
}

document.getElementById('btnCheckGcashPayment').addEventListener('click', ()=>{
  const total = cartGrandTotal();
  setGcashStatus('checking');
  document.getElementById('btnCheckGcashPayment').disabled = true;
  // Simulated latency, same shape a real status poll would have —
  // nothing is actually being checked against GCash here.
  setTimeout(()=>{
    gcashConfirmed = true;
    gcashConfirmedAmount = total;
    setGcashStatus('confirmed');
    updatePosTotals();
  }, 1200);
});

['pos-discount','pos-cash'].forEach(id=>
  document.getElementById(id).addEventListener('input', updatePosTotals));
document.getElementById('pos-paymethod').addEventListener('change', updatePosTotals);

/* Tile clicks add to the cart */

document.getElementById('posGrid').addEventListener('click', e=>{
  const btn = e.target.closest('[data-sell]');
  if(!btn) return;
  const item = byId(Number(btn.dataset.sell));
  if(!item) return;
  const line = cart.find(c=>c.itemId===item.id);
  const already = line ? line.qty : 0;
  if(already + 1 > item.stock) return toast(`Only ${item.stock} ${item.unit} of ${item.name} left`, true);
  if(line) line.qty += 1; else cart.push({itemId:item.id, qty:1});
  renderPOS(); renderCart();
});

/* Cart quantity controls */

document.getElementById('cartBox').addEventListener('click', e=>{
  const btn = e.target.closest('[data-cart]');
  if(!btn) return;
  const id = Number(btn.dataset.id);
  const line = cart.find(c=>c.itemId===id);
  const item = byId(id);
  if(!line || !item) return;

  if(btn.dataset.cart === 'plus'){
    if(line.qty + 1 > item.stock) return toast('Not enough stock', true);
    line.qty += 1;
  }
  if(btn.dataset.cart === 'minus') line.qty -= 1;
  if(btn.dataset.cart === 'drop')  line.qty = 0;
  if(line.qty <= 0) cart = cart.filter(c=>c.itemId !== id);

  renderPOS(); renderCart();
});

document.getElementById('btnClearCart').addEventListener('click', ()=>{
  if(!cart.length) return;
  cart = []; renderPOS(); renderCart();
});

/* Completing the sale: one 'sold' movement per line, stock comes down */

document.getElementById('btnCompleteSale').addEventListener('click', async ()=>{
  if(!cart.length) return;

  // Check every line before changing anything, so a sale is all-or-nothing
  for(const c of cart){
    const i = byId(c.itemId);
    if(!i) return toast('An item in the cart no longer exists', true);
    if(c.qty > i.stock) return toast(`Not enough ${i.name} — only ${i.stock} ${i.unit} left`, true);
  }

  const tot = computeCartTotals();
  const discount = cartDiscount();
  const total = cartGrandTotal();
  const paymentMethod = document.getElementById('pos-paymethod').value;
  let cashReceived = null, change = null;
  if(paymentMethod === 'cash'){
    cashReceived = parseFloat(document.getElementById('pos-cash').value) || 0;
    if(cashReceived < total){
      return toast(`Cash received (${peso(cashReceived)}) is less than the total due (${peso(total)})`, true);
    }
    change = cashReceived - total;
  }
  if(paymentMethod === 'gcash' && !(gcashConfirmed && gcashConfirmedAmount === total)){
    return toast('Check and confirm the GCash payment first', true);
  }

  let txnNumber;
  try{
    txnNumber = await nextDocNumber('SALE');
    for(const c of cart){
      const i = byId(c.itemId);
      i.stock = Math.max(0, i.stock - c.qty);
      await dbUpdateItemStock(i.id, i.stock);
      await logActivity(i, 'out', c.qty, 'sold', txnNumber);
    }
  }catch(err){
    toast(err.message || 'Could not record that sale', true);
    return;
  }

  const saleItems = cart.map(c=>{
    const i = byId(c.itemId);
    return { itemId: i.id, name: displayName(i), qty: c.qty, unitPrice: i.selling, lineTotal: c.qty*i.selling };
  });

  cart.forEach(c=>{
    const i = byId(c.itemId);
    // Sold from a Menu Plan food (synced by syncActivePlanFoodsToPOS)?
    // Count it as served, same as typing it into "Servings Served" by hand.
    if(i.sourcePlanId != null && i.sourceFoodId != null){
      const srcPlan = cosPlans().find(p => p.id === i.sourcePlanId);
      const srcFood = srcPlan && (srcPlan.foods||[]).find(f => f.id === i.sourceFoodId);
      if(srcFood){
        srcFood.served = (Number(srcFood.served)||0) + c.qty;
        // Menu Plan's own draft-autosave doesn't cover this (it's driven
        // from here, not from typing on that page) — persist it directly
        // so Plan History's served/profit figures survive a reload.
        dbUpdateCosFoodServed(srcFood.id, srcFood.served).catch(err =>
          toast('Could not save the updated servings: ' + err.message, true));
      }
    }
  });

  // The sale header itself (state.sales) still lives only locally until
  // POS gets fully migrated — stock and the movement log above are
  // already durable either way.
  state.sales.push({
    id: state.nextSaleId++,
    txnNumber,
    ts: Date.now(),
    cashier: currentUser ? currentUser.name : '—',
    items: saleItems,
    subtotal: tot.benta,
    discount,
    total,
    paymentMethod,
    cashReceived,
    change,
    status: 'completed'
  });

  cart = [];
  document.getElementById('pos-discount').value = 0;
  document.getElementById('pos-cash').value = '';
  document.getElementById('pos-change').value = '₱0.00';
  gcashConfirmed = false;
  gcashConfirmedAmount = null;
  gcashLastQrAmount = null;
  saveState();
  renderAll();
  const changeMsg = paymentMethod==='cash' ? `, change ${peso(change)}` : '';
  const msg = isAdmin()
    ? `${txnNumber} — revenue ${peso(total)}, profit ${peso(tot.tubo-discount)}${changeMsg}`
    : `${txnNumber} — ${peso(total)} collected${changeMsg}`;
  toast(msg, 'success');
});

/* Today's sales list */

function startOfToday(){
  const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
}

function renderTodaySales(){
  const today = (state.activity||[]).filter(a => (a.reason==='sold' && !a.voided) && a.ts >= startOfToday());
  const benta = today.reduce((t,a)=>t+lineBenta(a),0);
  const puh   = today.reduce((t,a)=>t+linePuhunan(a),0);
  const money = isAdmin();       // staff see what was charged, not the margin

  document.getElementById('head-today').innerHTML =
    `<th>Time</th><th>Item</th><th>Qty</th><th>Revenue</th>` +
    (money ? `<th>Cost</th><th>Profit</th>` : ``) +
    `<th>By</th><th></th>`;
  const cols = money ? 8 : 6;

  document.getElementById('todayCount').textContent =
    today.length ? `${today.length} sale${today.length===1?'':'s'}` : 'no sales yet today';

  document.getElementById('btnDownloadToday').disabled = today.length === 0;

  document.getElementById('tbl-today').innerHTML = today.length
    ? today.map(a=>`<tr>
        <td class="muted">${new Date(a.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
        <td>${escapeHtml(a.name)}</td>
        <td>${Math.round(a.qty*100)/100} <span class="muted">${escapeHtml(a.unit||'')}</span></td>
        <td>${peso(lineBenta(a))}</td>
        ${money ? `<td class="muted">${peso(linePuhunan(a))}</td>
        <td class="strong green-text">${peso(lineBenta(a)-linePuhunan(a))}</td>` : ``}
        <td class="muted">${escapeHtml(a.by||'—')}</td>
        <td class="num">${isAdmin() ? `<button class="btn small danger" data-void="${a.id}" title="Void this sale">Void</button> <button class="btn small ghost" data-delperm="${a.id}" title="Permanently delete this sale" style="color:var(--red);">Delete</button>` : ''}</td>
      </tr>`).join('')
    : `<tr class="empty-row"><td colspan="${cols}">No sales recorded today yet.</td></tr>`;

  document.getElementById('foot-today').innerHTML = today.length
    ? `<tr class="total-row"><td colspan="3">TODAY'S TOTAL</td>
       <td class="strong">${peso(benta)}</td>
       ${money ? `<td class="strong">${peso(puh)}</td>
       <td class="strong green-text">${peso(benta-puh)}</td>` : ``}
       <td colspan="2"></td></tr>`
    : '';
}

/* ---------- Forgot password ----------
   No server and no email here, so recovery works off a security question
   the account set when it was created. */

function todaySalesRows(){
  return (state.activity||[])
    .filter(a => (a.reason==='sold' && !a.voided) && a.ts >= startOfToday())
    .slice().reverse();          // earliest first reads better on paper
}

function buildDailyReport(){
  return buildSalesReport(todaySalesRows(), 'Daily Sales Report',
    new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
}

/* Builds the two report sheets for any set of sale rows. */

function buildSalesReport(rows, title, periodLabel){
  const d      = new Date();
  const benta  = rows.reduce((t,a)=>t+lineBenta(a),0);
  const puh    = rows.reduce((t,a)=>t+linePuhunan(a),0);
  const tubo   = benta - puh;
  const margin = benta > 0 ? tubo/benta*100 : 0;
  const units  = rows.reduce((t,a)=>t+a.qty,0);

  const sheet1 = [
    ['CAFETERIA INVENTORY SYSTEM'],
    [title],
    [],
    ['Period',        periodLabel],
    ['Generated',     d.toLocaleString()],
    ['Generated by',  currentUser ? currentUser.name : '—'],
    ['Transactions',  rows.length],
    ['Units sold',    round2(units)],
    [],
    ['TIME','ITEM','CATEGORY','QTY','UNIT','PRICE','BENTA','PUHUNAN','TUBO','BY'],
    ...rows.map(a=>[
      new Date(a.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
      a.name,
      catLabel(a.category),
      round2(a.qty),
      a.unit || '',
      a.selling ?? '',
      round2(lineBenta(a)),
      round2(linePuhunan(a)),
      round2(lineBenta(a) - linePuhunan(a)),
      a.by || ''
    ]),
    [],
    ['TOTAL','','','','','', round2(benta), round2(puh), round2(tubo), ''],
    ['Margin','', margin.toFixed(1)+'%']
  ];

  // Group repeat sales of the same item
  const grouped = {};
  rows.forEach(a=>{
    const k = a.itemId ?? a.name;
    grouped[k] ||= {name:a.name, cat:a.category, unit:a.unit, qty:0, benta:0, puh:0, times:0};
    const g = grouped[k];
    g.qty += a.qty; g.benta += lineBenta(a); g.puh += linePuhunan(a); g.times++;
  });
  const list = Object.values(grouped).sort((a,b)=>(b.benta-b.puh)-(a.benta-a.puh));

  const sheet2 = [
    [title + ' — Summary by Item'],
    ['Period', periodLabel],
    [],
    ['ITEM','CATEGORY','QTY SOLD','UNIT','TIMES SOLD','BENTA','PUHUNAN','TUBO','MARGIN'],
    ...list.map(g=>[
      g.name, catLabel(g.cat), round2(g.qty), g.unit || '', g.times,
      round2(g.benta), round2(g.puh), round2(g.benta-g.puh),
      g.benta>0 ? (((g.benta-g.puh)/g.benta)*100).toFixed(1)+'%' : '—'
    ]),
    [],
    ['TOTAL','', round2(units),'', rows.length, round2(benta), round2(puh), round2(tubo),
      benta>0 ? margin.toFixed(1)+'%' : '—']
  ];

  return {sheet1, sheet2, rows, benta, tubo};
}

async function downloadTodayReport(){
  await downloadSalesReport(todaySalesRows(), 'Daily Sales Report',
    new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}),
    `daily-sales-${isoDate(new Date())}`);
}

/* Shared writer — used by Today's download and every History row */

async function downloadSalesReport(rows, title, periodLabel, filename){
  if(!rows.length) return toast('No sales in that period', true);
  const {sheet1, sheet2, benta, tubo} = buildSalesReport(rows, title, periodLabel);

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
    ws1['!cols'] = [{wch:10},{wch:26},{wch:12},{wch:8},{wch:9},{wch:9},{wch:11},{wch:11},{wch:10},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws1, "Sales");

    const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
    ws2['!cols'] = [{wch:26},{wch:12},{wch:11},{wch:9},{wch:12},{wch:11},{wch:11},{wch:11},{wch:9}];
    XLSX.utils.book_append_sheet(wb, ws2, "Summary by Item");

    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(`Downloaded — revenue ${peso(benta)}, profit ${peso(tubo)}`);
    return;
  }

  const toCsv = aoa => aoa.map(r => (r||[]).map(c=>{
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }).join(',')).join('\n');

  const blob = new Blob([toCsv(sheet1)+'\n\n'+toCsv(sheet2)], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

document.getElementById('btnDownloadToday').addEventListener('click', downloadTodayReport);

/* ---------- Deleting a recorded movement ----------
   Removing a sale means it never happened, so the stock goes back on the
   shelf. Same in reverse for a delivery. Admin only — letting staff erase
   their own sales is how shortfalls get hidden. */
