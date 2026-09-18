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

/* persistSession: false preserves this app's original, deliberate behavior
   (see the old note in 03-storage.js/06-accounts.js): a shared counter
   terminal should sign everyone out on refresh/close, not silently resume
   whoever last used it. detectSessionInUrl stays on so the password-reset
   link (reset-password.html) and any email-confirmation link still work. */
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, detectSessionInUrl: true }
});
