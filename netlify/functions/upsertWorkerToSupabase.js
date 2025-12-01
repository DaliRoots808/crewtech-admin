exports.handler = async (event) => {
  console.log('[upsertWorkerToSupabase] incoming', {
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
    console.error('[upsertWorkerToSupabase] missing env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' })
    };
  }

  let parsed;
  try {
    parsed = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.error('[upsertWorkerToSupabase] JSON parse error', err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid payload' })
    };
  }

  const worker = parsed && (parsed.worker || parsed);
  const { id, name, phone, personalLink } = worker || {};
  // Normalize sms_opt_in to a real boolean or null
  let smsBool = null;
  if (worker && (worker.sms_opt_in === true || worker.sms_opt_in === 'on')) {
    smsBool = true;
  } else if (worker && (worker.sms_opt_in === false || worker.sms_opt_in === 'off')) {
    smsBool = false;
  }
  if (!id || !name) {
    console.error('[upsertWorkerToSupabase] invalid payload', worker);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid payload' })
    };
  }

  const payload = {
    id,
    name,
    phone: phone || '',
    sms_opt_in: smsBool,
    personal_link: personalLink || null
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[upsertWorkerToSupabase] Supabase error', res.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to upsert worker in Supabase',
          status: res.status,
          detail: text || null
        })
      };
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      json = null;
    }

    console.log('[upsertWorkerToSupabase] upsert result', json);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('[upsertWorkerToSupabase] Unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unexpected error' })
    };
  }
};
