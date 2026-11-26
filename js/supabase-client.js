/* Creates the shared Supabase client from js/config.js.
   window.VC_SUPABASE is null until the config holds a real project URL and key. */
(function () {
  const cfg = window.VC_CONFIG || {};
  const ready = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) && window.supabase);
  window.VC_CONFIGURED = ready;
  window.VC_SUPABASE = ready
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
})();
