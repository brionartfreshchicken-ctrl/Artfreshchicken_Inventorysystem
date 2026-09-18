/* ===== js/auth/06-accounts.js =====
   User accounts: now backed by Supabase Auth + the `profiles` table
   (see supabase/migrations/0001_profiles.sql and 0014_auth_lookup.sql).
   Everything homemade — the SHA-256/salt hashing, the security-question
   recovery flow, the on-screen OTP — is gone. Password checking now
   happens on Supabase's servers via sb.auth.signInWithPassword(). */

let currentUser = null;

/* Admin powers need an Admin account AND the admin build. An Admin covering
   the till in the cashier app gets the cashier's abilities, nothing more. */
const isAdmin = () => !!currentUser
  && currentUser.role === 'admin'
  && (window.APP_BUILD || 'admin') === 'admin';

function authMsg(id, text, ok){
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.classList.toggle('ok', !!ok);
}

/* Shared checks for both the setup form and the sign-up form. Supabase
   enforces its own rules server-side too (email format, password length,
   username uniqueness via the profiles table's unique constraint) — this
   is just fast client-side feedback before we even make a network call. */
function validateNewAccount(email, username, pass, pass2){
  if(!email) return 'Enter your Gmail address.';
  if(!isGmail(email)) return 'Use a Gmail address ending in @gmail.com.';
  if(!username) return 'Enter a username.';
  if(!/^[a-z0-9._-]{3,20}$/i.test(username))
    return 'Username: 3–20 characters, letters/numbers/. _ - only.';
  if(pass.length < 6) return 'Password needs at least 6 characters.';
  if(pass !== pass2) return 'The two passwords do not match.';
  return null;
}

/* ---------- Profiles cache ----------
   Render functions in this app are synchronous, but Supabase reads are
   async — so accounts are fetched once into this cache (on sign-in, and
   after any change) and renderUsers() reads from it synchronously, same
   pattern as every other render function in the app. */

let profilesCache = [];

async function refreshProfiles(){
  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  if(error){ toast('Could not load accounts: ' + error.message, true); return; }
  profilesCache = data || [];
}

/* ---------- Screen switching ---------- */

function applyRolePermissions(){
  const admin = isAdmin();

  /* Admin gets a manager's view: reports, sales history, settings.
     Staff get the day-to-day counter: sell, and manage snacks, drinks
     and ingredients. Neither role touches the other's pages. */
  document.querySelectorAll('[data-admin]').forEach(el =>
    el.style.display = admin ? '' : 'none');
  document.querySelectorAll('[data-staffonly]').forEach(el =>
    el.style.display = admin ? 'none' : '');
  document.body.classList.toggle('staff-mode', !admin);
  renderAll();
}

/* ---------- Accounts table in Settings ---------- */

function renderUsers(){
  const tbody = document.getElementById('tbl-users');
  if(!tbody || !currentUser) return;
  tbody.innerHTML = profilesCache.map(u=>{
    const me = u.id === currentUser.id;
    return `<tr>
      <td>${escapeHtml(u.name)}${me?' <span class="muted">(you)</span>':''}</td>
      <td class="muted">${escapeHtml(u.username)}${u.email?`<br><span style="font-size:9.5px;">${escapeHtml(u.email)}</span>`:''}</td>
      <td><span class="role-tag ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'Staff'}</span></td>
      <td class="muted">${new Date(u.created_at).toLocaleDateString()}</td>
      <td><div class="row-actions">
        ${me ? '<span class="muted" style="font-size:10.5px;">—</span>' : `
          <button class="btn small ghost" data-uact="role" data-uid="${u.id}" title="Switch role">⇅ ${u.role==='admin'?'Staff':'Admin'}</button>
          <button class="btn small danger" data-uact="del" data-uid="${u.id}" title="Remove access">× Remove access</button>`}
      </div></td>
    </tr>`;
  }).join('');
}

/* ---------- My Account: change your own password ---------- */

function openMyAccountModal(){
  if(!currentUser) return;
  openModal(`My Account — ${currentUser.name}`, `
    <div class="hint" style="margin-bottom:14px;">
      Signed in as <strong style="color:var(--text)">${escapeHtml(currentUser.username)}</strong>
      (${escapeHtml(currentUser.email||'—')}) — <span class="role-tag ${currentUser.role==='admin'?'admin':''}">${currentUser.role==='admin'?'Admin':'Staff'}</span>
    </div>
    <div class="field"><label>New password <span class="muted">(leave blank to keep it)</span></label>
      <input id="ma-p1" type="password" placeholder="At least 6 characters"/></div>
    <div class="field"><label>Confirm new password</label>
      <input id="ma-p2" type="password" placeholder="Type it again"/></div>
    <div class="auth-msg" id="ma-msg"></div>
  `, `<button class="btn ghost" id="ma-cancel">Close</button>
      <button class="btn primary" id="ma-save">Save</button>`);

  document.getElementById('ma-cancel').addEventListener('click', closeModal);
  document.getElementById('ma-save').addEventListener('click', async ()=>{
    const p1 = document.getElementById('ma-p1').value;
    const p2 = document.getElementById('ma-p2').value;
    const msg = document.getElementById('ma-msg');
    if(!p1 && !p2){ closeModal(); return; }
    if(p1.length < 6){ msg.textContent = 'Password needs at least 6 characters.'; return; }
    if(p1 !== p2){ msg.textContent = 'The two passwords do not match.'; return; }

    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error){ msg.textContent = error.message; return; }
    closeModal();
    toast('Password updated');
  });
}

document.getElementById('btnMyAccount').addEventListener('click', openMyAccountModal);

/* ============================= REPORTS =============================
   Everything here is derived from state.activity. Only movements with
   reason 'sold' count as benta; only 'purchase' counts as gastos. */
