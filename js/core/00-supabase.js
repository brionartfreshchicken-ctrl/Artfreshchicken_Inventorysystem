/* ===== js/core/00-supabase.js =====
   Supabase client init. Requires js/core/00-config.local.js (copy it from
   00-config.example.js) to be loaded first, and the supabase-js CDN
   script tag to be loaded before this file — see index.html. */

if(!window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY){
  document.write(
    '<div style="padding:24px;font:14px/1.6 monospace;color:#b00;">' +
    'Missing js/core/00-config.local.js — copy it from 00-config.example.js ' +
    'and fill in your Supabase project URL and publishable key.</div>'
  );
  throw new Error('Supabase config missing — see js/core/00-config.example.js');
}

/* Session survives a refresh (sessionStorage) but not closing the tab/
   browser — sessionStorage clears itself then, same as this app's
   original persistSession:false behavior did on every refresh. That
   original setting was meant to keep a shared counter terminal from
   silently resuming whoever last used it; sessionStorage still does
   that for the case that actually matters (someone closes up and the
   next person opens a fresh tab), while no longer forcing a re-login
   on every F5 within the same sitting. The one thing it doesn't catch:
   a tab left open and walked away from stays signed in until someone
   taps Logout. detectSessionInUrl stays on so the password-reset link
   (reset-password.html) and any email-confirmation link still work. */
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, storage: window.sessionStorage, detectSessionInUrl: true }
});
