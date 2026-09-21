/* ===== js/auth/07-login.js =====
   Sign in / Sign up screen wiring (the first-run Setup form lives here too).
   Now backed by Supabase Auth — see js/auth/06-accounts.js for what
   changed and why. */

async function showAuthScreen(){
  let noAccounts = true;
  const { data, error } = await sb.rpc('accounts_exist');
  if(!error) noAccounts = !data;

  document.getElementById('setupPane').style.display = noAccounts ? 'block' : 'none';
  document.getElementById('loginPane').style.display = noAccounts ? 'none'  : 'block';
  document.getElementById('forgotPane').style.display = 'none';
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

/* `profile` is a row from the `profiles` table: {id, username, name, role, email, created_at}. */
async function enterApp(profile){
  currentUser = profile;
  await Promise.all([ refreshProfiles(), hydrateFromSupabase() ]);

  // Enforce the retention limit before the first render, so Reports never
  // show records that are about to vanish.
  const purged = await applyRetention(true);
  if(purged) console.info(`[retention] removed ${purged} record(s) past the limit`);

  // account block at the foot of the sidebar
  document.getElementById('sfName').textContent   = profile.name;
  document.getElementById('sfMail').textContent   = profile.email || (profile.role === 'admin' ? 'Administrator' : 'Staff');
  document.getElementById('sfAvatar').textContent = profile.name.trim().slice(0,2).toUpperCase();

  applyRolePermissions();
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('app').style.visibility = 'visible';

  navigate(profile.role === 'admin' ? 'dashboard' : 'sales');   // staff open on the till
  toast(`Welcome, ${profile.name.split(' ')[0]}`);
}

async function signOut(){
  await sb.auth.signOut();
  currentUser = null;
  ['li-user','li-pass','su-name','su-user','su-pass','su-pass2','fp-email'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  authMsg('loginMsg',''); authMsg('signupMsg','');
  switchAuthTab('signin');
  showAuthScreen();
}

function switchAuthTab(which){
  const signin = which === 'signin';
  document.getElementById('tabSignin').classList.toggle('active', signin);
  document.getElementById('tabSignup').classList.toggle('active', !signin);
  document.getElementById('signinForm').style.display = signin ? 'block' : 'none';
  document.getElementById('signupForm').style.display = signin ? 'none'  : 'block';
  showForgot(false);
}

function showForgot(on){
  document.getElementById('loginPane').style.display = on ? 'none' : 'block';
  document.getElementById('forgotPane').style.display = on ? 'block' : 'none';
  authMsg('fpMsg','');
}

document.getElementById('tabSignin').addEventListener('click', ()=>switchAuthTab('signin'));
document.getElementById('tabSignup').addEventListener('click', ()=>switchAuthTab('signup'));

/* ---------- First-run setup ---------- */

document.getElementById('btnSetup').addEventListener('click', async ()=>{
  const name  = document.getElementById('st-name').value.trim();
  const user  = document.getElementById('st-user').value.trim();
  const pass  = document.getElementById('st-pass').value;
  const pass2 = document.getElementById('st-pass2').value;

  const err = validateNewAccount(name, user, pass, pass2);
  if(err) return authMsg('setupMsg', err);

  const { data: available } = await sb.rpc('username_available', { p_username: user });
  if(available === false) return authMsg('setupMsg', 'That username is already taken.');

  const { data, error } = await sb.auth.signUp({
    email: name, password: pass,
    options: { data: { username: user, name: user } }
  });
  if(error) return authMsg('setupMsg', error.message);

  if(!data.session){
    authMsg('setupMsg', 'Account created — check your Gmail to confirm it, then sign in.', true);
    switchAuthTab('signin');
    return;
  }

  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  authMsg('setupMsg', 'Account created.', true);
  enterApp(profile);
});

/* ---------- Sign in ---------- */

document.getElementById('btnLogin').addEventListener('click', doLogin);

async function doLogin(){
  const username = document.getElementById('li-user').value.trim();
  const password = document.getElementById('li-pass').value;
  if(!username || !password) return authMsg('loginMsg', 'Enter your username and password.');

  // Same message on every failure below, so it never reveals which
  // usernames exist.
  const fail = () => authMsg('loginMsg', 'Incorrect username or password.');

  const { data: email } = await sb.rpc('email_for_username', { p_username: username });
  if(!email) return fail();

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) return fail();

  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  if(!profile) return fail();

  authMsg('loginMsg','');
  document.getElementById('li-pass').value = '';
  enterApp(profile);
}

/* ---------- Sign up ---------- */

document.getElementById('btnSignup').addEventListener('click', async ()=>{
  const name  = document.getElementById('su-name').value.trim();
  const user  = document.getElementById('su-user').value.trim();
  const pass  = document.getElementById('su-pass').value;
  const pass2 = document.getElementById('su-pass2').value;

  const err = validateNewAccount(name, user, pass, pass2);
  if(err) return authMsg('signupMsg', err);

  const { data: available } = await sb.rpc('username_available', { p_username: user });
  if(available === false) return authMsg('signupMsg', 'That username is already taken.');

  const { data, error } = await sb.auth.signUp({
    email: name, password: pass,
    options: { data: { username: user, name: user } }
  });
  if(error) return authMsg('signupMsg', error.message);

  ['su-name','su-user','su-pass','su-pass2'].forEach(id=>document.getElementById(id).value='');

  if(!data.session){
    authMsg('signupMsg', 'Account created — check your Gmail to confirm it, then sign in.', true);
    switchAuthTab('signin');
    return;
  }
  switchAuthTab('signin');
  document.getElementById('li-user').value = user;
  authMsg('loginMsg', 'Account created — you can sign in now.', true);
  document.getElementById('li-pass').focus();
});

/* ---------- Forgot password ----------
   A real email now, via Supabase Auth's own reset flow — the link opens
   reset-password.html, which is the only place a new password gets set. */

document.getElementById('btnForgot').addEventListener('click', ()=>showForgot(true));
document.getElementById('fpBack').addEventListener('click', ()=>showForgot(false));

document.getElementById('fpSend').addEventListener('click', async ()=>{
  const email = document.getElementById('fp-email').value.trim();
  if(!email || !isGmail(email)) return authMsg('fpMsg', 'Use a Gmail address ending in @gmail.com.');

  const redirectTo = new URL('reset-password.html', window.location.href).toString();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

  // Same message on success AND on failure — this never reveals which
  // Gmail addresses have accounts, and it also means a misconfigured/
  // rate-limited email service (Supabase's shared sender needs custom
  // SMTP for real reliability — see project notes) fails quietly here
  // instead of showing a confusing internal error. Logged to the
  // console so whoever owns the Supabase project can still diagnose it.
  if(error) console.warn('[password reset]', error.message);
  authMsg('fpMsg', 'If that Gmail address has an account, a reset link is on its way.', true);
});

/* Enter key submits whichever form is on screen */

document.getElementById('authScreen').addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  if(document.getElementById('setupPane').style.display !== 'none')
    return document.getElementById('btnSetup').click();
  if(document.getElementById('forgotPane').style.display !== 'none')
    return document.getElementById('fpSend').click();
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
   Not a shortcut around the login screen — it looks up the target
   account's role first (any signed-in user can read the profiles table),
   only proceeds if it's actually an Admin, and only then runs the same
   sign-in Supabase does for everyone else. There is no "switch back":
   going back to the Staff account means signing in as that account again. */
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

    const { data: target } = await sb.from('profiles')
      .select('id,email,role').eq('username', username.toLowerCase()).maybeSingle();
    if(!target || target.role !== 'admin' || !target.email) return fail();

    const { data, error } = await sb.auth.signInWithPassword({ email: target.email, password });
    if(error) return fail();

    const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
    closeModal();
    enterApp(profile);
    toast(`Switched to ${profile.name}`);
  }

  document.getElementById('sw-go').addEventListener('click', trySwitch);
  document.getElementById('sw-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') trySwitch(); });
});
