exports.handler = async (event) => {
  console.log('[deleteWorkerFromSupabase] incoming', {
    method: event.httpMethod,
    body: event.body
  });

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[deleteWorkerFromSupabase] missing env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' })
    };
  }

  let parsed;
  try {
    parsed = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.error('[deleteWorkerFromSupabase] JSON parse error', err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid payload' })
    };
  }

  const workerId = (parsed && (parsed.workerId || parsed.id)) || null;
  if (!workerId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing workerId' })
    };
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/workers?id=eq.${encodeURIComponent(workerId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[deleteWorkerFromSupabase] Supabase error', res.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Failed to delete worker in Supabase',
          status: res.status,
          detail: text || null
        })
      };
    }

    console.log('[deleteWorkerFromSupabase] success', { workerId });
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('[deleteWorkerFromSupabase] Unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unexpected error' })
    };
  }
};
