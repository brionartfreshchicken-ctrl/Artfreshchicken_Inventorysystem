/* ===== js/core/22-boot.js =====
   Remaining event wiring (Settings, GCash QR upload) plus init(), which starts the app.
   (Lines 7380-7507 of the original single-file build.) */

/* 17-boot.js — Remaining event wiring (accounts settings, Others page, Switch to Admin) plus init(), which starts the app. */

document.getElementById('app').addEventListener('click', async e=>{
  const btn = e.target.closest('button[data-uact]');
  if(!btn) return;
  if(!isAdmin()) return toast('Admins only', true);

  const u = state.users.find(x=>x.id === Number(btn.dataset.uid));
  if(!u) return;

  if(btn.dataset.uact === 'role'){
    // Never allow the last admin to be demoted — you would lock yourself out
    if(u.role==='admin' && state.users.filter(x=>x.role==='admin').length <= 1)
      return toast('At least one Admin must remain', true);
    u.role = u.role === 'admin' ? 'staff' : 'admin';
    await saveState(); renderUsers();
    toast(`${u.name} is now ${u.role==='admin'?'an Admin':'Staff'}`);
  }

  if(btn.dataset.uact === 'pass') openPasswordModal(u);

  if(btn.dataset.uact === 'mail'){
    openModal(`Gmail for ${u.name}`, `
      <div class="field"><label>Gmail address</label>
        <input id="ue-mail" type="email" placeholder="them@gmail.com" value="${escapeHtml(u.email||'')}"/></div>
      <div class="hint" style="margin-top:10px;">Lets this account receive a one-time code when resetting a password. Leave blank to remove.</div>
    `, `<button class="btn ghost" id="ue-cancel">Cancel</button>
        <button class="btn primary" id="ue-save">Save</button>`);
    document.getElementById('ue-cancel').addEventListener('click', closeModal);
    document.getElementById('ue-save').addEventListener('click', async ()=>{
      const em = document.getElementById('ue-mail').value.trim().toLowerCase();
      if(em && !isGmail(em)) return toast('Use a Gmail address ending in @gmail.com', true);
      if(em && state.users.some(x => x.id !== u.id && (x.email||'').toLowerCase() === em))
        return toast('Another account already uses that Gmail', true);
      u.email = em;
      await saveState(); renderUsers(); closeModal();
      toast(em ? `Gmail set for ${u.name}` : `Gmail removed for ${u.name}`);
    });
  }

  if(btn.dataset.uact === 'del'){
    if(u.role==='admin' && state.users.filter(x=>x.role==='admin').length <= 1)
      return toast('At least one Admin must remain', true);
    confirmAction('Remove account',
      `<div class="hint">Remove the account for <strong style="color:var(--text)">${escapeHtml(u.name)}</strong>?
       <br><br>They will no longer be able to sign in. Records they created stay in the log.</div>`,
      'Remove', async ()=>{
        state.users = state.users.filter(x=>x.id !== u.id);
        await saveState(); renderUsers();
        toast('Account removed');
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
  fillQuestionSelect('st-q','st-qcustom-wrap');
  fillQuestionSelect('su-q','su-qcustom-wrap');
  document.getElementById('loading').style.display = 'none';
  // The app stays hidden until someone signs in
  showAuthScreen();
}

init();
