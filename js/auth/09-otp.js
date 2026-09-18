/* ===== js/auth/09-otp.js =====
   One-time code generation and verification, used by both signup and password recovery.
   (Lines 1425-1510 of the original single-file build.) */

/* 09-otp.js — One-time code generation and verification, used by both signup and password recovery. */

let otpSession = null;

let otpResendAt = 0;

function makeOtp(){
  const b = new Uint32Array(1);
  if(typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else b[0] = Math.floor(Math.random() * 0xffffffff);
  return String(100000 + (b[0] % 900000));
}

/* Starts a code challenge. onVerified runs once the right code is typed. */

async function startOtp({email, purpose, subtitle, onVerified}){
  const code = makeOtp();
  otpSession = {
    email, purpose, onVerified, code,
    expires: Date.now() + 10*60*1000,
    attempts: 0
  };

  showOtpPane(true);
  document.getElementById('otpSub').textContent = subtitle;
  document.getElementById('otp-code').value = '';
  authMsg('otpMsg','');

  const demo = document.getElementById('otpDemo');
  demo.style.display = 'block';
  demo.innerHTML =
    `Your code is <strong style="color:var(--text);font-size:16px;letter-spacing:3px;">${code}</strong>.<br>
     It expires in 10 minutes. Anyone using this device can see it.`;
  otpResendAt = Date.now() + 10000;
}

function showOtpPane(show){
  document.getElementById('otpPane').style.display    = show ? 'block' : 'none';
  document.getElementById('signinForm').style.display = show ? 'none' : 'block';
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('forgotPane').style.display = 'none';
  document.querySelector('.auth-tabs').style.display  = show ? 'none' : 'flex';
  if(show) setTimeout(()=>document.getElementById('otp-code').focus(), 60);
}

document.getElementById('otpVerify').addEventListener('click', ()=>{
  if(!otpSession) return showOtpPane(false);
  const typed = document.getElementById('otp-code').value.trim();

  if(Date.now() > otpSession.expires)
    return authMsg('otpMsg', 'That code has expired. Press Resend for a new one.');
  if(otpSession.attempts >= 5)
    return authMsg('otpMsg', 'Too many wrong attempts. Press Resend to start over.');
  if(!/^\d{6}$/.test(typed))
    return authMsg('otpMsg', 'Enter the 6 digits shown above.');

  if(typed !== otpSession.code){
    otpSession.attempts++;
    return authMsg('otpMsg', `Wrong code. ${5 - otpSession.attempts} attempt${5-otpSession.attempts===1?'':'s'} left.`);
  }

  const done = otpSession.onVerified;
  otpSession = null;
  authMsg('otpMsg','');
  done();
});

document.getElementById('otpResend').addEventListener('click', ()=>{
  if(!otpSession) return;
  const wait = Math.ceil((otpResendAt - Date.now())/1000);
  if(wait > 0) return authMsg('otpMsg', `Wait ${wait}s before asking for another code.`);
  startOtp({...otpSession, subtitle: document.getElementById('otpSub').textContent});
});

document.getElementById('otpCancel').addEventListener('click', ()=>{
  otpSession = null;
  showOtpPane(false);
  switchAuthTab('signin');
});

document.getElementById('otp-code').addEventListener('keydown', e=>{
  if(e.key === 'Enter') document.getElementById('otpVerify').click();
});

/* The pages that live under Inventory */
