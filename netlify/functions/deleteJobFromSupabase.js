exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Supabase env vars missing' })
    };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' })
    };
  }

  const jobId = payload.jobId || payload.id;
  if (!jobId || !String(jobId).trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing jobId' })
    };
  }

  try {
    // Delete the row
    const url = `${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(String(jobId).trim())}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
        Prefer: 'return=representation'
      }
    });

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }

    if (!res.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Failed to delete job from Supabase',
          status: res.status,
          detail: text || null
        })
      };
    }

    // If Prefer return=representation, Supabase returns [] when nothing deleted
    const deletedCount = Array.isArray(json) ? json.length : 0;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, jobId: String(jobId).trim(), deletedCount })
    };
  } catch (err) {
    console.error('[deleteJobFromSupabase] Unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Unexpected error' })
    };
  }
};
