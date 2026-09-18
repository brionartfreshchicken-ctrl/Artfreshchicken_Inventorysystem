/* ===== js/auth/08-recovery.js =====
   Forgot-password flow: security question + Gmail OTP to reset a password.
   (Lines 1130-1424 of the original single-file build.) */

/* 08-recovery.js — Forgot-password flow: security question + Gmail OTP to reset a password. */

let fpUser = null;       // account being reset

let fpTypedEmail = '';   // Gmail they typed, attached once verified

let fpAttempts = 0;      // wrong answers this session

function showForgot(show, keepUser){
  document.getElementById('signinForm').style.display = show ? 'none' : 'block';
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('forgotPane').style.display = show ? 'block' : 'none';
  document.querySelector('.auth-tabs').style.display  = show ? 'none' : 'flex';
  if(show){
    if(!keepUser) fpUser = null;
    if(!keepUser) fpTypedEmail = '';
    if(!keepUser) fpStep(1);
    document.getElementById('fpEmergency').style.display = 'none';
    document.getElementById('fp-confirm').value = '';
    authMsg('fpMsgE','');
    ['fp-user','fp-answer','fp-p1','fp-p2'].forEach(id=>document.getElementById(id).value='');
    ['fpMsg1','fpMsg2','fpMsg3'].forEach(id=>authMsg(id,''));
    document.getElementById('fp-user').focus();
  }
}

function fpStep(n){
  [1,2,3].forEach(i=>document.getElementById('fpStep'+i).style.display = i===n ? 'block' : 'none');
  document.getElementById('fpPick').style.display = n==='pick' ? 'block' : 'none';
  document.getElementById('fpSub').textContent = {
    1:'Enter the Gmail address on your account and we will send a code.',
    2:'Answer the question this account chose.',
    pick:'We could not match that Gmail to an account.',
    3:'Pick a new password.'
  }[n] || '';
}

/* n***l@gmail.com — confirms the address without exposing it */

function maskEmail(e){
  const [u, d] = String(e).split('@');
  if(!d) return e;
  const shown = u.length <= 2 ? u[0] : u[0] + '*'.repeat(Math.min(u.length-2, 5)) + u[u.length-1];
  return `${shown}@${d}`;
}

document.getElementById('btnForgot').addEventListener('click', ()=>showForgot(true));

document.getElementById('fpBack').addEventListener('click', ()=>{ showForgot(false); switchAuthTab('signin'); });

document.getElementById('fpStuck').addEventListener('click', ()=>{
  const box = document.getElementById('fpEmergency');
  const open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  if(!open) document.getElementById('fp-confirm').focus();
});

document.getElementById('fpWipe').addEventListener('click', async ()=>{
  const typed = document.getElementById('fp-confirm').value.trim().toUpperCase();
  if(typed !== 'RESET ACCOUNTS')
    return authMsg('fpMsgE', 'Type RESET ACCOUNTS exactly to confirm.');

  const count = state.users.length;
  state.users = [];          // items, activity and everything else survive
  state.nextUserId = 1;
  await saveState();

  document.getElementById('fp-confirm').value = '';
  showAuthScreen();          // no accounts left, so first-run setup appears
  toast(`${count} account${count===1?'':'s'} removed — create a new Admin`);
});

// Step 1 — find the account

/* Find by Gmail. Usernames still work, so nobody who types the wrong
   thing gets stuck. */

document.getElementById('fpNext1').addEventListener('click', ()=>{
  const typed = document.getElementById('fp-user').value.trim();
  if(!typed) return authMsg('fpMsg1', 'Enter the Gmail address on your account.');

  const u = findUserByEmail(typed) || findUser(typed);

  if(!u){
    // Before email is configured, let them attach the address to an account
    // so the flow is testable. Once configured this closes.
    if(isGmail(typed) && state.users.length){
      fpTypedEmail = typed.trim().toLowerCase();
      const sel = document.getElementById('fp-account');
      sel.innerHTML = state.users.map(x =>
        `<option value="${x.id}">${escapeHtml(x.username)}${x.email?` — ${escapeHtml(x.email)}`:' — no Gmail yet'}</option>`).join('');
      authMsg('fpMsg1',''); authMsg('fpMsgP','');
      fpStep('pick');
      return;
    }
    return authMsg('fpMsg1', typed.includes('@')
      ? 'No account uses that Gmail address. Sign in and add one under My Account, or ask an Admin to set it from Settings → User Accounts.'
      : 'No account with that name. Try your Gmail address instead.');
  }

  fpUser = u;

  // Found them but there is no address to send to
  if(!u.email){
    if(u.q && u.qHash){
      authMsg('fpMsg1', '');
      document.getElementById('fp-question').textContent = u.q;
      fpStep(2);
      document.getElementById('fp-answer').focus();
      return;
    }
    const otherAdmins = state.users.filter(x => x.role==='admin' && x.id !== u.id).length;
    return authMsg('fpMsg1',
      'That account has no Gmail address and no security question. ' +
      (otherAdmins
        ? 'Ask another Admin to reset it from Settings → User Accounts.'
        : 'You are the only Admin, so use "Completely locked out?" below.'));
  }

  // Send the code straight away
  authMsg('fpMsg1', '');
  startOtp({
    email: u.email,
    purpose: 'Reset your password',
    subtitle: `Enter the code sent to ${maskEmail(u.email)}.`,
    onVerified: ()=>{
      showOtpPane(false);
      showForgot(true, true);
      fpStep(3);
      document.getElementById('fp-p1').focus();
    }
  });
  // Offer the question as a way out if they have one
  document.getElementById('otpUseQuestion').style.display = (u.q && u.qHash) ? 'block' : 'none';
});

document.getElementById('fpPickGo').addEventListener('click', ()=>{
  const u = state.users.find(x => x.id === Number(document.getElementById('fp-account').value));
  if(!u) return authMsg('fpMsgP', 'Pick an account.');
  fpUser = u;

  startOtp({
    email: fpTypedEmail,
    purpose: 'Reset your password',
    subtitle: `Verify ${maskEmail(fpTypedEmail)} to reset the password for "${u.username}".`,
    onVerified: async ()=>{
      // Verified, so the address now belongs to that account
      if(!state.users.some(x => x.id !== u.id && (x.email||'').toLowerCase() === fpTypedEmail)){
        u.email = fpTypedEmail;
        await saveState();
      }
      showOtpPane(false);
      showForgot(true, true);
      fpStep(3);
      document.getElementById('fp-p1').focus();
    }
  });
  document.getElementById('otpUseQuestion').style.display = (u.q && u.qHash) ? 'block' : 'none';
});

document.getElementById('otpUseQuestion').addEventListener('click', ()=>{
  if(!fpUser || !fpUser.q) return;
  otpSession = null;
  showOtpPane(false);
  showForgot(true, true);
  document.getElementById('fp-question').textContent = fpUser.q;
  fpStep(2);
  document.getElementById('fp-answer').focus();
});

// Step 2 — check the answer

document.getElementById('fpNext2').addEventListener('click', async ()=>{
  if(!fpUser) return fpStep(1);
  if(fpAttempts >= 5)
    return authMsg('fpMsg2', 'Too many failed attempts. Ask an Admin to reset this password instead.');

  const given = normalizeAnswer(document.getElementById('fp-answer').value);
  if(!given) return authMsg('fpMsg2', 'Type your answer.');

  const attempt = await hashPassword(given, fpUser.qSalt);
  if(attempt !== fpUser.qHash){
    fpAttempts++;
    return authMsg('fpMsg2', `That answer does not match. ${5-fpAttempts} attempt${5-fpAttempts===1?'':'s'} left.`);
  }
  fpAttempts = 0;
  authMsg('fpMsg2','');
  fpStep(3);
  document.getElementById('fp-p1').focus();
});

// Step 3 — set the new password

document.getElementById('fpSave').addEventListener('click', async ()=>{
  if(!fpUser) return fpStep(1);
  const p1 = document.getElementById('fp-p1').value, p2 = document.getElementById('fp-p2').value;
  if(p1.length < 6) return authMsg('fpMsg3', 'Password needs at least 6 characters.');
  if(p1 !== p2)     return authMsg('fpMsg3', 'The two passwords do not match.');

  fpUser.salt = makeSalt();
  fpUser.hash = await hashPassword(p1, fpUser.salt);
  await saveState();

  const uname = fpUser.username;
  showForgot(false);
  switchAuthTab('signin');
  document.getElementById('li-user').value = uname;
  authMsg('loginMsg', 'Password updated — you can sign in now.', true);
  document.getElementById('li-pass').focus();
});

/* ---------- My Account ----------
   Lets anyone change their own password and set a recovery question,
   which is how accounts made before this feature can enable it. */

document.getElementById('btnMyAccount').addEventListener('click', ()=>{
  if(!currentUser) return;
  const hasQ = !!currentUser.q;
  openModal(`My Account — ${currentUser.name}`, `
    <div class="hint" style="margin-bottom:14px;">
      Signed in as <strong style="color:var(--text)">${escapeHtml(currentUser.username)}</strong>
      · ${currentUser.role==='admin'?'Administrator':'Staff'}
    </div>

    <div class="field"><label>Gmail address ${currentUser.email
        ? '<span class="muted">(for one-time codes)</span>'
        : '<span style="color:var(--yellow)">— not set, so you cannot get an emailed code</span>'}</label>
      <input id="ma-email" type="email" placeholder="you@gmail.com" value="${escapeHtml(currentUser.email||'')}"/></div>

    <div class="field"><label>Change password <span class="muted">(leave blank to keep)</span></label>
      <input id="ma-p1" type="password" placeholder="New password"/></div>
    <div class="field"><label>Confirm new password</label>
      <input id="ma-p2" type="password" placeholder="Type it again"/></div>

    <div class="hint" style="margin:16px 0 8px;">
      Recovery question — ${hasQ
        ? 'currently set. Choose a new one to replace it.'
        : '<span style="color:var(--yellow)">not set. Without one you cannot reset your own password.</span>'}
    </div>
    <div class="field"><label>Security question</label><select id="ma-q"></select></div>
    <div class="field" id="ma-qcustom-wrap" style="display:none;"><label>Your own question</label>
      <input id="ma-qcustom" placeholder="e.g. What street did I grow up on?"/></div>
    <div class="field"><label>Answer <span class="muted">(leave blank to keep current)</span></label>
      <input id="ma-a" placeholder="Not case sensitive"/></div>
  `, `<button class="btn ghost" id="ma-cancel">Cancel</button>
      <button class="btn primary" id="ma-save">Save Changes</button>`);

  fillQuestionSelect('ma-q','ma-qcustom-wrap');
  if(currentUser.q && SECURITY_QUESTIONS.includes(currentUser.q))
    document.getElementById('ma-q').value = currentUser.q;

  document.getElementById('ma-cancel').addEventListener('click', closeModal);
  document.getElementById('ma-save').addEventListener('click', async ()=>{
    const p1 = document.getElementById('ma-p1').value;
    const p2 = document.getElementById('ma-p2').value;
    const ans = document.getElementById('ma-a').value;
    const q   = chosenQuestion('ma-q','ma-qcustom');
    const em  = document.getElementById('ma-email').value.trim().toLowerCase();
    let changed = [];

    if(em !== (currentUser.email||'')){
      if(em && !isGmail(em)) return toast('Use a Gmail address ending in @gmail.com', true);
      if(em && state.users.some(u => u.id !== currentUser.id && (u.email||'').toLowerCase() === em))
        return toast('Another account already uses that Gmail', true);
      currentUser.email = em;
      changed.push('Gmail address');
    }

    if(p1 || p2){
      if(p1.length < 6) return toast('Password needs at least 6 characters', true);
      if(p1 !== p2)     return toast('The two passwords do not match', true);
      currentUser.salt = makeSalt();
      currentUser.hash = await hashPassword(p1, currentUser.salt);
      changed.push('password');
    }
    if(ans.trim()){
      if(!q) return toast('Write your security question', true);
      currentUser.q = q;
      currentUser.qSalt = makeSalt();
      currentUser.qHash = await hashPassword(normalizeAnswer(ans), currentUser.qSalt);
      changed.push('recovery question');
    }
    if(!changed.length) return toast('Nothing to change', true);

    await saveState();
    renderUsers();
    closeModal();
    toast('Updated ' + changed.join(' and '));
  });
});

/* ---------- Download today's sales ----------
   A printable daily report: header block, one row per sale, totals,
   plus a second sheet grouping repeat sales of the same item. */
