/* ===== js/auth/07-login.js =====
   Sign in / Sign up screen wiring (the first-run Setup form lives here too).
   (Lines 848-1129 of the original single-file build.) */

/* 07-login.js — Sign in / Sign up screen wiring (the first-run Setup form lives here too). */

function showAuthScreen(){
  const noAccounts = !state.users || state.users.length === 0;
  document.getElementById('setupPane').style.display = noAccounts ? 'block' : 'none';
  document.getElementById('loginPane').style.display = noAccounts ? 'none'  : 'block';
  showForgot(false);
  showOtpPane(false);
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('app').style.visibility = 'hidden';
  setTimeout(()=>{
    const first = document.getElementById(noAccounts ? 'st-name' : 'li-user');
    if(first) first.focus();
  }, 60);
}

/* This is the single full build: Admins and Staff both sign in here,
   each landing on the page suited to their role. (APP_BUILD is kept
   around only so isAdmin() below still has a way to tell an admin
   console apart from a stripped-down cashier build, if one is ever
   compiled from this same source again — it no longer blocks login.) */
const APP_BUILD = window.APP_BUILD || 'admin';

function enterApp(user){
  currentUser = user;

  // account block at the foot of the sidebar
  document.getElementById('sfName').textContent   = user.name;
  document.getElementById('sfMail').textContent   = user.email || (user.role === 'admin' ? 'Administrator' : 'Staff');
  document.getElementById('sfAvatar').textContent = user.name.trim().slice(0,2).toUpperCase();

  applyRolePermissions();
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.visibility = 'visible';

  navigate(user.role === 'admin' ? 'dashboard' : 'sales');   // staff open on the till
  toast(`Welcome, ${user.name.split(' ')[0]}`);

  // Missing either recovery route -> offer to set it up now
  if(!user.email || !user.q || !user.qHash) setTimeout(promptSecurityQuestion, 700);
}

/* Accounts made before recovery questions existed have no way to reset
   themselves. Ask at sign-in until one is set, so nobody gets stranded. */

function promptSecurityQuestion(){
  const soleAdmin = currentUser.role==='admin' &&
                    state.users.filter(u=>u.role==='admin').length === 1;
  const needEmail = !currentUser.email;
  const needQ     = !currentUser.q || !currentUser.qHash;

  openModal('Set up account recovery', `
    <div class="hint" style="margin-bottom:16px;color:var(--yellow);line-height:1.6;">
      This account can't reset its own password yet.
      ${soleAdmin
        ? 'You are the only Admin, so if you forget it, no one can unlock this account for you.'
        : 'Without this, only another Admin can unlock it for you.'}
    </div>
    ${needEmail ? `
    <div class="field"><label>Gmail address <span class="muted">(gets you a one-time code)</span></label>
      <input id="sq-email" type="email" placeholder="you@gmail.com"/></div>
    <div class="hint" style="margin:-4px 0 16px;">Adding this lets you choose "Email me a code" when resetting.</div>
    ` : ''}
    <div class="field"><label>Security question</label><select id="sq-q"></select></div>
    <div class="field" id="sq-qcustom-wrap" style="display:none;"><label>Your own question</label>
      <input id="sq-qcustom" placeholder="e.g. What street did I grow up on?"/></div>
    <div class="field"><label>Answer</label>
      <input id="sq-a" placeholder="Not case sensitive"/></div>
    <div class="hint" style="margin-top:12px;">
      Pick something that isn't on your Facebook. The answer is hashed, not stored as text.
    </div>
  `, `<button class="btn ghost" id="sq-later">Not now</button>
      <button class="btn primary" id="sq-save">Save question</button>`);

  fillQuestionSelect('sq-q','sq-qcustom-wrap');
  if(currentUser.q && SECURITY_QUESTIONS.includes(currentUser.q))
    document.getElementById('sq-q').value = currentUser.q;
  document.getElementById('sq-later').addEventListener('click', ()=>{
    closeModal();
    toast('You can set one any time from My Account', true);
  });
  document.getElementById('sq-save').addEventListener('click', async ()=>{
    const emEl = document.getElementById('sq-email');
    const em = emEl ? emEl.value.trim().toLowerCase() : '';
    const q = chosenQuestion('sq-q','sq-qcustom');
    const a = document.getElementById('sq-a').value;
    const done = [];

    if(em){
      if(!isGmail(em)) return toast('Use a Gmail address ending in @gmail.com', true);
      if(state.users.some(u => u.id !== currentUser.id && (u.email||'').toLowerCase() === em))
        return toast('Another account already uses that Gmail', true);
      currentUser.email = em;
      done.push('Gmail');
    }
    if(a.trim()){
      if(!q) return toast('Write your security question', true);
      currentUser.q = q;
      currentUser.qSalt = makeSalt();
      currentUser.qHash = await hashPassword(normalizeAnswer(a), currentUser.qSalt);
      done.push('security question');
    }
    if(!done.length) return toast('Add a Gmail address or answer a question', true);

    await saveState();
    renderUsers();
    closeModal();
    toast(`Saved ${done.join(' and ')} — you can reset your own password now`);
  });
}

function signOut(){
  currentUser = null;
  ['li-user','li-pass','su-name','su-user','su-pass','su-pass2'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  authMsg('loginMsg',''); authMsg('signupMsg','');
  switchAuthTab('signin');
  showAuthScreen();
}

/* Staff can move stock but not change the catalogue or open Settings. */

function switchAuthTab(which){
  const signin = which === 'signin';
  document.getElementById('tabSignin').classList.toggle('active', signin);
  document.getElementById('tabSignup').classList.toggle('active', !signin);
  document.getElementById('signinForm').style.display = signin ? 'block' : 'none';
  document.getElementById('signupForm').style.display = signin ? 'none'  : 'block';
}

document.getElementById('tabSignin').addEventListener('click', ()=>switchAuthTab('signin'));

document.getElementById('tabSignup').addEventListener('click', ()=>switchAuthTab('signup'));

/* ---------- First-run setup ---------- */

document.getElementById('btnSetup').addEventListener('click', async ()=>{
  const name  = document.getElementById('st-name').value.trim();
  const user  = document.getElementById('st-user').value.trim();
  const pass  = document.getElementById('st-pass').value;
  const pass2 = document.getElementById('st-pass2').value;

  const q = chosenQuestion('st-q','st-qcustom');
  const a = document.getElementById('st-a').value;

  const err = validateNewAccount(name, user, pass, pass2);
  if(err) return authMsg('setupMsg', err);
  if(!q) return authMsg('setupMsg', 'Write your security question.');
  if(!a.trim()) return authMsg('setupMsg', 'Answer your security question — it is the only way to reset this password.');

  const created = await createUser(name, user, pass, 'admin', q, a);
  authMsg('setupMsg', 'Account created.', true);
  enterApp(created);
});

/* ---------- Sign in ---------- */

document.getElementById('btnLogin').addEventListener('click', doLogin);

async function doLogin(){
  const username = document.getElementById('li-user').value.trim();
  const password = document.getElementById('li-pass').value;
  if(!username || !password) return authMsg('loginMsg', 'Enter your username and password.');

  const user = findUser(username);
  // Same message either way, so it does not reveal which usernames exist
  if(!user) return authMsg('loginMsg', 'Incorrect username or password.');

  const attempt = await hashPassword(password, user.salt);
  if(attempt !== user.hash) return authMsg('loginMsg', 'Incorrect username or password.');

  authMsg('loginMsg','');
  document.getElementById('li-pass').value = '';
  enterApp(user);
}

/* ---------- Sign up ---------- */

document.getElementById('btnSignup').addEventListener('click', async ()=>{
  const name  = document.getElementById('su-name').value.trim();
  const user  = document.getElementById('su-user').value.trim();
  const pass  = document.getElementById('su-pass').value;
  const pass2 = document.getElementById('su-pass2').value;

  const q = chosenQuestion('su-q','su-qcustom');
  const a = document.getElementById('su-a').value;

  const err = validateNewAccount(name, user, pass, pass2);
  if(err) return authMsg('signupMsg', err);
  if(!q) return authMsg('signupMsg', 'Write your security question.');
  if(!a.trim()) return authMsg('signupMsg', 'Answer your security question — it is how you reset a forgotten password.');

  /* TEMP — OTP verification is switched off. Signup used to require a
     one-time code (via startOtp, still defined below and unused) before
     the account was created. To turn verification back on, wrap the
     three lines below back inside:
       await startOtp({ email:name, purpose:'Verify your new account',
         subtitle:`Enter the code sent to ${name} to finish creating your account.`,
         onVerified: async ()=>{ ...these lines... } }); */
  await createUser(name, user, pass, 'staff', q, a);
  switchAuthTab('signin');
  document.getElementById('li-user').value = user;
  authMsg('loginMsg', 'Account created — you can sign in now.', true);
  ['su-name','su-user','su-pass','su-pass2','su-a','su-qcustom'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('li-pass').focus();
});

/* Enter key submits whichever form is on screen */

document.getElementById('authScreen').addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  if(document.getElementById('setupPane').style.display !== 'none')
    return document.getElementById('btnSetup').click();
  if(document.getElementById('forgotPane').style.display !== 'none'){
    if(document.getElementById('fpStep1').style.display !== 'none') return document.getElementById('fpNext1').click();
    if(document.getElementById('fpStep2').style.display !== 'none') return document.getElementById('fpNext2').click();
    return document.getElementById('fpSave').click();
  }
  if(document.getElementById('signinForm').style.display !== 'none')
    return document.getElementById('btnLogin').click();
  document.getElementById('btnSignup').click();
});

document.getElementById('btnSignout').addEventListener('click', ()=>{
  if(!currentUser) return;
  confirmAction('Sign out',
    `<div class="hint">Sign out of <strong style="color:var(--text)">${escapeHtml(currentUser.name)}</strong>?
     <br><br>Your inventory and sales stay saved on this device.</div>`,
    'Sign out', signOut, false);
});

/* ---------- Switch to Admin (Staff only) ----------
   Not a shortcut around the login screen — it runs the exact same
   username/password check as Sign In, and only accepts an account
   that is actually an Admin. There is no "switch back": going back to
   the Staff account means signing in as that account again. */
document.getElementById('btnSwitchAdmin').addEventListener('click', ()=>{
  if(!currentUser) return;
  const body = `
    <div class="hint" style="margin-bottom:12px;">
      Enter an Admin's own login to switch into their account. You'll sign back in as
      <strong style="color:var(--text)">${escapeHtml(currentUser.name)}</strong> afterward the normal way — this does not keep your session open.
    </div>
    <div class="field"><label>Admin Username</label><input id="sw-user" type="text" autocomplete="username"/></div>
    <div class="field"><label>Admin Password</label><input id="sw-pass" type="password" autocomplete="current-password"/></div>
    <div class="hint" id="sw-msg" style="color:var(--red);min-height:14px;"></div>
  `;
  const foot = `<button class="btn ghost" id="sw-cancel">Cancel</button><button class="btn primary" id="sw-go">Switch</button>`;
  openModal('Switch to Admin', body, foot);

  document.getElementById('sw-cancel').addEventListener('click', closeModal);
  document.getElementById('sw-user').focus();

  async function trySwitch(){
    const username = document.getElementById('sw-user').value.trim();
    const password = document.getElementById('sw-pass').value;
    const msg = document.getElementById('sw-msg');
    // Same generic message on every failure, so it never reveals which
    // usernames exist or whether a matched account just isn't an Admin.
    const fail = () => { msg.textContent = 'Incorrect username or password.'; };

    if(!username || !password) return fail();

    const user = findUser(username);
    if(!user) return fail();

    const attempt = await hashPassword(password, user.salt);
    if(attempt !== user.hash) return fail();
    if(user.role !== 'admin') return fail();

    closeModal();
    enterApp(user);
    toast(`Switched to ${user.name}`);
  }

  document.getElementById('sw-go').addEventListener('click', trySwitch);
  document.getElementById('sw-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') trySwitch(); });
});

/* ---------- Accounts table in Settings ---------- */
