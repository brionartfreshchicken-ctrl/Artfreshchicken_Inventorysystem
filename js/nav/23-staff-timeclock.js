/* ===== js/nav/23-staff-timeclock.js =====
   Staff time in / time out. New feature — no original single-file build
   line range to point back to.

   Tied directly to the signed-in account — the actual time_in/time_out
   values always come from the database server's own clock (see
   staff_time_in()/staff_time_out() in 0029_staff_time_logs.sql) —
   nothing here ever sends a client-side timestamp for either to be
   trusted as-is. */

function myOpenTimeLog(){
  if(!currentUser) return null;
  return (state.staffTimeLogs||[]).find(l => l.userId === currentUser.id && l.timeOut == null) || null;
}

/* staff_time_in() (0031) now hands back an ALREADY-open shift's id
   instead of always minting a new row — the real fix for two tabs on
   the same account both calling Time In before either finished. Only
   add a local entry for an id we don't already have, or that race
   would show as two identical rows client-side even though the
   database correctly only ever has the one. */
function recordTimeInLocally(logId, userId, name){
  if((state.staffTimeLogs||[]).some(l => l.id === logId)) return;
  state.staffTimeLogs.unshift({ id: logId, userId, name, timeIn: Date.now(), timeOut: null });
}

/* The post-login prompt only fires once per calendar day — logging out
   at lunch and back in later the same day (or switching between staff
   accounts on a shared terminal and back) shouldn't ask again. "Today"
   is checked against each log's own time_in, regardless of whether
   that shift has since been timed out. */
function hasTimedInToday(userId){
  const todayStr = new Date().toDateString();
  return (state.staffTimeLogs||[]).some(l => l.userId === userId && new Date(l.timeIn).toDateString() === todayStr);
}

function formatDuration(ms){
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ---------- Shared time-log table: date range + grouped rows ----------
   One clock-in/out used to be one row forever — busy, and it only grows.
   Both places this renders (the per-staff "Staff" page and the
   Admin-facing "Staff Time Log" card on Operating Expenses) now default
   to Today and collapse multiple shifts in the same day into one row,
   expandable to the individual entries. */

/* Reads #<id>From/#<id>To, defaulting both to today the first time (an
   empty pair, not a deliberate "show everything" choice — unlike
   Movement Log's own From/To, this one needs a concrete starting
   point or the exact "grows forever" problem it exists to fix). */
function timeLogDateRange(fromId, toId){
  const fromEl = document.getElementById(fromId), toEl = document.getElementById(toId);
  if(!fromEl.value && !toEl.value){
    const t = isoDate(new Date());
    fromEl.value = t; toEl.value = t;
  }
  const from = fromEl.value ? new Date(fromEl.value+'T00:00:00').getTime() : 0;
  const to   = toEl.value   ? new Date(toEl.value+'T23:59:59.999').getTime() : Date.now();
  if(fromEl.value && toEl.value && from > to) toast('The From date is after the To date', true);
  return {from, to};
}

function groupTimeLogs(logs){
  const groups = {};
  logs.forEach(l=>{
    const day = new Date(l.timeIn); day.setHours(0,0,0,0);
    const key = l.userId + '|' + day.getTime();
    if(!groups[key]) groups[key] = { userId:l.userId, name:l.name, dayTime:day.getTime(), entries:[] };
    groups[key].entries.push(l);
  });
  return Object.values(groups).sort((a,b)=> b.dayTime - a.dayTime || a.name.localeCompare(b.name));
}

/* `adminOnlyStaffCol: true` marks the Staff cell the same way the rest
   of this app hides anything Staff shouldn't see on a shared page — see
   applyRolePermissions() — since the per-staff "Staff" page and the
   Admin-only Operating Expenses card share this one renderer. */
function renderTimeLogTable(tbodyId, logs, opts){
  opts = opts || {};
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  const groups = groupTimeLogs(logs);
  tbody.innerHTML = groups.length ? groups.map((g,gi)=>{
    const gid = `${tbodyId}-${gi}`;
    const totalMs = g.entries.reduce((t,l)=> t + (l.timeOut!=null ? l.timeOut-l.timeIn : Date.now()-l.timeIn), 0);
    const anyOpen = g.entries.some(l=>l.timeOut==null);
    const staffAttr = opts.adminOnlyStaffCol ? ' data-admin="1"' : '';
    const entriesHtml = g.entries.slice().sort((a,b)=>b.timeIn-a.timeIn).map(l=>{
      const durMs = l.timeOut != null ? (l.timeOut - l.timeIn) : (Date.now() - l.timeIn);
      const durText = l.timeOut != null ? formatDuration(durMs) : `<span style="color:var(--green)">ongoing</span>`;
      return `<tr class="tt-detail" data-tt-group="${gid}" hidden>
        <td${staffAttr}></td>
        <td colspan="2" class="muted" style="padding-left:24px;">${new Date(l.timeIn).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} – ${l.timeOut!=null ? new Date(l.timeOut).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'now'}</td>
        <td class="num">${durText}</td>
        <td></td>
      </tr>`;
    }).join('');
    return `<tr class="tt-group-row" data-tt-toggle="${gid}" style="cursor:pointer;">
      <td${staffAttr}>${escapeHtml(g.name)}</td>
      <td>${new Date(g.dayTime).toLocaleDateString()}</td>
      <td class="num">${g.entries.length}${anyOpen?' <span style="color:var(--green);" title="Still clocked in">●</span>':''}</td>
      <td class="num">${formatDuration(totalMs)}</td>
      <td class="num muted"><span class="tt-chevron">▸</span></td>
    </tr>${entriesHtml}`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No time logs in this range.</td></tr>`;

  if(opts.adminOnlyStaffCol && !isAdmin()) tbody.querySelectorAll('[data-admin]').forEach(el => el.style.display = 'none');
}

document.addEventListener('click', e=>{
  const toggle = e.target.closest('[data-tt-toggle]');
  if(!toggle) return;
  const gid = toggle.dataset.ttToggle;
  const chevron = toggle.querySelector('.tt-chevron');
  const opening = chevron.textContent === '▸';
  document.querySelectorAll(`[data-tt-group="${CSS.escape(gid)}"]`).forEach(r => r.hidden = !opening);
  chevron.textContent = opening ? '▾' : '▸';
});

async function doTimeIn(){
  const btns = document.querySelectorAll('[data-tt-action="in"]');
  btns.forEach(b => b.disabled = true);
  try{
    const logId = await dbTimeIn();
    recordTimeInLocally(logId, currentUser.id, currentUser.name);
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
  const visible = isAdmin() ? rows : rows.filter(l => l.userId === currentUser.id);
  const {from, to} = timeLogDateRange('stt-from', 'stt-to');
  const ranged = visible.filter(l => l.timeIn >= from && l.timeIn <= to);

  const countEl = document.getElementById('stt-histcount');
  if(countEl) countEl.textContent = `${ranged.length} record${ranged.length===1?'':'s'} in range`;

  renderTimeLogTable('tbl-stafftime', ranged, { adminOnlyStaffCol: true });
}


document.getElementById('btnTimeOut').addEventListener('click', doTimeOut);

['stt-from','stt-to'].forEach(id => document.getElementById(id).addEventListener('change', renderStaffTime));
document.getElementById('btnSttReset').addEventListener('click', ()=>{
  const t = isoDate(new Date());
  document.getElementById('stt-from').value = t;
  document.getElementById('stt-to').value = t;
  renderStaffTime();
});

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
        recordTimeInLocally(logId, profile.id, profile.name);
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
