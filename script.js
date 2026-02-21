/* ===== Supabase Auth Init (Magic Link / UUID owner) ===== */
window.__crewtechSupabaseInit = (async function () {
  try {
    const res = await fetch("/.netlify/functions/getSupabaseConfig");
    if (!res.ok) {
      console.warn("[Supabase init] failed to fetch config");
      return null;
    }

    const { supabaseUrl, supabaseAnonKey } = await res.json();
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("[Supabase init] missing config values");
      return null;
    }

    const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      console.warn("[Supabase init] No active session (not logged in via magic link)");
      return { supabase, session: null, user: null };
    }

    const user = session.user || null;
    console.log("[Supabase init] Logged in user:", user?.id);

    window.__crewtechAuth = { supabase, session, user };
    return window.__crewtechAuth;

  } catch (err) {
    console.error("[Supabase init] error:", err);
    return null;
  }
})();


