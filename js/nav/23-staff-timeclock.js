/* ===== js/nav/23-staff-timeclock.js =====
   Staff time in / time out. New feature — no original single-file build
   line range to point back to.

   Deliberately separate from the Staff Directory (16-operating-expenses.js
   / the `staff` table) — that's a payroll list an Admin types in by hand,
   never tied to a login account. This is tied to the signed-in account
   itself, and the actual time_in/time_out values always come from the
   database server's own clock (see staff_time_in()/staff_time_out() in
   0029_staff_time_logs.sql) — nothing here ever sends a client-side
   timestamp for either to be trusted as-is. */

function myOpenTimeLog(){
  if(!currentUser) return null;
  return (state.staffTimeLogs||[]).find(l => l.userId === currentUser.id && l.timeOut == null) || null;
}

function formatDuration(ms){
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function doTimeIn(){
  const btns = document.querySelectorAll('[data-tt-action="in"]');
  btns.forEach(b => b.disabled = true);
  try{
    const logId = await dbTimeIn();
    state.staffTimeLogs.unshift({
      id: logId, userId: currentUser.id, name: currentUser.name,
      timeIn: Date.now(), timeOut: null
    });
    toast('Timed in — have a good shift!', 'success');
  }catch(err){
    toast('Could not record Time In: ' + err.message, true);
  }
  renderStaffTime();
}

async function doTimeOut(){
  const open = myOpenTimeLog();
  if(!open) return;
  document.querySelectorAll('[data-tt-action="out"]').forEach(b => b.disabled = true);
  try{
    await dbTimeOut(open.id);
    open.timeOut = Date.now();
    toast('Timed out — see you next shift!', 'success');
  }catch(err){
    toast('Could not record Time Out: ' + err.message, true);
  }
  renderStaffTime();
}

function renderStaffTime(){
  const statusCard = document.getElementById('stt-status-card');
  const statusEl = document.getElementById('stt-status');
  const timeOutBtn = document.getElementById('btnTimeOut');
  if(!statusCard) return;   // view not in the DOM yet (shouldn't happen, but render functions run on every page)

  if(isAdmin()){
    // Admins review attendance here; they don't clock themselves in.
    statusCard.style.display = 'none';
  }else{
    statusCard.style.display = '';
    const open = myOpenTimeLog();
    if(open){
      const since = new Date(open.timeIn).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      statusEl.innerHTML = `🟢 Clocked in since <strong style="color:var(--text);">${since}</strong>`;
      timeOutBtn.style.display = '';
      timeOutBtn.disabled = false;
    }else{
      statusEl.innerHTML = `⚪ Not clocked in — <button class="btn small primary" data-tt-action="in">Time In</button>`;
      timeOutBtn.style.display = 'none';
    }
  }

  const rows = state.staffTimeLogs || [];
  const countEl = document.getElementById('stt-histcount');
  if(countEl) countEl.textContent = `${rows.length} record${rows.length===1?'':'s'}`;

  const visible = isAdmin() ? rows : rows.filter(l => l.userId === currentUser.id);
  const tbody = document.getElementById('tbl-stafftime');
  tbody.innerHTML = visible.length ? visible.map(l=>{
    const durMs = l.timeOut != null ? (l.timeOut - l.timeIn) : (Date.now() - l.timeIn);
    const durText = l.timeOut != null ? formatDuration(durMs) : `<span style="color:var(--green)">ongoing</span>`;
    return `<tr>
      <td data-admin="1">${escapeHtml(l.name)}</td>
      <td>${new Date(l.timeIn).toLocaleDateString()}</td>
      <td>${new Date(l.timeIn).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
      <td>${l.timeOut != null ? new Date(l.timeOut).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '—'}</td>
      <td>${durText}</td>
    </tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No time logs yet.</td></tr>`;

  // applyRolePermissions() only sweeps [data-admin]/[data-staffonly]
  // elements once, right after login — these rows are rebuilt on every
  // render after that, so the Staff column's own cells need the same
  // role check applied fresh each time.
  if(!isAdmin()) tbody.querySelectorAll('[data-admin]').forEach(el => el.style.display = 'none');
}

document.getElementById('btnTimeOut').addEventListener('click', doTimeOut);

// Delegated — the inline "Time In" button inside #stt-status is rebuilt
// by renderStaffTime() every time, so it can't hold its own listener.
document.getElementById('view-stafftime').addEventListener('click', e=>{
  if(e.target.closest('[data-tt-action="in"]')) doTimeIn();
});

/* The post-login prompt. Only for a FRESH sign-in (see enterApp()'s
   isFreshLogin argument in 07-login.js) — a session resumed from a page
   refresh must never re-prompt, or everyday use would mean re-clocking-in
   on every F5. Staff only; Admins don't clock in. Locked (see openModal's
   4th argument in 05-ui.js) so it can't be clicked past — it either
   succeeds or fails loud, never silently skipped. */
function promptTimeIn(profile){
  return new Promise(resolve=>{
    openModal('Time In',
      `<div style="text-align:center;padding:8px 0 4px;">
         <div style="font-size:19px;font-weight:800;color:var(--text);">${escapeHtml(profile.name)}</div>
         <div class="hint" style="margin-top:4px;">${new Date().toLocaleString([], {weekday:'long', hour:'2-digit', minute:'2-digit'})}</div>
       </div>
       <div class="hint" style="text-align:center;margin-top:14px;">Tap Time In to start your shift — recorded automatically, by the system clock.</div>`,
      `<button class="btn primary" id="btnConfirmTimeIn" style="width:100%;">Time In</button>`,
      true
    );
    document.getElementById('btnConfirmTimeIn').addEventListener('click', async ()=>{
      const btn = document.getElementById('btnConfirmTimeIn');
      btn.disabled = true; btn.textContent = 'Recording…';
      try{
        const logId = await dbTimeIn();
        state.staffTimeLogs.unshift({ id: logId, userId: profile.id, name: profile.name, timeIn: Date.now(), timeOut: null });
      }catch(err){
        // A failed clock-in shouldn't lock a cashier out of the till —
        // let them in anyway and retry from the Staff page's own button.
        toast('Could not record Time In: ' + err.message, true);
      }
      closeModal();
      resolve();
    });
  });
}
