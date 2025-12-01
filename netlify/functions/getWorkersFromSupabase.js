exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' })
    };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workers?select=*`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      const bodyText = await res.text();
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to fetch workers from Supabase',
          status: res.status,
          detail: bodyText || null
        })
      };
    }

    let rows = [];
    try {
      const json = await res.json();
      rows = Array.isArray(json) ? json : [];
    } catch (err) {
      console.error('[getWorkersFromSupabase] JSON parse error', err);
      rows = [];
    }

    const workers = rows.map((row) => ({
      id: row.id,
      name: row.name || '',
      phone: row.phone || ''
    }));

    console.log('[getWorkersFromSupabase] workers returned:', workers.length);

    return {
      statusCode: 200,
      body: JSON.stringify({ workers })
    };
  } catch (err) {
    console.error('[getWorkersFromSupabase] Unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unexpected error' })
    };
  }
};
