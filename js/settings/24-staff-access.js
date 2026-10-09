/* ===== js/settings/24-staff-access.js =====
   Lets an Admin switch Staff access to Products, Point of Sale, and
   Food Costing on/off from Settings — a workflow control (e.g. "lock
   Staff out of POS during a stock take"), not a security boundary.
   The real write permissions on items/sales/cos_* are unchanged;
   these three flags only hide the page and block the route, the same
   "hide the link, also block the route" pattern every other
   role-gated page in this app already uses (see navigate()). */

/* Which settings flag backs each toggleable nav view — shared by the
   visibility sweep below and navigate()'s route guard. */
const STAFF_FEATURE_VIEWS = {
  inventory: 'staffProductsEnabled',
  sales:     'staffPosEnabled',
  cos:       'staffFoodCostingEnabled',
  stafftime: 'staffOtherEnabled',   // "Other" nav section — Staff Time Clock + LPG Usage share one toggle
  lpg:       'staffOtherEnabled',
};

/* Admin always sees every page regardless of these flags — they only
   ever restrict Staff. Called after applyRolePermissions()'s own
   data-admin/data-staffonly sweep, so it layers on top rather than
   fighting it. */
function applyStaffFeatureVisibility(){
  if(isAdmin()){
    document.querySelectorAll('[data-feature]').forEach(el => el.style.display = '');
    return;
  }
  document.querySelectorAll('[data-feature]').forEach(el=>{
    const flag = STAFF_FEATURE_VIEWS[el.dataset.feature];
    el.style.display = (flag && state[flag] === false) ? 'none' : '';
  });
}

/* Called from navigate() before it commits to a view — a toggled-off
   feature is blocked for Staff even if reached by typing the route
   directly, not just hidden from the sidebar. */
function staffFeatureBlocked(view){
  if(isAdmin()) return false;
  const flag = STAFF_FEATURE_VIEWS[view];
  return !!flag && state[flag] === false;
}

function renderStaffAccessSettings(){
  if(!isAdmin()) return;   // the card itself is hidden from Staff, but guard anyway
  const rows = [
    ['toggleStaffProducts', 'staffProductsEnabled'],
    ['toggleStaffPos', 'staffPosEnabled'],
    ['toggleStaffFoodCosting', 'staffFoodCostingEnabled'],
    ['toggleStaffOther', 'staffOtherEnabled'],
  ];
  rows.forEach(([id, flag])=>{
    const btn = document.getElementById(id);
    if(!btn) return;
    const on = state[flag] !== false;
    btn.textContent = on ? 'ON' : 'OFF';
    btn.classList.toggle('on', on);
    btn.classList.toggle('off', !on);
  });
}

document.querySelectorAll('[data-staff-toggle]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const flag = btn.dataset.staffToggle;
    const next = !(state[flag] !== false);
    btn.disabled = true;
    try{
      await dbUpdateSettings({ [flag]: next });
      state[flag] = next;
      renderStaffAccessSettings();
      applyStaffFeatureVisibility();
      toast(`Staff ${next ? 'can now use' : 'can no longer use'} that page`, 'success');
    }catch(err){
      toast('Could not save that setting: ' + err.message, true);
    }
    btn.disabled = false;
  });
});
