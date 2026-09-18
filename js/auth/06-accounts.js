/* ===== js/auth/06-accounts.js =====
   User accounts: roles, password hashing, create/find/verify users.
   (Lines 569-847 of the original single-file build.) */

/* 06-accounts.js — User accounts: roles, password hashing, create/find/verify users.

   ---------------------------------------------------------------------
   SWITCHING TO SUPABASE AUTH — start here.

   Accounts here are homemade: a salt + SHA-256 hash stored inside
   state.users, checked by hand in 07-login.js. Supabase Auth replaces
   all of that with a real, hosted auth system:
     - supabase.auth.signUp({ email, password })
     - supabase.auth.signInWithPassword({ email, password })
     - supabase.auth.onAuthStateChange((event, session) => {...}) instead
       of setting currentUser yourself after a manual password check

   You would still want a small `profiles` table (user id, name, role:
   'admin' | 'staff') since Supabase Auth has no idea about this app's
   Admin/Staff distinction — everything that reads a role today
   (isAdmin() here, the route guards in 10-nav.js) stays basically the
   same, it would just read `role` from that profiles table instead of
   from state.users.

   The security-question recovery flow (08-recovery.js) and the OTP
   modal (09-otp.js) both become unnecessary — Supabase Auth has its own
   built-in password-reset email flow.
   ---------------------------------------------------------------------
*/

let currentUser = null;

/* Admin powers need an Admin account AND the admin build. An Admin covering
   the till in the cashier app gets the cashier's abilities, nothing more. */
const isAdmin = () => !!currentUser
  && currentUser.role === 'admin'
  && (window.APP_BUILD || 'admin') === 'admin';

/* Passwords are stored as a SHA-256 hash of (salt + password), never as
   the password itself. Read the note in the chat about what this does
   and does not protect you from. */

/* SHA-256 in plain JavaScript. Needed because crypto.subtle only exists on
   https, localhost and file:// — serve this from http://192.168.x.x for a
   counter tablet and it disappears, which would break sign-in entirely.
   Output is byte-identical to crypto.subtle, so an account created in one
   context still works in the other. */

function sha256Hex(msg){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  // UTF-8 bytes
  const bytes=[];
  for(const ch of msg){
    let c=ch.codePointAt(0);
    if(c<0x80) bytes.push(c);
    else if(c<0x800) bytes.push(0xc0|c>>6,0x80|c&63);
    else if(c<0x10000) bytes.push(0xe0|c>>12,0x80|c>>6&63,0x80|c&63);
    else bytes.push(0xf0|c>>18,0x80|c>>12&63,0x80|c>>6&63,0x80|c&63);
  }
  const bitLen=bytes.length*8;
  bytes.push(0x80);
  while(bytes.length%64!==56) bytes.push(0);
  const hi=Math.floor(bitLen/0x100000000), lo=bitLen>>>0;
  bytes.push(hi>>>24&255,hi>>>16&255,hi>>>8&255,hi&255,lo>>>24&255,lo>>>16&255,lo>>>8&255,lo&255);

  const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  const W=new Array(64);
  for(let i=0;i<bytes.length;i+=64){
    for(let t=0;t<16;t++) W[t]=(bytes[i+t*4]<<24)|(bytes[i+t*4+1]<<16)|(bytes[i+t*4+2]<<8)|bytes[i+t*4+3];
    for(let t=16;t<64;t++){
      const s0=rotr(W[t-15],7)^rotr(W[t-15],18)^(W[t-15]>>>3);
      const s1=rotr(W[t-2],17)^rotr(W[t-2],19)^(W[t-2]>>>10);
      W[t]=(W[t-16]+s0+W[t-7]+s1)|0;
    }
    let [a,b,c,d,e,f,g,h]=H;
    for(let t=0;t<64;t++){
      const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
      const ch=(e&f)^(~e&g);
      const t1=(h+S1+ch+K[t]+W[t])|0;
      const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
      const mj=(a&b)^(a&c)^(b&c);
      const t2=(S0+mj)|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    H=[(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
  }
  return H.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}

async function hashPassword(password, salt){
  const text = salt + '::' + password;
  if(typeof crypto !== 'undefined' && crypto.subtle){
    try{
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }catch(e){ /* fall through to the JS version */ }
  }
  return sha256Hex(text);
}

function makeSalt(){
  const bytes = new Uint8Array(16);
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    crypto.getRandomValues(bytes);
  }else{
    for(let i=0;i<16;i++) bytes[i] = Math.floor(Math.random()*256);
  }
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function findUser(username){
  const u = String(username||'').trim().toLowerCase();
  return state.users.find(x => x.username === u);
}

function authMsg(id, text, ok){
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.classList.toggle('ok', !!ok);
}

/* Shared checks for both the setup form and the sign-up form */

function validateNewAccount(email, username, pass, pass2){
  if(!email) return 'Enter your Gmail address.';
  if(!isGmail(email)) return 'Use a Gmail address ending in @gmail.com.';
  if(state.users.some(u => (u.email||'').toLowerCase() === email.trim().toLowerCase()))
    return 'That Gmail address already has an account.';
  if(!username) return 'Enter a username.';
  if(!/^[a-z0-9._-]{3,20}$/i.test(username))
    return 'Username: 3–20 characters, letters/numbers/. _ - only.';
  if(findUser(username)) return 'That username is already taken.';
  if(pass.length < 6) return 'Password needs at least 6 characters.';
  if(pass !== pass2) return 'The two passwords do not match.';
  return null;
}

/* Security questions, used only for resetting a forgotten password.
   The answer is hashed exactly like a password — it is never stored plainly. */

const normalizeAnswer = a => String(a||'').trim().toLowerCase().replace(/\s+/g,' ');

function fillQuestionSelect(selectId, customWrapId){
  const sel = document.getElementById(selectId);
  sel.innerHTML = SECURITY_QUESTIONS.map(q=>`<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join('')
    + `<option value="${CUSTOM_Q}">Write my own question…</option>`;
  sel.addEventListener('change', ()=>{
    document.getElementById(customWrapId).style.display = sel.value===CUSTOM_Q ? 'block' : 'none';
  });
}

/* Reads whichever question the form has selected */

function chosenQuestion(selectId, customId){
  const v = document.getElementById(selectId).value;
  return v === CUSTOM_Q ? document.getElementById(customId).value.trim() : v;
}

async function createUser(email, username, password, role, question, answer){
  const salt = makeSalt();
  const user = {
    id: state.nextUserId++,
    email: String(email||'').trim().toLowerCase(),
    name: username.trim(),          // shown in the topbar and on records
    username: username.trim().toLowerCase(),
    salt,
    hash: await hashPassword(password, salt),
    role,
    created: Date.now()
  };
  if(question && answer){
    user.q = question;
    user.qSalt = makeSalt();
    user.qHash = await hashPassword(normalizeAnswer(answer), user.qSalt);
  }
  state.users.push(user);
  await saveState();
  return user;
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

/* ---------- Tabs ---------- */

function renderUsers(){
  const tbody = document.getElementById('tbl-users');
  if(!tbody || !currentUser) return;
  tbody.innerHTML = state.users.map(u=>{
    const me = currentUser && u.id === currentUser.id;
    return `<tr>
      <td>${escapeHtml(u.name)}${me?' <span class="muted">(you)</span>':''}</td>
      <td class="muted">${escapeHtml(u.username)}${u.email?`<br><span style="font-size:9.5px;">${escapeHtml(u.email)}</span>`:''}</td>
      <td><span class="role-tag ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'Staff'}</span>${
        (!u.email && (!u.q||!u.qHash)) ? ' <span class="role-tag" style="color:var(--yellow);border-color:var(--yellow);" title="No Gmail and no security question">no recovery</span>' : ''}</td>
      <td class="muted">${new Date(u.created).toLocaleDateString()}</td>
      <td><div class="row-actions">
        ${me ? '<span class="muted" style="font-size:10.5px;">—</span>' : `
          <button class="btn small ghost" data-uact="role" data-uid="${u.id}" title="Switch role">⇅ ${u.role==='admin'?'Staff':'Admin'}</button>
          <button class="btn small ghost" data-uact="mail" data-uid="${u.id}" title="Set their Gmail">✉</button>
          <button class="btn small ghost" data-uact="pass" data-uid="${u.id}" title="Set a new password">🔑</button>
          <button class="btn small danger" data-uact="del" data-uid="${u.id}" title="Remove account">×</button>`}
      </div></td>
    </tr>`;
  }).join('');
}

function openPasswordModal(u){
  openModal(`New password — ${u.name}`, `
    <div class="field"><label>New password</label><input id="pw-1" type="password" placeholder="At least 6 characters"/></div>
    <div class="field"><label>Confirm</label><input id="pw-2" type="password" placeholder="Type it again"/></div>
    <div class="hint" style="margin-top:10px;">The old password cannot be recovered — this replaces it.</div>
  `, `<button class="btn ghost" id="pw-cancel">Cancel</button>
      <button class="btn primary" id="pw-save">Set Password</button>`);

  document.getElementById('pw-cancel').addEventListener('click', closeModal);
  document.getElementById('pw-save').addEventListener('click', async ()=>{
    const p1 = document.getElementById('pw-1').value, p2 = document.getElementById('pw-2').value;
    if(p1.length < 6) return toast('Password needs at least 6 characters', true);
    if(p1 !== p2)     return toast('The two passwords do not match', true);
    u.salt = makeSalt();
    u.hash = await hashPassword(p1, u.salt);
    await saveState(); closeModal();
    toast(`Password updated for ${u.name}`);
  });
}

document.getElementById('btnAddUser').addEventListener('click', ()=>{
  if(!isAdmin()) return toast('Admins only', true);
  openModal('Add User', `
    <div class="field"><label>Gmail address</label><input id="nu-name" type="email" placeholder="juan@gmail.com"/></div>
    <div class="field"><label>Username</label><input id="nu-user" placeholder="juan"/></div>
    <div class="field-row">
      <div class="field"><label>Password</label><input id="nu-pass" type="password" placeholder="At least 6 characters"/></div>
      <div class="field"><label>Role</label><select id="nu-role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
    </div>
    <div class="hint" style="margin-top:10px;">Staff can move stock in and out. Admins can also add, edit, delete, and open Settings.</div>
  `, `<button class="btn ghost" id="nu-cancel">Cancel</button>
      <button class="btn primary" id="nu-save">Add User</button>`);

  document.getElementById('nu-cancel').addEventListener('click', closeModal);
  document.getElementById('nu-save').addEventListener('click', async ()=>{
    const name = document.getElementById('nu-name').value.trim();
    const user = document.getElementById('nu-user').value.trim();
    const pass = document.getElementById('nu-pass').value;
    const err  = validateNewAccount(name, user, pass, pass);
    if(err) return toast(err, true);
    await createUser(name, user, pass, document.getElementById('nu-role').value);
    closeModal(); renderUsers();
    toast(`${name} added`);
  });
});

/* ============================= REPORTS =============================
   Everything here is derived from state.activity. Only movements with
   reason 'sold' count as benta; only 'purchase' counts as gastos. */

function findUserByEmail(v){
  const e = String(v||'').trim().toLowerCase();
  return state.users.find(u => (u.email||'').toLowerCase() === e);
}
