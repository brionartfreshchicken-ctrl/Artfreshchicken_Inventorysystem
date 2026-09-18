/* ===== js/nav/10-nav-dashboard.js =====
   Page routing and role-based access (which pages Admin vs Staff can reach), plus Dashboard rendering.
   (Lines 1511-1692 of the original single-file build.) */

/* 10-nav.js — Page routing and role-based access: which pages Admin vs Staff can reach. */

function navigate(view){
  if(!currentUser) return;                       // no session, no pages
  /* Hiding the link is not enough — block the route too. */
  const ADMIN_ONLY  = ['settings','reports','history','purchases','suppliers','stockmovements','expenses'];
  const STAFF_ONLY  = ['sales','cos','recipes','production'];
  if(ADMIN_ONLY.includes(view) && !isAdmin()){
    toast('That page is for Admins only', true);
    view = 'sales';                                // staff land where they work
  }
  if(STAFF_ONLY.includes(view) && isAdmin()){
    toast('That page is for Staff only', true);
    view = 'dashboard';                             // admins land on the overview
  }
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===view));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+view));

  document.getElementById('pageIcon').textContent  = pageMeta[view].ic || '•';
  document.getElementById('pageTitle').textContent = pageMeta[view].title;
  document.getElementById('pageSub').textContent = pageMeta[view].sub;
  renderAll();
}

document.getElementById('navlist').addEventListener('click', e=>{
  const item = e.target.closest('.nav-item');
  if(!item) return;
  navigate(item.dataset.view);
});

/* ============================= RENDER ============================= */

function statusCounts(items){
  let inC=0, lowC=0, outC=0;
  items.forEach(i=>{ const s=getStatus(i); if(s==='in')inC++; else if(s==='low')lowC++; else outC++; });
  return {inC, lowC, outC};
}

function renderDashboard(){
  const items = state.items;
  const {inC, lowC, outC} = statusCounts(items);
  const totalUnits = items.reduce((a,i)=>a+i.stock,0);

  // Admins no longer have an Inventory page to jump to (that's a Staff
  // page now), so their tiles are plain read-only numbers.
  const tileNav = isAdmin() ? null : 'inventory';

  document.getElementById('statGridTop').innerHTML =
    statTile({tone:'cyan',   ic:'📦', label:'Total Units',   value:totalUnits.toLocaleString(),
              note:'across every product', nav:tileNav, status:'all'}) +
    statTile({tone:'green',  ic:'✅', label:'In Stock',      value:inC,  note:'items healthy',
              nav:tileNav, status:'in'}) +
    statTile({tone:'yellow', ic:'⚠️', label:'Low Stock',     value:lowC, note:'need reordering',
              nav:tileNav, status:'low'}) +
    statTile({tone:'red',    ic:'⛔', label:'Out of Stock',  value:outC, note:'nothing left',
              nav:tileNav, status:'out'});

  // TOTAL PUHUNAN = money currently tied up in stock (cost x quantity, every item)
  const totalPuh   = items.reduce((a,i)=>a+i.cost*i.stock,0);
  const totalSales = items.filter(i=>i.selling!=null).reduce((a,i)=>a+i.selling*i.stock,0);
  const totalTuboV = items.filter(i=>i.selling!=null).reduce((a,i)=>a+(i.selling-i.cost)*i.stock,0);

  /* The value tiles are all money, so staff do not see them. */
  const valueGrid = document.getElementById('statGridValue');
  if(!isAdmin()){
    valueGrid.innerHTML = '';
    valueGrid.style.display = 'none';
  }else{
    valueGrid.style.display = '';
    valueGrid.innerHTML =
    statTile({tone:'magenta', ic:'💰', label:'Total Cost',   value:peso(totalPuh),
              note:'tied up in stock', nav:tileNav, status:'all'}) +
    statTile({tone:'cyan',    ic:'📈', label:'Potential Sales', value:peso(totalSales),
              note:'if everything sells', nav:tileNav, status:'all'}) +
    statTile({tone:'green',   ic:'🌿', label:'Potential Profit',  value:peso(totalTuboV),
              note:'sales minus cost', nav:tileNav, status:'all'}) +
    statTile({tone:'blue',    ic:'🗂', label:'Total Products',  value:items.length,
              note:'counting each size', nav:tileNav, status:'all'});
  }

  const alertItems = items.filter(i=>getStatus(i)!=='in').sort((a,b)=>getStatus(a)==='out'?-1:1);
  const alertsBox = document.getElementById('alertsBox');
  if(alertItems.length===0){
    alertsBox.innerHTML = `<div class="muted" style="font-size:12px;">No alerts — everything is well stocked.</div>`;
  }else{
    alertsBox.innerHTML = alertItems.map(i=>{
      const s = getStatus(i);
      return `<div class="alert-row">
        <div class="alert-left"><span class="dot ${s}"></span>${escapeHtml(displayName(i))} <span class="muted">(${catLabel(i.category)})</span></div>
        <div><span class="muted">${i.stock} ${escapeHtml(i.unit)}</span> &nbsp; <span class="alert-tag ${s}">${statusLabel(s).toUpperCase()}</span></div>
      </div>`;
    }).join('');
  }

  const activityBox = document.getElementById('activityBox');
  if(state.activity.length===0){
    activityBox.innerHTML = `<div class="muted" style="font-size:12px;">No recent activity.</div>`;
  }else{
    activityBox.innerHTML = state.activity.slice(0,6).map(a=>`
      <div class="activity-row">
        <div><span class="who">${escapeHtml(a.name)}</span> <span class="${a.type==='in'?'plus':'minus'}">${a.type==='in'?'+':'-'}${a.qty} ${escapeHtml(a.unit)}</span></div>
        <div>${timeAgo(a.ts)}</div>
      </div>`).join('');
  }
}

function matchesSearch(item, term){
  if(!term) return true;
  // search both the name and the size, so typing "large" finds every large variant
  return displayName(item).toLowerCase().includes(term.toLowerCase());
}

function matchesStatus(item, statusFilter){
  return statusFilter==='all' || getStatus(item)===statusFilter;
}

function renderAll(){
  if(!currentUser) return;                       // nothing to draw while signed out
  renderDashboard();
  renderInventory();
  renderSuppliers();
  renderPurchases();
  renderPOS();
  renderCart();
  renderTodaySales();
  renderTransactions();
  renderHistory();
  renderCos();
  renderRecipes();
  renderProductions();
  renderExpenses();
  renderReports();
  renderUsers();
  renderRetention();
  renderSettingsQr();
  renderCosHistory();
  renderOthers();
  renderProfitability();
}

/* ============================= FILTER EVENTS ============================= */

document.querySelectorAll('[data-filter]').forEach(el=>{
  const evt = el.tagName==='SELECT' ? 'change' : 'input';
  el.addEventListener(evt, ()=>{ filters[el.dataset.filter] = el.value; renderAll(); });
});

/* ============================= DASHBOARD STAT TILES =============================
   Clicking a tile jumps to Inventory, filtered the way the tile is labelled
   (e.g. "Low Stock" opens Inventory with only low-stock items showing). */

function goToFilteredInventory(status){
  filters['inventory-status'] = status;
  filters['inventory-cat']    = 'all';
  filters['inventory-search'] = '';
  // keep the visible dropdowns/search box in sync with the filter we just set
  const catSel = document.querySelector('[data-filter="inventory-cat"]');
  const stSel  = document.querySelector('[data-filter="inventory-status"]');
  const search = document.querySelector('[data-filter="inventory-search"]');
  if(catSel) catSel.value = 'all';
  if(stSel)  stSel.value  = status;
  if(search) search.value = '';
  navigate('inventory');
}

function handleStatTileActivate(e){
  const tile = e.target.closest('[data-stat-nav]');
  if(!tile) return;
  if(tile.dataset.statNav === 'inventory') goToFilteredInventory(tile.dataset.statStatus || 'all');
}

document.getElementById('app').addEventListener('click', handleStatTileActivate);
document.getElementById('app').addEventListener('keydown', e=>{
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const tile = e.target.closest('[data-stat-nav]');
  if(!tile) return;
  e.preventDefault();
  handleStatTileActivate(e);
});

/* ---- Mobile drawer: the hamburger button and sidebar existed already,
   with CSS for the open/closed states, but nothing ever toggled it — on
   a narrow screen the sidebar was simply unreachable. Tapping the menu
   button opens it with a dimmed backdrop; tapping the backdrop, or
   picking a page, closes it again. */

function closeMobileSidebar(){
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}
function openMobileSidebar(){
  document.querySelector('.sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('show');
}

document.getElementById('menuBtn').addEventListener('click', ()=>{
  document.querySelector('.sidebar').classList.contains('open')
    ? closeMobileSidebar() : openMobileSidebar();
});
document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);
document.getElementById('navlist').addEventListener('click', closeMobileSidebar);

/* ============================= ROW ACTIONS (event delegation) ============================= */

