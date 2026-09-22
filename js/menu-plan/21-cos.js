/* ===== js/menu-plan/21-cos.js =====
   Menu Plan (food costing), the ingredient-deduction logic, and syncing today's foods onto Point of Sale.
   (Lines 6311-7379 of the original single-file build.) */

/* 16-cos.js — Cost of Sales / Menu Planning (Today's Menu Plan) and the ingredient-deduction logic. */

/* A plan is one day. Foods sit inside it, each with its own ingredients. */
function cosPlans(){
  if(!Array.isArray(state.cosPlans)) state.cosPlans = [];
  return state.cosPlans;
}
function activePlan(){
  return cosPlans().find(p => p.id === state.cosActiveId) || cosPlans()[0] || null;
}
function cosFoods(){
  const p = activePlan();
  if(!p) return [];
  if(!Array.isArray(p.foods)) p.foods = [];
  return p.foods;
}
function cosFood(id){ return cosFoods().find(f => f.id === Number(id)); }
/* "Wed, 10 Sep 2026" — plans are picked by day, so the label reads as one */
function planDate(p){
  const d = new Date(p.date + 'T00:00:00');
  return isNaN(d) ? p.date
    : d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}

/* Name first, then the date — that is how you'd say it out loud. */
function planLabel(p){
  const n = (p.foods||[]).length;
  return `${p.name || 'Untitled Plan'} · ${planDate(p)} — ${n} food${n===1?'':'s'}`;
}

async function newCosPlan(name, date){
  const p = await dbInsertCosPlan((name || '').trim() || 'Untitled Plan', date || isoDate(new Date()));
  cosPlans().unshift(p);
  state.cosActiveId = p.id;
  return p;
}

async function newCosFood(name){
  const plan = activePlan();
  const f = await dbInsertCosFood(plan.id, { name: name || 'New Food', servings: 10, served: 0, price: 0, lines: [] });
  cosFoods().push(f);
  return f;
}

/* ---------- Maths ---------- */

function foodTotals(f){
  const cost     = (f.lines||[]).reduce((t,l)=>t + (Number(l.total)||0), 0);
  const servings = Number(f.servings) || 0;          // planned
  const served   = Number(f.served) || 0;            // actually served
  const price    = Number(f.price) || 0;
  const sales    = servings * price;                 // if everything sells
  const profit   = sales - cost;

  /* What really happened. Ingredient cost is already spent whether the food
     sells or not, so unsold servings come straight off the profit. */
  const actualSales  = served * price;
  const actualProfit = actualSales - cost;

  return {
    cost, servings, served, price, sales, profit,
    margin: sales > 0 ? (profit / sales * 100) : 0,
    perServing: servings > 0 ? cost / servings : 0,
    actualSales, actualProfit,
    actualMargin: actualSales > 0 ? (actualProfit / actualSales * 100) : 0,
    unsold: Math.max(0, servings - served),
    sellThrough: servings > 0 ? (served / servings * 100) : 0
  };
}

function programTotals(){ return planTotals(activePlan()); }

/* The whole plan: every food added together. */

/* Totals for any plan. programTotals() is just this for the active one. */
function planTotals(plan){
  const list     = plan && Array.isArray(plan.foods) ? plan.foods : [];
  const foods    = list.map(f => ({food:f, t: foodTotals(f)}));
  const cost     = foods.reduce((n,x)=>n + x.t.cost, 0);
  const sales    = foods.reduce((n,x)=>n + x.t.sales, 0);
  const servings = foods.reduce((n,x)=>n + x.t.servings, 0);
  const served   = foods.reduce((n,x)=>n + x.t.served, 0);
  const actualSales = foods.reduce((n,x)=>n + x.t.actualSales, 0);
  const profit   = sales - cost;
  const actualProfit = actualSales - cost;
  return {
    foods, cost, sales, servings, served, profit,
    actualSales, actualProfit,
    margin: sales > 0 ? (profit / sales * 100) : 0,
    actualMargin: actualSales > 0 ? (actualProfit / actualSales * 100) : 0,
    unsold: Math.max(0, servings - served),
    sellThrough: servings > 0 ? (served / servings * 100) : 0
  };
}

/* ---------- Auto-costing a line ---------- */

const QTY_UNITS = ['pcs','kg','g','L','ml','pack','bottle','can','sachet','bulb','tray','cup','tbsp','tsp'];

/* ---------- Unit conversion ----------
   Only mass (g/kg) and volume (ml/L/tbsp/tsp/cup) convert automatically
   — both have a fixed physical relationship. Count-type units (pcs,
   pack, bottle, can, sachet, bulb, tray) don't: a "pack" isn't a fixed
   number of "pcs" across every product, so those stay exact-match-only
   — same reason an item's own `conv` field is always labeled
   "estimated" and never used in real deduction math. tbsp/tsp/cup use
   the metric cooking measures (15 / 5 / 250 ml) common in PH recipes. */
const UNIT_CONVERSION = {
  g:    { group: 'mass',   perBase: 1 },
  kg:   { group: 'mass',   perBase: 1000 },
  ml:   { group: 'volume', perBase: 1 },
  L:    { group: 'volume', perBase: 1000 },
  tbsp: { group: 'volume', perBase: 15 },
  tsp:  { group: 'volume', perBase: 5 },
  cup:  { group: 'volume', perBase: 250 },
};

/* Converts `qty` from `fromUnit` to `toUnit`. Returns null when either
   unit isn't a convertible one, or the two are in different groups
   (e.g. kg -> ml — not a unit conversion, an unrelated measure) —
   refusing beats guessing wrong for something tracking real stock. */
function convertQty(qty, fromUnit, toUnit){
  if(fromUnit === toUnit) return qty;
  const from = UNIT_CONVERSION[fromUnit];
  const to = UNIT_CONVERSION[toUnit];
  if(!from || !to || from.group !== to.group) return null;
  return qty * from.perBase / to.perBase;
}

/* A price can mean two things and both are normal:
     'unit'  — ₱460 per kilo, so 2 kg costs ₱920
     'total' — ₱460 for the whole 2 kg
   Ask which, rather than making anyone divide in their head. */
function priceIsTotal(line){ return line.priceMode === 'total'; }

/* A one-line explanation shown right under each ingredient's Total Cost,
   so it's never a mystery why a number is what it is — especially the
   difference between "per kg" (scales with quantity) and "flat total"
   (doesn't), which is the single most common mix-up on this page. */
function lineFormulaCaption(l){
  if(l.manual) return 'Typed by you, not calculated';
  if(priceIsTotal(l)) return `Flat ${peso(l.priceNum||0)} — same at any quantity`;
  const q = (l.qtyNum === '' || l.qtyNum == null) ? null : Number(l.qtyNum);
  const p = (l.priceNum === '' || l.priceNum == null) ? null : Number(l.priceNum);
  if(q == null || p == null || isNaN(q) || isNaN(p)) return '';
  return `${q} ${l.qtyUnit||''} × ${peso(p)} = ${peso(l.total||0)}`;
}

function syncUnitText(line){
  const n = (line.priceNum === '' || line.priceNum == null) ? '' : line.priceNum;
  if(n === ''){ line.unit = ''; return; }
  line.unit = priceIsTotal(line)
    ? `${n} total`
    : `${n} / ${line.qtyUnit || 'pcs'}`;
}

/* The quantity is a number plus a unit. l.qty keeps the two joined as text
   so exports and older saves still read naturally. */
function syncQtyText(line){
  const n = (line.qtyNum === '' || line.qtyNum == null) ? '' : line.qtyNum;
  line.qty = `${n} ${line.qtyUnit || ''}`.trim();
}

/* Pulls the first number out of "2 kg" or "125 / kg". */

function autoCost(line){
  if(line.manual) return null;
  const q = (line.qtyNum === '' || line.qtyNum == null)
    ? firstNumber(line.qty)                 // older lines still carry text only
    : Number(line.qtyNum);
  const p = (line.priceNum === '' || line.priceNum == null)
    ? firstNumber(line.unit)
    : Number(line.priceNum);
  if(p === null || isNaN(p)) return null;

  // A total price is already the answer — no multiplying
  if(priceIsTotal(line)) return Math.round(p * 100) / 100;

  if(q === null || isNaN(q)) return null;
  return Math.round(q * p * 100) / 100;
}

function applyAutoCost(line){
  const a = autoCost(line);
  if(a !== null) line.total = a;
  return a;
}

/* ---------- Rendering ---------- */

/* Changing anything after a save drops the "saved" mark, so the button
   is never just decoration. */
function markUnsaved(f){
  f.saved = null;
  const card = document.querySelector(`.cos-food[data-food="${f.id}"]`);
  const chip = card && card.querySelector('.chip.saved');
  if(chip) chip.remove();
}

function foodMiniHtml(t){
  /* Once anything has been served, the actual figures lead and the plan
     sits underneath. Before that, actual is honestly zero. */
  const losing  = t.actualProfit < 0;
  const col     = losing ? 'var(--red)' : 'var(--green)';
  const short   = t.unsold > 0;
  return `
    <div><div class="fm-l">Cost</div><div class="fm-v">${peso(t.cost)}</div></div>
    <div><div class="fm-l">Per Serving</div><div class="fm-v">${peso(t.perServing)}</div></div>
    <div><div class="fm-l">Served</div>
      <div class="fm-v" style="color:${short?'var(--yellow)':'var(--green)'}">${t.served} / ${t.servings}</div>
      <div class="fm-s">${short ? t.unsold+' unsold' : t.servings>0 ? 'all served' : '—'}</div></div>
    <div><div class="fm-l">Sales</div><div class="fm-v">${peso(t.actualSales)}</div>
      <div class="fm-s">plan ${peso(t.sales)}</div></div>
    <div><div class="fm-l">Profit</div>
      <div class="fm-v" style="color:${col}">${peso(t.actualProfit)}</div>
      <div class="fm-s">plan ${peso(t.profit)}</div></div>
    <div><div class="fm-l">Margin</div>
      <div class="fm-v" style="color:${col}">${t.actualSales>0?t.actualMargin.toFixed(1)+'%':'—'}</div>
      <div class="fm-s">${t.sales>0?'plan '+t.margin.toFixed(1)+'%':''}</div></div>
    <div><div class="fm-l">Cost/Serving</div><div class="fm-v">${peso(t.perServing)}</div></div>`;
}

/* Keeps every SAVED food in the ACTIVE Menu Plan mirrored onto a sellable
   Products entry (category 'food'), so it shows up on Point of Sale.
   Gated on f.saved — clicking "Save" on a food is what actually publishes
   it to POS, not just filling in its fields. That was a deliberate change:
   a food used to appear the moment you typed a name/servings/price, live,
   before you'd necessarily finished setting it up or meant to sell it yet.
   Stock on the mirrored item is always (servings − served); selling a
   synced item on POS increments served the same amount (see the Complete
   Sale handler), which keeps the two in lockstep. */
function syncActivePlanFoodsToPOS(){
  const plan = activePlan();

  // Anything synced from a DIFFERENT plan — because you switched plans,
  // made a new one, deleted the plan it came from, or deleted every
  // plan down to zero — is no longer on today's menu. Take it off POS
  // here too, not just on delete, so nothing is ever left stranded.
  // Runs even when there's no active plan at all (plan is null below).
  state.items = state.items.filter(i => i.sourcePlanId == null || (plan && i.sourcePlanId === plan.id));

  if(!plan) return;

  cosFoods().forEach(f=>{
    const name = (f.name||'').trim();
    if(!name || !f.saved){
      // No name yet, or never actually saved — not published to POS.
      // Not a delete action, so don't lose the link; saving it will
      // bring it right back with today's numbers.
      if(f.linkedItemId){
        const stale = byId(f.linkedItemId);
        if(stale) stale.stock = 0;
      }
      return;
    }
    const t = foodTotals(f);
    const remaining = Math.max(0, (Number(f.servings)||0) - (Number(f.served)||0));
    // A brand-new mirrored item is only ever created at Save time (see
    // btnCosSave's finish()/syncFoodToPOSAndPersist below), where it can
    // be inserted into Supabase and get a real id before anything
    // references it — this function only keeps an ALREADY-linked item's
    // local numbers in step (e.g. stock after a POS sale changes `served`;
    // that stock change is persisted by POS checkout itself, not here).
    const item = f.linkedItemId ? byId(f.linkedItemId) : null;
    if(item){
      item.name = name;
      item.cost = t.perServing || 0;
      item.selling = f.price!=null ? Number(f.price) : null;
      item.stock = remaining;
      item.sourcePlanId = plan.id;
      item.sourceFoodId = f.id;
    }
  });
}

/* Runs once, at the moment a food is explicitly Saved — creates or
   updates its mirrored POS item in Supabase (getting a real id first,
   before cos_foods.linked_item_id can reference it), then persists the
   food + its lines. Everything syncActivePlanFoodsToPOS does afterward
   for this food is just keeping already-linked local numbers in step. */
async function syncFoodToPOSAndPersist(f){
  const plan = activePlan();
  const name = (f.name||'').trim();
  const t = foodTotals(f);
  const remaining = Math.max(0, (Number(f.servings)||0) - (Number(f.served)||0));
  const payload = {
    category:'food', name, size:'', stock: remaining, unit:'serving',
    cost: t.perServing || 0, selling: f.price!=null ? Number(f.price) : null,
    threshold: 0, sku:'', supplierId:null, maxStock:null, conv:null,
    sourcePlanId: plan.id, sourceFoodId: f.id
  };

  let item = f.linkedItemId ? byId(f.linkedItemId) : null;
  if(item){
    const updated = await dbUpdateItem(item.id, payload);
    Object.assign(item, updated);
  }else{
    item = await dbInsertItem(payload);
    state.items.push(item);
    f.linkedItemId = item.id;
  }

  flushCosFoodSync(f);   // an explicit save wins over any pending debounce
  await dbSyncCosFood(f);
}

function renderCos(){
  const plans = cosPlans();
  const empty = document.getElementById('cos-empty');
  const main  = document.getElementById('cos-main');

  // No plan yet -> ask for a date before anything else
  if(!plans.length){
    empty.style.display = 'block';
    main.style.display  = 'none';
    const d = document.getElementById('cos-new-date');
    if(!d.value) d.value = isoDate(new Date());
    document.getElementById('cos-plan-pick').innerHTML = '<option>no plans yet</option>';
    renderCosHistory();      // shows "no plans yet" rather than stale rows
    refreshCosNumbers();     // zero the summaries instead of leaving them stale
    return;
  }
  empty.style.display = 'none';
  main.style.display  = 'block';

  const plan = activePlan();
  state.cosActiveId = plan.id;
  syncActivePlanFoodsToPOS();

  const pick = document.getElementById('cos-plan-pick');
  pick.innerHTML = plans
    .slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')))
    .map(p => `<option value="${p.id}" ${p.id===plan.id?'selected':''}>${escapeHtml(planLabel(p))}</option>`)
    .join('');
  const nameBox = document.getElementById('cos-plan-name');
  if(document.activeElement !== nameBox) nameBox.value = plan.name || '';
  document.getElementById('cos-title').textContent =
    `${planDate(plan)} · ${(plan.foods||[]).length} food${(plan.foods||[]).length===1?'':'s'}`;

  document.getElementById('cos-foods').innerHTML = cosFoods().map((f, idx)=>{
    const t = foodTotals(f);
    return `
    <div class="card cos-food ${f.collapsed?'collapsed':''}" data-food="${f.id}">
      <div class="card-head">
        <span class="chip">${idx+1}</span>
        <input class="cos-food-name" data-fd="name" data-id="${f.id}"
               value="${escapeHtml(f.name||'')}" placeholder="Dish name"/>
        <span class="hint">${peso(t.cost)} of ingredients · ${t.served}/${t.servings} served</span>
        ${f.saved
          ? '<span class="chip saved">saved · on POS</span>'
          : '<span class="chip" style="background:var(--yellow-bg,#fff7e6);color:var(--yellow,#b45309);" title="Click Save below to put this on Point of Sale">not on POS yet</span>'}
        ${f.deductedAt ? '<span class="chip" style="background:var(--blue-bg);color:var(--blue);">stock taken</span>' : ''}
        ${(f.collapsed || f.pricesHidden)
          ? `<button class="btn small" data-fd-edit="${f.id}"
               title="Open this food and show the prices">Edit</button>` : ''}
        <button class="btn small ghost" data-fd-toggle="${f.id}" title="Show or hide">${f.collapsed?'&#9656;':'&#9662;'}</button>
        <button class="btn small danger" data-fd-del="${f.id}" title="Remove this food">×</button>
      </div>

      ${(Number(f.servings)||0) > 0 && (Number(f.served)||0) >= Number(f.servings) ? `
      <div class="cos-soldout-banner">
        <span>🔴</span> Sold Out — all ${f.servings} serving${f.servings===1?'':'s'} served.
        Taken off Point of Sale until you raise Target Servings.
      </div>` : ''}

      <div class="card-body">
        <div class="field-row">
          <div class="field"><label>Target Servings</label>
            <input type="number" min="0" step="1" data-fd="servings" data-id="${f.id}" value="${f.servings ?? 0}"/></div>
          <div class="field"><label>Servings Served</label>
            <input type="number" min="0" step="1" data-fd="served" data-id="${f.id}" value="${f.served ?? 0}"
                   placeholder="0" title="How many actually went out"/></div>
          <div class="field"><label>Selling Price per Serving (₱)</label>
            <input type="number" min="0" step="any" data-fd="price" data-id="${f.id}" value="${f.price ?? 0}"/></div>
        </div>

        <table style="margin-top:6px;"><thead><tr>
          <th style="width:40px;">No.</th><th>Ingredient</th><th>Quantity</th>
          ${f.pricesHidden ? '' : `<th>Unit Price (₱)</th><th class="num">Total Cost (₱)</th>`}
          <th style="width:74px;"></th>
        </tr></thead><tbody>
          ${(f.lines||[]).length ? f.lines.map((l,i)=>`
          <tr>
            <td class="muted">${i+1}</td>
            <td><select class="cos-line-unit" data-cl="name" data-fid="${f.id}" data-id="${l.id}" style="width:100%;">
              ${(()=>{
                const ingredientItems = state.items.filter(i=>i.category==='ingredient');
                const nameMatches = ingredientItems.some(i=>i.name.toLowerCase()===String(l.name||'').trim().toLowerCase());
                let opts = '<option value="">— Select an ingredient —</option>';
                if(l.name && !nameMatches){
                  // Old data, or the matching product was renamed/deleted — keep it
                  // selectable so nothing silently disappears, but flag it clearly.
                  opts += `<option value="${escapeHtml(l.name)}" selected>${escapeHtml(l.name)} (not a Products item — won't deduct)</option>`;
                }
                opts += ingredientItems.map(i=>`<option value="${escapeHtml(i.name)}" ${i.name.toLowerCase()===String(l.name||'').trim().toLowerCase()?'selected':''}>${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join('');
                return opts;
              })()}
            </select></td>
            <td><div class="qty-cell">
              <input class="cos-line-input num" data-cl="qtyNum" data-fid="${f.id}" data-id="${l.id}"
                     type="number" min="0" step="any" value="${l.qtyNum ?? ''}" placeholder="0"/>
              <select class="cos-line-unit" data-cl="qtyUnit" data-fid="${f.id}" data-id="${l.id}">
                ${QTY_UNITS.map(u=>`<option value="${u}" ${u===(l.qtyUnit||'pcs')?'selected':''}>${u}</option>`).join('')}
              </select>
            </div></td>
            ${f.pricesHidden ? '' : `
            <td><div class="qty-cell">
              <input class="cos-line-input num" data-cl="priceNum" data-fid="${f.id}" data-id="${l.id}"
                     type="number" min="0" step="any" value="${l.priceNum ?? ''}" placeholder="0"/>
              <select class="cos-line-unit" data-cl="priceMode" data-fid="${f.id}" data-id="${l.id}"
                      title="Is that the price for one ${escapeHtml(l.qtyUnit||'pcs')}, or for all of it?">
                <option value="unit"  ${!priceIsTotal(l)?'selected':''}>per ${escapeHtml(l.qtyUnit||'pcs')}</option>
                <option value="total" ${ priceIsTotal(l)?'selected':''}>flat total (doesn't scale)</option>
              </select>
            </div></td>
            <td><input class="cos-line-input num${l.manual?'':' auto'}" data-cl="total" data-fid="${f.id}" data-id="${l.id}"
                  type="number" min="0" step="any" value="${l.total ?? ''}" placeholder="0"
                  title="${l.manual?'Typed by you':'Quantity x unit price'}"/>
                <div class="hint cos-line-formula" data-fd-formula="${l.id}" style="font-size:10.5px;margin-top:3px;white-space:nowrap;">${escapeHtml(lineFormulaCaption(l))}</div></td>`}
            <td class="num" style="white-space:nowrap;">
              ${l.manual ? `<button class="btn small ghost" data-cl-auto="${l.id}" data-fid="${f.id}" title="Back to quantity x price">&#8635;</button>` : ''}
              <button class="btn small danger" data-cl-del="${l.id}" data-fid="${f.id}" title="Remove">×</button></td>
          </tr>`).join('')
          : `<tr class="empty-row"><td colspan="${f.pricesHidden?4:6}">No ingredients yet for this food.</td></tr>`}
        </tbody>
        <tfoot><tr class="total-row">
          <td colspan="${f.pricesHidden?3:4}">TOTAL INGREDIENT COST</td>
          <td class="num strong" data-fd-total="${f.id}">${peso(t.cost)}</td>
          <td class="num"><button class="btn small primary" data-fd-save="${f.id}"
            title="Mark this food done and fold it away">Save</button></td>
        </tr></tfoot></table>
      </div>

      <div class="food-mini" data-fd-mini="${f.id}">${foodMiniHtml(t)}</div>

      <div class="modal-foot" style="border-top:1px dashed var(--border);">
        ${f.pricesHidden
          ? `<button class="btn small" data-fd-prices="${f.id}">Edit prices</button>`
          : `<button class="btn small" data-fd-addline="${f.id}">+ Add Ingredient</button>
             <button class="btn small ghost" data-fd-prices="${f.id}"
               title="Hide the price columns">Done — hide prices</button>`}
      </div>
    </div>`;
  }).join('');

  refreshCosNumbers();
  renderCosHistory();
}

/* Updates every computed figure without rebuilding inputs, so typing
   never loses the cursor. */

function refreshCosNumbers(){
  const P = programTotals();
  renderCosHistory();
  syncActivePlanFoodsToPOS();   // keep POS in step with live edits (name/servings/price)

  const setIf=(id,v)=>{const el=document.getElementById(id); if(el&&document.activeElement!==el) el.value=v;};
  // flow strip, program level
  document.getElementById('cs-cost').textContent     = peso(P.cost);
  document.getElementById('cs-lines').textContent    = P.foods.length;
  document.getElementById('cs-servings').textContent = `${P.served}/${P.servings}`;
  document.getElementById('cs-price').textContent    = peso(P.sales);
  document.getElementById('cs-margin').textContent   = P.actualSales>0
    ? P.actualMargin.toFixed(1)+'%'
    : (P.sales>0 ? P.margin.toFixed(1)+'%' : '—');

  // per-food figures — the cashier card has none of these nodes
  P.foods.forEach(({food, t})=>{
    const tot  = document.querySelector(`[data-fd-total="${food.id}"]`);
    if(tot) tot.textContent = peso(t.cost);
    const head = document.querySelector(`.cos-food[data-food="${food.id}"] .card-head .hint`);
    if(head) head.textContent = `${peso(t.cost)} of ingredients · ${t.served}/${t.servings} served`;
    const mini = document.querySelector(`[data-fd-mini="${food.id}"]`);
    if(mini) mini.innerHTML = foodMiniHtml(t);
  });

  // the three summary panels, now covering the whole program
  document.getElementById('cos-sum-cost').innerHTML = `
    <tr><td>Foods Planned</td><td class="num">${P.foods.length}</td></tr>
    <tr><td>Ingredient Lines</td>
      <td class="num">${P.foods.reduce((n,x)=>n+(x.food.lines||[]).length,0)}</td></tr>
    <tr class="hl"><td>Total Ingredient Cost</td><td class="num">${peso(P.cost)}</td></tr>`;

  document.getElementById('cos-sum-plan').innerHTML = `
    <tr><td>Foods Planned</td><td class="num">${P.foods.length}</td></tr>
    <tr><td>Target Servings</td><td class="num">${P.servings} servings</td></tr>
    <tr><td>Servings Served</td>
      <td class="num" style="color:${P.unsold>0?'var(--yellow)':'var(--green)'}">${P.served} servings</td></tr>
    <tr><td>Unsold</td>
      <td class="num">${P.unsold}${P.servings>0 ? ` (${(100-P.sellThrough).toFixed(0)}%)` : ''}</td></tr>
    <tr><td>Average Cost per Serving</td>
      <td class="num">${peso(P.servings>0 ? P.cost/P.servings : 0)}</td></tr>
    <tr class="hl"><td>Total Potential Sales</td><td class="num">${peso(P.sales)}</td></tr>`;

  const losing = P.actualProfit < 0;
  const gap = P.profit - P.actualProfit;
  document.getElementById('cos-sum-profit').innerHTML = `
    <tr><td>Expected Sales (all served)</td><td class="num muted">${peso(P.sales)}</td></tr>
    <tr><td>Actual Sales (${P.served} served)</td><td class="num">${peso(P.actualSales)}</td></tr>
    <tr><td>Less: Ingredient Cost</td><td class="num">${peso(P.cost)}</td></tr>
    <tr class="hl"><td>Actual Gross Profit</td>
      <td class="num" style="color:${losing?'var(--red)':'var(--green)'}">${peso(P.actualProfit)}</td></tr>
    <tr class="hl"><td>Gross Profit Margin</td>
      <td class="num" style="color:${losing?'var(--red)':'var(--green)'}">${P.actualSales>0?P.actualMargin.toFixed(1)+'%':'—'}</td></tr>
    ${gap > 0 ? `<tr><td colspan="2" class="muted" style="color:var(--yellow);">
      ${peso(gap)} short of plan — ${P.unsold} serving${P.unsold===1?'':'s'} unsold.</td></tr>` : ''}`;
}

/* ---------- Editing ---------- */

// Food name, servings, price + every ingredient field

// select elements fire change, inputs fire input — listen for both
['input','change'].forEach(ev =>
document.getElementById('cos-foods').addEventListener(ev, e=>{
  const fd = e.target.closest('[data-fd]');
  if(fd){
    const f = cosFood(fd.dataset.id); if(!f) return;
    const k = fd.dataset.fd;
    f[k] = (k === 'name') ? fd.value : (Number(fd.value) || 0);
    if(f.saved) markUnsaved(f);

    refreshCosNumbers();   // also syncs this food onto POS before the save below
    saveState();
    scheduleCosFoodSync(f);
    return;
  }

  const cl = e.target.closest('[data-cl]');
  if(!cl) return;
  const f = cosFood(cl.dataset.fid); if(!f) return;
  if(f.saved) markUnsaved(f);
  const line = (f.lines||[]).find(l => l.id === Number(cl.dataset.id)); if(!line) return;
  const field = cl.dataset.cl;

  if(field === 'total'){
    // Typing a total means you know better than the multiplication
    line.total = Number(cl.value) || 0;
    line.manual = true;
    cl.classList.remove('auto');
  }else{
    line[field] = cl.value;
    if(field === 'qtyNum' || field === 'qtyUnit') syncQtyText(line);
    if(field === 'priceNum' || field === 'priceMode') syncUnitText(line);

    /* Changing the measure changes what "per ___" means, so relabel it */
    if(field === 'qtyUnit'){
      syncUnitText(line);
      const modeSel = document.querySelector(`[data-cl="priceMode"][data-fid="${f.id}"][data-id="${line.id}"]`);
      if(modeSel){
        modeSel.options[0].textContent = 'per ' + (line.qtyUnit || 'pcs');
        modeSel.title = `Is that the price for one ${line.qtyUnit||'pcs'}, or for all of it?`;
      }
    }

    // Picking a tracked ingredient brings its price and its unit across
    if(field === 'name'){
      const known = state.items.find(i =>
        i.category === 'ingredient' && i.name.toLowerCase() === cl.value.trim().toLowerCase());
      if(known){
        if(line.priceNum === '' || line.priceNum == null){
          line.priceNum = known.cost;       // your stocked cost is per unit
          line.priceMode = 'unit';
          syncUnitText(line);
          const box = document.querySelector(`[data-cl="priceNum"][data-fid="${f.id}"][data-id="${line.id}"]`);
          if(box) box.value = known.cost;
        }
        // measure it the same way the ingredient is stocked
        if(QTY_UNITS.includes(known.unit) && (!line.qtyUnit || line.qtyUnit === 'pcs')){
          line.qtyUnit = known.unit;
          syncQtyText(line);
          const sel = document.querySelector(`[data-cl="qtyUnit"][data-fid="${f.id}"][data-id="${line.id}"]`);
          if(sel) sel.value = known.unit;
        }
      }
    }
    // Quantity or price changed, so recost the row
    const auto = applyAutoCost(line);
    if(auto !== null){
      const box = document.querySelector(`[data-cl="total"][data-fid="${f.id}"][data-id="${line.id}"]`);
      if(box && document.activeElement !== box) box.value = auto;
      if(box){
        box.classList.remove('flash-update');
        void box.offsetWidth;   // restart the animation even if it's still fading from the last edit
        box.classList.add('flash-update');
      }
    }
  }
  const caption = document.querySelector(`[data-fd-formula="${line.id}"]`);
  if(caption) caption.textContent = lineFormulaCaption(line);
  saveState();
  refreshCosNumbers();
  scheduleCosFoodSync(f);
}));

// Buttons inside the food cards

document.getElementById('cos-foods').addEventListener('click', e=>{
  const add = e.target.closest('[data-fd-addline]');
  if(add){
    const f = cosFood(add.dataset.fdAddline); if(!f) return;
    (f.lines = f.lines || []).push({id: state.nextCosLineId++, name:'',
      qtyNum:1, qtyUnit:'pcs', qty:'1 pcs',
      priceNum:'', priceMode:'unit', unit:'', total:0});
    saveState(); renderCos();
    scheduleCosFoodSync(f);
    const boxes = document.querySelectorAll(`[data-cl="name"][data-fid="${f.id}"]`);
    if(boxes.length) boxes[boxes.length-1].focus();
    return;
  }

  const edit = e.target.closest('[data-fd-edit]');
  if(edit){
    const f = cosFood(edit.dataset.fdEdit); if(!f) return;
    f.collapsed = false;        // open it
    f.pricesHidden = false;     // and show what you came to change
    saveState(); renderCos();
    scheduleCosFoodSync(f);
    const box = document.querySelector(`[data-cl="name"][data-fid="${f.id}"]`);
    if(box) box.scrollIntoView({block:'center'});
    return;
  }

  const save = e.target.closest('[data-fd-save]');
  if(save){
    const f = cosFood(save.dataset.fdSave); if(!f) return;
    if(!(f.lines||[]).length) return toast('Add an ingredient first', true);

    const finish = async (note)=>{
      f.saved = Date.now();
      f.pricesHidden = true;
      f.collapsed = true;
      try{
        await syncFoodToPOSAndPersist(f);
      }catch(err){
        toast(err.message || 'Could not save that food', true);
        return;
      }
      saveState(); renderAll();
      toast(note);
    };

    // Already taken once — don't take it twice
    if(f.deductedAt){
      return finish(`${f.name || 'Food'} saved — stock was already taken`);
    }

    const plan = planDeduction(f);

    if(!plan.take.length && !plan.missing.length && !plan.mismatch.length){
      return finish(`${f.name || 'Food'} saved`);
    }

    const rows = plan.take.map(t=>{
      const after = Math.round((t.item.stock - Math.min(t.qty, t.item.stock))*1000)/1000;
      const converted = t.plannedUnit !== t.unit;
      const usedCell = converted
        ? `${round2(t.plannedQty)} ${escapeHtml(t.plannedUnit)} <span class="muted">(${round2(t.qty)} ${escapeHtml(t.unit)})</span>`
        : `${round2(t.qty)} ${escapeHtml(t.unit)}`;
      return `<tr><td>${escapeHtml(t.name)}</td>
        <td class="num">${usedCell}</td>
        <td class="num muted">${t.item.stock} → ${after}</td></tr>`;
    }).join('');

    confirmAction('Take ingredients from stock',
      `<div class="hint">Saving <strong style="color:var(--text)">${escapeHtml(f.name||'this food')}</strong>
         removes these from your Ingredients inventory:</div>
       ${rows ? `<table style="margin-top:12px;"><thead><tr>
         <th>Ingredient</th><th class="num">Used</th><th class="num">Stock</th>
       </tr></thead><tbody>${rows}</tbody></table>` : ''}
       ${plan.short.length ? `<div class="hint" style="margin-top:12px;color:var(--red);">
         Not enough of ${plan.short.map(x=>escapeHtml(x.name)).join(', ')} — stock goes to zero
         rather than negative.</div>` : ''}
       ${plan.missing.length ? `<div class="hint" style="margin-top:12px;color:var(--yellow);">
         Not in your Ingredients list, so nothing is deducted for:
         ${plan.missing.map(escapeHtml).join(', ')}.</div>` : ''}
       ${plan.mismatch.length ? `<div class="hint" style="margin-top:12px;color:var(--yellow);">
         Unit mismatch, skipped: ${plan.mismatch.map(m=>
           `${escapeHtml(m.name)} planned in ${escapeHtml(m.planned)} but stocked in ${escapeHtml(m.stocked)}`
         ).join('; ')}.</div>` : ''}`,
      'Save and take stock', ()=>{
        applyDeduction(f, plan);
        finish(`${f.name || 'Food'} saved — ${plan.take.length} ingredient${plan.take.length===1?'':'s'} taken from stock`);
      }, false);
    return;
  }

  const prices = e.target.closest('[data-fd-prices]');
  if(prices){
    const f = cosFood(prices.dataset.fdPrices); if(!f) return;
    f.pricesHidden = !f.pricesHidden;
    saveState(); renderCos();
    scheduleCosFoodSync(f);
    return;
  }

  const toggle = e.target.closest('[data-fd-toggle]');
  if(toggle){
    const f = cosFood(toggle.dataset.fdToggle); if(!f) return;
    f.collapsed = !f.collapsed;
    saveState(); renderCos();
    scheduleCosFoodSync(f);
    return;
  }

  const delFood = e.target.closest('[data-fd-del]');
  if(delFood){
    const f = cosFood(delFood.dataset.fdDel); if(!f) return;
    if(cosFoods().length <= 1) return toast('Keep at least one food', true);
    const t = foodTotals(f);
    confirmAction('Remove food',
      `<div class="hint">Remove <strong style="color:var(--text)">${escapeHtml(f.name||'this food')}</strong>
         and its ${(f.lines||[]).length} ingredient line${(f.lines||[]).length===1?'':'s'}?</div>
       <div class="hint" style="margin-top:10px;color:var(--green);">
         That removes ${peso(t.cost)} of planned ingredients.</div>`,
      'Remove', async ()=>{
        const back = returnDeduction(f);      // put the ingredients back
        flushCosFoodSync(f);
        try{
          if(f.linkedItemId) await dbDeleteItem(f.linkedItemId);   // fully remove it from POS
          await dbDeleteCosFood(f.id);
        }catch(err){
          toast(err.message || 'Could not remove that food', true);
          return;
        }
        if(f.linkedItemId){
          state.items = state.items.filter(i => i.id !== f.linkedItemId);
        }
        const plan = activePlan();
        plan.foods = cosFoods().filter(x => x.id !== f.id);
        saveState(); renderAll();
        toast(back ? `Food removed — ${back} ingredient${back===1?'':'s'} returned to stock, taken off Point of Sale`
                   : 'Food removed and taken off Point of Sale');
      });
    return;
  }

  const auto = e.target.closest('[data-cl-auto]');
  if(auto){
    const f = cosFood(auto.dataset.fid); if(!f) return;
    const line = f.lines.find(l => l.id === Number(auto.dataset.clAuto)); if(!line) return;
    line.manual = false;
    const got = applyAutoCost(line);
    saveState(); renderCos();
    scheduleCosFoodSync(f);
    toast(got !== null ? `Recosted to ${peso(got)}` : 'Add a number to quantity and unit price', got === null);
    return;
  }

  const delLine = e.target.closest('[data-cl-del]');
  if(delLine){
    const f = cosFood(delLine.dataset.fid); if(!f) return;
    f.lines = f.lines.filter(l => l.id !== Number(delLine.dataset.clDel));
    scheduleCosFoodSync(f);
    saveState(); renderCos();
  }
});

document.getElementById('btnCosAddFood').addEventListener('click', async ()=>{
  if(!activePlan()) return toast('Create a plan for a date first', true);
  let f;
  try{
    f = await newCosFood('New Food');
  }catch(err){
    return toast(err.message || 'Could not create that food', true);
  }
  saveState(); renderCos();
  const box = document.querySelector(`[data-fd="name"][data-id="${f.id}"]`);
  if(box){ box.focus(); box.select(); box.scrollIntoView({block:'center'}); }
});

/* ---------- Saving and history ---------- */

/* Editing already writes to storage on every keystroke, so this does not
   rescue unsaved work. What it does is mark the plan as finished, which is
   what puts a date on it in the history below. */
/* querySelector is not shimmed, so these are real tests of what is in this
   build — the planner is the cashier app, Plan History is the admin app. */
const hasCosPage     = () => !!document.querySelector('#view-cos');
const hasPlanHistory = () => !!document.querySelector('#cos-history');

/* Plan History's own From/To filter — separate from the Sales History
   date range above it, since a saved plan's date and a recorded sale's
   date are different things. plan.date is already 'YYYY-MM-DD', so a
   plain string comparison sorts correctly without parsing. */
let planHistoryFrom = null, planHistoryTo = null;

function readPlanHistoryDates(){
  planHistoryFrom = document.getElementById('php-from').value || null;
  planHistoryTo   = document.getElementById('php-to').value   || null;
}

function planHistoryRows(){
  return cosPlans().filter(p=>{
    const d = p.date || '';
    if(planHistoryFrom && d < planHistoryFrom) return false;
    if(planHistoryTo   && d > planHistoryTo)   return false;
    return true;
  });
}

function renderCosHistory(){
  if(!hasPlanHistory()) return;
  const plans = planHistoryRows().slice()
    .sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
  const body = document.getElementById('cos-history');
  const foot = document.getElementById('cos-history-foot');

  if(!plans.length){
    const filtered = planHistoryFrom != null || planHistoryTo != null;
    body.innerHTML = `<tr class="empty-row"><td colspan="11">${filtered
      ? 'No plans in these dates. Try a wider range.'
      : 'No plans yet.'}</td></tr>`;
    foot.innerHTML = '';
    return;
  }
  let gC=0, gS=0, gP=0;
  body.innerHTML = plans.map(p=>{
    const T = planTotals(p);
    gC+=T.cost; gS+=T.actualSales; gP+=T.actualProfit;
    const me = p.id === state.cosActiveId;
    const losing = T.actualProfit < 0;
    const d = new Date(p.date + 'T00:00:00');
    return `<tr${me ? ' style="background:var(--cyan-dim);"' : ''}>
      <td class="name">${escapeHtml(p.name || 'Untitled Plan')}
        <div class="sub">${isNaN(d) ? escapeHtml(p.date||'—')
          : d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</div>
        ${me ? '<span class="chip">open</span>' : ''}</td>
      <td class="num">${(p.foods||[]).length}</td>
      <td class="num">${peso(T.cost)}</td>
      <td class="num">${T.served}/${T.servings}</td>
      <td class="num">${peso(T.actualSales)}</td>
      <td class="num strong" style="color:${losing?'var(--red)':'var(--green)'}">${peso(T.actualProfit)}</td>
      <td class="num" style="white-space:nowrap;">
        ${(me || !hasCosPage()) ? '' : `<button class="btn small ghost" data-ch-open="${p.id}" title="Open this plan">Open</button>`}
        <button class="btn small" data-ch-dl="${p.id}" title="Download this plan">⬇</button>
        <button class="btn small danger" data-ch-del="${p.id}" title="Delete this plan">×</button>
      </td>
    </tr>`;
  }).join('');

  foot.innerHTML = `<tr class="total-row">
    <td>ALL PLANS — ${plans.length}</td>
    <td class="num">${plans.reduce((n,p)=>n+(p.foods||[]).length,0)}</td>
    <td class="num strong">${peso(gC)}</td><td></td>
    <td class="num strong">${peso(gS)}</td>
    <td class="num strong" style="color:${gP<0?'var(--red)':'var(--green)'}">${peso(gP)}</td>
    <td colspan="2"></td>
  </tr>`;
}

/* Shared by both delete-plan entry points below. Supabase cascades
   cos_plans -> cos_foods -> cos_food_lines on delete, but a mirrored POS
   item only gets its source_plan_id/source_food_id nulled (on delete set
   null), not removed — so linked items need an explicit delete too, same
   as the client always intended ("taken off POS too"). */
async function deleteCosPlanAndLinkedItems(p){
  const linkedIds = (p.foods||[]).map(f=>f.linkedItemId).filter(Boolean);
  for(const id of linkedIds) await dbDeleteItem(id);
  await dbDeleteCosPlan(p.id);
  return linkedIds;
}

document.getElementById('cos-history').addEventListener('click', e=>{
  const open = e.target.closest('[data-ch-open]');
  if(open){
    state.cosActiveId = Number(open.dataset.chOpen);
    saveState();
    renderCos();
    document.getElementById('cos-main').scrollIntoView({block:'start'});
    return;
  }
  const dl = e.target.closest('[data-ch-dl]');
  if(dl){
    const p = cosPlans().find(x => x.id === Number(dl.dataset.chDl));
    if(!p) return toast('That plan is no longer available', true);
    const safe = (p.name || 'plan').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'plan';
    downloadCosSheet(buildCosPlanSheet(p), `cos-plan-${safe}-${p.date||isoDate(new Date())}`, `${p.name || 'Plan'} downloaded`);
    return;
  }
  const del = e.target.closest('[data-ch-del]');
  if(del){
    const p = cosPlans().find(x => x.id === Number(del.dataset.chDel));
    if(!p) return;
    const T = planTotals(p);
    const linkedCount = (p.foods||[]).filter(f=>f.linkedItemId).length;
    confirmAction('Delete plan',
      `<div class="hint">Delete the plan for
         <strong style="color:var(--text)">${escapeHtml(planLabel(p))}</strong>?</div>
       <div class="hint" style="margin-top:10px;">
         ${(p.foods||[]).length} food${(p.foods||[]).length===1?'':'s'},
         ${peso(T.cost)} of planned ingredients.</div>
       ${linkedCount ? `<div class="hint" style="margin-top:10px;color:var(--yellow);">
         ${linkedCount} of these ${linkedCount===1?'is':'are'} currently on Point of Sale —
         ${linkedCount===1?'it':'they'} will be taken off POS too.</div>` : ''}
       <div class="hint" style="margin-top:10px;color:var(--yellow);">
         This is planning data — your ingredient stock and past sales records are not touched.</div>`,
      'Delete plan', async ()=>{
        let linkedIds;
        try{
          linkedIds = await deleteCosPlanAndLinkedItems(p);
        }catch(err){
          return toast(err.message || 'Could not delete that plan', true);
        }
        if(linkedIds.length) state.items = state.items.filter(i => !linkedIds.includes(i.id));
        state.cosPlans = cosPlans().filter(x => x.id !== p.id);
        if(state.cosActiveId === p.id)
          state.cosActiveId = cosPlans()[0] ? cosPlans()[0].id : null;
        saveState(); renderAll();
        toast(linkedIds.length ? `Plan deleted — ${linkedIds.length} item${linkedIds.length===1?'':'s'} taken off Point of Sale` : 'Plan deleted');
      });
  }
});

document.getElementById('btnDownloadAllPlans').addEventListener('click', downloadAllCosPlans);

/* ---------- Plans: pick, create, delete ---------- */

/* Rename the plan straight from its header */
const cosPlanRenameTimers = new Map();
document.getElementById('cos-plan-name').addEventListener('input', e=>{
  const p = activePlan(); if(!p) return;
  p.name = e.target.value;
  saveState();
  const pick = document.getElementById('cos-plan-pick');
  const opt = pick.querySelector(`option[value="${p.id}"]`);
  if(opt) opt.textContent = planLabel(p);

  if(cosPlanRenameTimers.has(p.id)) clearTimeout(cosPlanRenameTimers.get(p.id));
  cosPlanRenameTimers.set(p.id, setTimeout(async ()=>{
    cosPlanRenameTimers.delete(p.id);
    try{
      await dbUpdateCosPlanName(p.id, p.name);
    }catch(err){
      toast('Could not save the plan name: ' + err.message, true);
    }
  }, COS_SYNC_DEBOUNCE_MS));
});

document.getElementById('cos-plan-pick').addEventListener('change', e=>{
  state.cosActiveId = Number(e.target.value);
  saveState();
  renderCos();
});

/* The start card, shown when no plan exists */
document.getElementById('btnCosCreate').addEventListener('click', async ()=>{
  const date   = document.getElementById('cos-new-date').value;
  if(!date)     return toast('Pick the date you are planning for', true);
  try{
    await newCosPlan(document.getElementById('cos-new-name').value, date);
  }catch(err){
    return toast(err.message || 'Could not create that plan', true);
  }
  saveState();
  renderCos();
  toast('Plan created — now add your foods');
});

/* Date first, then the plan exists and foods can go in it */
document.getElementById('btnCosNewPlan').addEventListener('click', ()=>{
  openModal('New Plan', `
    <div class="field"><label>Plan name</label>
      <input type="text" id="np-name" placeholder="e.g. Monday Menu"/></div>
    <div class="field"><label>Plan date</label>
      <input type="date" id="np-date" value="${isoDate(new Date())}"/></div>
    <div class="hint" style="margin-top:10px;">
      Foods you add afterwards belong to this date.</div>
  `, `<button class="btn ghost" id="np-cancel">Cancel</button>
      <button class="btn primary" id="np-save">Create Plan</button>`);

  document.getElementById('np-cancel').addEventListener('click', closeModal);
  document.getElementById('np-save').addEventListener('click', async ()=>{
    const name   = document.getElementById('np-name').value.trim();
    const date   = document.getElementById('np-date').value;
    if(!name)       return toast('Give the plan a name', true);
    if(!date)       return toast('Pick a date', true);
    if(cosPlans().some(p => p.date === date))
      return toast('There is already a plan for that date', true);
    try{
      await newCosPlan(name, date);
    }catch(err){
      return toast(err.message || 'Could not create that plan', true);
    }
    saveState(); closeModal(); renderCos();
    toast('Plan created — now add your foods');
  });
});

document.getElementById('btnCosDeletePlan').addEventListener('click', ()=>{
  const p = activePlan();
  if(!p) return toast('No plan to delete', true);
  const T = programTotals();
  const linkedCount = (p.foods||[]).filter(f=>f.linkedItemId).length;
  confirmAction('Delete plan',
    `<div class="hint">Delete the plan for
       <strong style="color:var(--text)">${escapeHtml(planLabel(p))}</strong>?</div>
     <div class="hint" style="margin-top:10px;">
       That removes ${(p.foods||[]).length} food${(p.foods||[]).length===1?'':'s'}
       and ${peso(T.cost)} of planned ingredients.</div>
     ${linkedCount ? `<div class="hint" style="margin-top:10px;color:var(--yellow);">
       ${linkedCount} of these ${linkedCount===1?'is':'are'} currently on Point of Sale —
       ${linkedCount===1?'it':'they'} will be taken off POS too.</div>` : ''}
     <div class="hint" style="margin-top:10px;color:var(--yellow);">
       This is planning data — your ingredient stock and past sales records are not touched.</div>`,
    'Delete plan', async ()=>{
      let linkedIds;
      try{
        linkedIds = await deleteCosPlanAndLinkedItems(p);
      }catch(err){
        return toast(err.message || 'Could not delete that plan', true);
      }
      if(linkedIds.length) state.items = state.items.filter(i => !linkedIds.includes(i.id));
      state.cosPlans = cosPlans().filter(x => x.id !== p.id);
      state.cosActiveId = cosPlans()[0] ? cosPlans()[0].id : null;
      saveState();
      renderAll();
      toast(linkedIds.length ? `Plan deleted — ${linkedIds.length} item${linkedIds.length===1?'':'s'} taken off Point of Sale` : 'Plan deleted');
    });
});

/* ---------- Export ---------- */

/* Builds the same "one plan" report sheet used by both the COS page's own
   export (if that page is ever re-enabled) and the Plan History downloads
   below — one source of truth for what a plan's report looks like. */
function buildCosPlanSheet(plan){
  const P = planTotals(plan);
  const sheet = [
    ['COST OF SALES — PLANNING PROGRAM'],
    ['Plan', plan ? plan.name : ''],
    [],
    ['Prepared', new Date().toLocaleString()],
    ['Prepared by', currentUser ? currentUser.name : '—'],
    ['Plan date', plan ? plan.date : ''],
    []
  ];

  P.foods.forEach(({food, t}, n)=>{
    sheet.push([`${n+1}. ${(food.name||'Untitled').toUpperCase()}`]);
    sheet.push(['No.','Ingredient','Quantity','Unit Price','Total Cost']);
    (food.lines||[]).forEach((l,i)=>
      sheet.push([i+1, l.name||'', l.qty||'', l.unit||'', round2(l.total)]));
    sheet.push(['','','','Ingredient Cost',   round2(t.cost)]);
    sheet.push(['','','','Servings',          t.servings]);
    sheet.push(['','','','Price per Serving', round2(t.price)]);
    sheet.push(['','','','Cost per Serving',  round2(t.perServing)]);
    sheet.push(['','','','Potential Sales',   round2(t.sales)]);
    sheet.push(['','','','Profit',            round2(t.profit)]);
    sheet.push([]);
  });

  sheet.push(
    ['Total Ingredient Cost', round2(P.cost)],
    [],
    ['PRODUCTION AND SALES PLAN'],
    ['Foods Planned', P.foods.length],
    ['Total Servings', P.servings],
    ['Average Cost per Serving', round2(P.servings>0 ? P.cost/P.servings : 0)],
    ['Total Potential Sales', round2(P.sales)],
    [],
    ['EXPECTED PROFIT'],
    ['Total Sales', round2(P.sales)],
    ['Less: Ingredient Cost', round2(P.cost)],
    ['Expected Gross Profit', round2(P.profit)],
    ['Gross Profit Margin', (P.sales>0 ? P.margin.toFixed(1) : '0.0') + '%']
  );
  return sheet;
}

/* Writes a single sheet (one plan) to .xlsx, or .csv if the Excel library
   did not load (e.g. no internet). */
async function downloadCosSheet(sheet, filename, successMsg){
  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws['!cols'] = [{wch:6},{wch:24},{wch:18},{wch:18},{wch:16}];
    XLSX.utils.book_append_sheet(wb, ws, 'Cost of Sales');
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(successMsg);
    return;
  }
  const csv = sheet.map(r => (r||[]).map(c=>{
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

/* Every saved plan, one sheet each, in one workbook (or one CSV with each
   plan's block one after another when Excel is unavailable). */
async function downloadAllCosPlans(){
  const plans = planHistoryRows();
  const filtered = planHistoryFrom != null || planHistoryTo != null;
  if(!plans.length) return toast(filtered ? 'No plans in this range' : 'No plans saved yet', true);
  const filename = `cos-plans-${filtered ? 'range' : 'all'}-${isoDate(new Date())}`;

  if(typeof XLSX !== 'undefined'){
    const wb = XLSX.utils.book_new();
    plans.forEach((p,n)=>{
      const ws = XLSX.utils.aoa_to_sheet(buildCosPlanSheet(p));
      ws['!cols'] = [{wch:6},{wch:24},{wch:18},{wch:18},{wch:16}];
      // Sheet names can't repeat or use \/?*[] — keep them short and unique.
      const safe = (p.name || `Plan ${n+1}`).replace(/[\\/?*\[\]:]/g,'').slice(0,28) || `Plan ${n+1}`;
      XLSX.utils.book_append_sheet(wb, ws, safe);
    });
    const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
    const ok = await saveGeneratedFile(filename+'.xlsx',
      new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    if(ok) toast(`Downloaded ${plans.length} plan${plans.length===1?'':'s'}`);
    return;
  }
  const blocks = plans.map(p => buildCosPlanSheet(p).map(r => (r||[]).map(c=>{
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  }).join(',')).join('\n'));
  const blob = new Blob([blocks.join('\n\n')], {type:'text/csv;charset=utf-8;'});
  const ok = await saveGeneratedFile(filename+'.csv', blob);
  if(ok) toast('Excel library offline — saved as CSV instead');
}

document.getElementById('btnCosExport').addEventListener('click', ()=>{
  const plan = activePlan();
  if(!plan) return toast('No plan to export', true);
  downloadCosSheet(buildCosPlanSheet(plan), `cos-planning-${isoDate(new Date())}`, 'Program exported');
});

/* ============================= CLOCK ============================= */


/* ===================== PLANNING -> REAL STOCK =====================
   Pressing Save on a food takes its ingredients out of the Ingredients
   inventory and writes a stock movement, so the plan and the shelf agree.
   Matching is by ingredient name, and only when the units line up — taking
   "100 ml" out of something stocked in kg would quietly corrupt the count. */

function ingredientByName(name){
  const n = String(name||'').trim().toLowerCase();
  if(!n) return null;
  return state.items.find(i => i.category === 'ingredient' && i.name.toLowerCase() === n) || null;
}

/* Works out what would happen, without changing anything. */
function planDeduction(food){
  const take = [], missing = [], mismatch = [], short = [];
  (food.lines||[]).forEach(l=>{
    const name = String(l.name||'').trim();
    const qty  = Number(l.qtyNum) || 0;
    if(!name || qty <= 0) return;

    const item = ingredientByName(name);
    if(!item){ missing.push(name); return; }

    const plannedUnit = l.qtyUnit || '';
    let deductQty = qty;
    if(plannedUnit !== item.unit){
      const converted = convertQty(qty, plannedUnit, item.unit);
      if(converted === null){
        mismatch.push({name, planned:plannedUnit||'—', stocked:item.unit});
        return;
      }
      deductQty = converted;
    }
    if(deductQty > item.stock) short.push({name, need:deductQty, have:item.stock, unit:item.unit});
    take.push({
      item, qty:deductQty, unit:item.unit, name:item.name,
      plannedQty:qty, plannedUnit:plannedUnit||item.unit
    });
  });
  return {take, missing, mismatch, short};
}

function applyDeduction(food, plan){
  plan.take.forEach(({item, qty})=>{
    const used = Math.min(qty, item.stock);       // never drive stock negative
    item.stock = Math.round((item.stock - used) * 1000) / 1000;
    // Menu Plan isn't fully migrated to Supabase yet (a later phase), but
    // leaving this stock change unpersisted would silently revert on the
    // next reload — fire-and-forget it now rather than restructure every
    // caller in this file into async just for that.
    dbUpdateItemStock(item.id, item.stock).catch(err =>
      toast('Could not save that stock change: ' + err.message, true));
    logActivity(item, 'out', used, 'used').catch(err =>
      toast('Could not save that movement: ' + err.message, true));
  });
  food.deductedAt = Date.now();
  food.deducted   = plan.take.map(t => ({name:t.name, qty:t.qty, unit:t.unit}));
}

/* Puts back exactly what a food took, used when it is removed. */
function returnDeduction(food){
  if(!Array.isArray(food.deducted)) return 0;
  let n = 0;
  food.deducted.forEach(({name, qty})=>{
    const item = ingredientByName(name);
    if(!item) return;
    item.stock = Math.round((item.stock + qty) * 1000) / 1000;
    dbUpdateItemStock(item.id, item.stock).catch(err =>
      toast('Could not save that stock change: ' + err.message, true));
    logActivity(item, 'in', qty, 'correct_in').catch(err =>
      toast('Could not save that movement: ' + err.message, true));
    n++;
  });
  food.deducted = null;
  food.deductedAt = null;
  return n;
}
