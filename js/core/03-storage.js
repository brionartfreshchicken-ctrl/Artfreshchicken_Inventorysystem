/* ===== js/core/03-storage.js =====
   Loads/saves the whole app state, plus assorted general-purpose helper functions.
   (Lines 157-405 of the original single-file build.) */

/* 03-storage.js — Loads/saves the whole app state, currently to
   localStorage (or window.storage inside the Claude artifact viewer).

   ---------------------------------------------------------------------
   SWITCHING TO SUPABASE (or any real backend) — start here.

   Right now loadState()/saveState() read and write ONE big JSON blob.
   Every other file in the app just calls these two functions and never
   touches localStorage directly — so a backend swap is almost entirely
   contained to this file.

   Rough plan, easiest to hardest:

   1. Create a Supabase project, then in index.html add, right before
      this file's own <script> tag:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>
      (that closing tag is written with an escaped slash on purpose — the
      real, unescaped tag would break any page that embeds this file's
      code inline instead of loading it as its own file)
      and initialise a client at the top of this file:
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

   2. Least rewrite: keep ONE row per store, with the whole `state`
      object saved as a single jsonb column — e.g. a `stores` table
      with columns (id, data jsonb). Then:
        loadState()  ->  const { data } = await supabase.from('stores')
                            .select('data').eq('id', STORE_ID).single();
                          return data ? data.data : null;
        saveState()  ->  await supabase.from('stores')
                            .update({ data: state }).eq('id', STORE_ID);
      Every other file keeps working unchanged, since they only ever see
      the same `state` object shape they already do.

   3. Better long-term: split `state` into real tables (items, users,
      activity, cos_plans, staff_list, lpg_logs...) with proper columns,
      and change the places that mutate `state.x` directly into calls
      that also write to Supabase. That touches more files — mainly
      11-inventory.js, 13-pos.js, 16-cos.js, and the Others-page code in
      17-boot.js — but gets you multi-device sync, SQL-based reporting,
      and row-level security instead of one big JSON blob per store.

   4. Either way, accounts (06-accounts.js) are a separate piece — see
      the note at the top of that file for moving those to Supabase Auth.
   ---------------------------------------------------------------------
*/

async function loadState(){
  if(hasArtifactStorage){
    try{
      const res = await window.storage.get(STORAGE_KEY, false);
      if(res && res.value) return JSON.parse(res.value);
    }catch(e){ /* fall through */ }
  }
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ /* unreadable */ }
  return null;
}

const STORAGE_KEY = 'cafeteria-inventory-state';

/* Two places the data can live:
     window.storage — exists only inside the Claude artifact viewer
     localStorage   — works everywhere else (own folder, hosted, packaged app)
   Try the first, fall back to the second, so one file runs in both. */

const hasArtifactStorage = typeof window !== 'undefined'
  && window.storage && typeof window.storage.set === 'function';

let storageWarned = false;

async function saveState(){
  const json = JSON.stringify(state);

  if(hasArtifactStorage){
    try{
      const res = await window.storage.set(STORAGE_KEY, json, false);
      if(res) return true;
    }catch(e){ /* fall through */ }
  }
  try{
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  }catch(e){
    // Usually the 5 MB quota, or storage blocked in private mode
    if(!storageWarned){
      storageWarned = true;
      toast('Save failed — storage full or blocked. Download a backup now.', true);
    }
    return false;
  }
}

/* ============================= HELPERS ============================= */

function migrate(st){
  st.items.forEach(i=>{ if(typeof i.size !== 'string') i.size = ''; });
  // Accounts moved to Supabase Auth + the profiles table — a leftover
  // `users` list from an old save is just dropped, never migrated.
  delete st.users;
  delete st.nextUserId;

  /* Activity logged before reports existed has no reason or prices.
     Mark it 'adjust' so it shows in the log but never counts as benta —
     guessing would make the reports lie. */
  if(!Array.isArray(st.activity)) st.activity = [];
  if(typeof st.nextActivityId !== 'number') st.nextActivityId = 1000;
  if(typeof st.retentionDays !== 'number') st.retentionDays = 0;

  // Accounts from before the Others page (staff directory + LPG log) existed
  if(!Array.isArray(st.staffList)) st.staffList = [];
  if(!Array.isArray(st.lpgLogs)) st.lpgLogs = [];
  if(typeof st.nextStaffId !== 'number')
    st.nextStaffId = st.staffList.reduce((m,s)=>Math.max(m,s.id||0),0) + 1;
  if(typeof st.nextLpgId !== 'number')
    st.nextLpgId = st.lpgLogs.reduce((m,s)=>Math.max(m,s.id||0),0) + 1;
  if(typeof st.lastPurge === 'undefined') st.lastPurge = null;
  // Staff saved before the work calendar existed have no marked dates —
  // there is no way to know which days they actually worked in the past,
  // so this starts empty. Monthly Cost reads ₱0 for day-wage staff until
  // someone marks this month's days on their calendar.
  st.staffList.forEach(s=>{
    delete s.workDays;   // superseded by workDates (actual calendar dates)
    if(!Array.isArray(s.workDates)) s.workDates = [];
  });

  // Accounts from before Suppliers/Purchases (Phase 3) existed
  if(!Array.isArray(st.suppliers)) st.suppliers = [];
  if(!Array.isArray(st.purchases)) st.purchases = [];
  if(typeof st.docSeq !== 'object' || !st.docSeq) st.docSeq = {};
  if(typeof st.nextSupplierId !== 'number')
    st.nextSupplierId = st.suppliers.reduce((m,s)=>Math.max(m,s.id||0),0) + 1;
  if(typeof st.nextPurchaseId !== 'number')
    st.nextPurchaseId = st.purchases.reduce((m,p)=>Math.max(m,p.id||0),0) + 1;
  // Accounts from before per-transaction Sales History (Phase 4) existed
  if(!Array.isArray(st.sales)) st.sales = [];
  if(typeof st.nextSaleId !== 'number')
    st.nextSaleId = st.sales.reduce((m,s)=>Math.max(m,s.id||0),0) + 1;
  // Accounts from before Operating Expenses / Recipes / Production (Phase 5) existed
  if(!Array.isArray(st.expenses)) st.expenses = [];
  if(typeof st.nextExpenseId !== 'number')
    st.nextExpenseId = st.expenses.reduce((m,e)=>Math.max(m,e.id||0),0) + 1;
  if(typeof st.gcashQrImage === 'undefined') st.gcashQrImage = null;
  if(!Array.isArray(st.recipes)) st.recipes = [];
  if(typeof st.nextRecipeId !== 'number')
    st.nextRecipeId = st.recipes.reduce((m,r)=>Math.max(m,r.id||0),0) + 1;
  if(!Array.isArray(st.productions)) st.productions = [];
  if(typeof st.nextProductionId !== 'number')
    st.nextProductionId = st.productions.reduce((m,p)=>Math.max(m,p.id||0),0) + 1;
  // Items saved before SKU / min-max / supplier / unit conversion existed
  st.items.forEach(i=>{
    if(typeof i.sku !== 'string') i.sku = '';
    if(i.maxStock === undefined) i.maxStock = null;
    if(i.supplierId === undefined) i.supplierId = null;
    if(!i.conv || typeof i.conv !== 'object') i.conv = null;   // {unit, qty} — estimated only
  });
  st.activity.forEach(a=>{
    if(typeof a.id !== 'number') a.id = st.nextActivityId++;   // needed for delete
    if(!a.reason) a.reason = 'adjust';
    if(a.cost === undefined) a.cost = 0;
    if(a.selling === undefined) a.selling = null;
    if(!a.category){
      const it = st.items.find(i => i.id===a.itemId || displayName(i)===a.name);
      a.category = it ? it.category : 'snack';
      if(it && a.itemId===undefined) a.itemId = it.id;
    }
  });

  /* Cost-of-sales planning. Older saves have none of this. */
  /* COS used to be a flat list of foods with one global budget. Fold that
     into a single dated plan so nothing is lost. */
  // Accounts that existed before Menu Planning did have no cosPlans
  // field at all — give them the same starter plan a new install gets,
  // so History and Today's Menu Plan aren't stuck empty forever.
  // An account that already has the field (even an empty array, because
  // every plan was deleted on purpose) is left exactly as it is.
  const cosPlansMissing = !Array.isArray(st.cosPlans);
  if(cosPlansMissing) st.cosPlans = [];
  const flat = st.cosPlans.length && !st.cosPlans[0].foods;
  if(flat){
    st.cosPlans = [{
      id: 1,
      date: isoDate(new Date()),
      created: Date.now(),
      foods: st.cosPlans
    }];
  }
  delete st.companyBudget;
  /* Used to backfill a sample plan here for saves from before Menu
     Planning existed. Fresh installs stopped shipping one (nothing
     should show up that nobody typed in), so an upgrade shouldn't
     either — it now just starts empty, same as a new install. */
  /* Plans used to be identified by date alone. Give the older ones a name
     so the picker and the header have something to show. */
  /* Older saves have no per-food price visibility, and plans may still
     carry a budget field that is no longer used. */
  st.cosPlans.forEach(pl=>{
    delete pl.budget;
    (pl.foods||[]).forEach(f=>{
      if(typeof f.pricesHidden !== 'boolean') f.pricesHidden = false;
      if(typeof f.saved === 'undefined') f.saved = null;
      if(typeof f.deductedAt === 'undefined') f.deductedAt = null;
      if(f.deducted === undefined) f.deducted = null;

      /* Quantity used to be free text like "2 kg". Split it into a number
         and a unit so the dropdown has something to show. */
      (f.lines||[]).forEach(l=>{
        if(l.qtyNum !== undefined) return;
        const m = String(l.qty || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*(.*)$/);
        l.qtyNum  = m ? parseFloat(m[1]) : '';
        const rest = m ? m[2].trim().toLowerCase() : '';
        const known = ['pcs','kg','g','l','ml','pack','bottle','can','sachet','bulb','tray','cup','tbsp','tsp'];
        const hit = known.find(u => rest === u || rest.startsWith(u));
        l.qtyUnit = hit ? (hit === 'l' ? 'L' : hit) : 'pcs';

        /* Unit price was text like "125 / kg". Older lines were always
           per-unit, so that is the safe assumption. */
        if(l.priceNum === undefined){
          const pm = String(l.unit || '').match(/-?\d+(?:\.\d+)?/);
          l.priceNum  = pm ? parseFloat(pm[0]) : '';
          l.priceMode = 'unit';
        }
      });
    });
  });
  st.cosPlans.forEach(pl=>{
    if(typeof pl.name !== 'string' || !pl.name.trim()) pl.name = 'Plan for ' + (pl.date || 'unknown date');
  });
  st.cosPlans.forEach(pl=>{
    if(!Array.isArray(pl.foods)) pl.foods = [];
    if(!pl.date) pl.date = isoDate(new Date(pl.created || Date.now()));
    pl.foods.forEach(f=>{
      delete f.budget;
      if(typeof f.served !== 'number') f.served = 0;
    });
  });
  if(typeof st.nextCosPlanId !== 'number')
    st.nextCosPlanId = st.cosPlans.reduce((m,pl)=>Math.max(m, pl.id||0), 0) + 1;
  if(!st.cosActiveId || !st.cosPlans.some(pl=>pl.id===st.cosActiveId))
    st.cosActiveId = st.cosPlans[0] ? st.cosPlans[0].id : null;
  if(typeof st.nextCosId !== 'number')
    st.nextCosId = st.cosPlans.reduce((m,pl)=>Math.max(m,
      pl.foods.reduce((n,f)=>Math.max(n, f.id||0), 0)), 0) + 1;
  if(typeof st.nextCosLineId !== 'number')
    st.nextCosLineId = st.cosPlans.reduce((m,pl)=>Math.max(m,
      pl.foods.reduce((n,f)=>Math.max(n,
        (f.lines||[]).reduce((k,l)=>Math.max(k, l.id||0), 0)), 0)), 0) + 1;

  return st;
}
