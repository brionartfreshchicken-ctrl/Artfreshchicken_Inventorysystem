/* ===== js/core/22-boot.js =====
   Remaining event wiring (Settings, GCash QR upload) plus init(), which starts the app.
   (Lines 7380-7507 of the original single-file build.) */

/* 17-boot.js — Remaining event wiring (accounts settings, Others page, Switch to Admin) plus init(), which starts the app. */

document.getElementById('app').addEventListener('click', async e=>{
  const btn = e.target.closest('button[data-uact]');
  if(!btn) return;
  if(!isAdmin()) return toast('Admins only', true);

  const u = profilesCache.find(x=>x.id === btn.dataset.uid);
  if(!u) return;

  if(btn.dataset.uact === 'role'){
    const newRole = u.role === 'admin' ? 'staff' : 'admin';
    const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', u.id);
    // The last-admin trigger (0001_profiles.sql) blocks this server-side too —
    // this surfaces that same rule instead of duplicating the count check here.
    if(error) return toast(error.message.includes('last remaining admin')
      ? 'At least one Admin must remain' : error.message, true);
    await refreshProfiles(); renderUsers();
    toast(`${u.name} is now ${newRole==='admin'?'an Admin':'Staff'}`);
  }

  if(btn.dataset.uact === 'del'){
    confirmAction('Remove access',
      `<div class="hint">Remove access for <strong style="color:var(--text)">${escapeHtml(u.name)}</strong>?
       <br><br>They will no longer be able to use FoodTrack. Records they created stay in the log.
       Their underlying sign-in still exists in Supabase Auth — fully deleting it (freeing up
       that Gmail address to sign up again) needs the Supabase dashboard.</div>`,
      'Remove access', async ()=>{
        const { error } = await sb.from('profiles').delete().eq('id', u.id);
        if(error) return toast(error.message.includes('last remaining admin')
          ? 'At least one Admin must remain' : error.message, true);
        await refreshProfiles(); renderUsers();
        toast('Access removed');
      });
  }
});

document.getElementById('app').addEventListener('click', e=>{
  const voidBtn = e.target.closest('[data-void]');
  if(voidBtn){ voidMovement(Number(voidBtn.dataset.void)); return; }
  const delBtn = e.target.closest('[data-delperm]');
  if(delBtn) deleteMovementPermanently(Number(delBtn.dataset.delperm));
});

/* ============================= SALES HISTORY =============================
   Groups every recorded sale into days, weeks or months, each downloadable
   on its own. */

document.getElementById('app').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = Number(btn.dataset.id);
  const item = byId(id);
  if(!item) return;
  const act = btn.dataset.act;
  // Staff can move stock; changing the catalogue is Admin-only
  if(!isAdmin() && ['edit','del','size'].includes(act))
    return toast('Only an Admin can add, edit, or delete items', true);
  if(act==='edit') openItemModal('edit', item.category, item);
  if(act==='del') confirmDelete(item);
  if(act==='in') openQtyModal(item, 'in');
  if(act==='out') openQtyModal(item, 'out');
  if(act==='size'){
    // Start a new line for the same product: name and unit carried over,
    // size and prices left for you to fill in.
    openItemModal('add', item.category, {
      id:null, category:item.category, name:item.name, size:'',
      stock:0, unit:item.unit, cost:item.cost, selling:item.selling,
      threshold:item.threshold
    });
  }
});

/* ============================= MODAL FRAMEWORK ============================= */

function tickClock(){
  const el = document.getElementById('clock');
  if(el) el.textContent = new Date().toLocaleDateString(undefined,
    {weekday:'short', month:'short', day:'numeric', year:'numeric'});
}

setInterval(tickClock, 1000);

/* ============================= INIT ============================= */

/* Older saved data has no `size` field. Fill it in with an empty
   string so nothing shows up as "undefined". */

async function init(){
  const loaded = await loadState();
  if(loaded && loaded.items){
    state = migrate(loaded);
  }else{
    state = defaultState();
    await saveState();
  }
  /* Enforce the retention limit before the first render, so Reports never
     show records that are about to vanish. */
  const purged = applyRetention(true);
  if(purged) console.info(`[retention] removed ${purged} record(s) past the limit`);

  tickClock();
  document.getElementById('loading').style.display = 'none';
  // The app stays hidden until someone signs in
  await showAuthScreen();
}

init();
