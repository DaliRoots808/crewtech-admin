// Dev utility: wipes ALL rows from jobs and workers in Supabase.
// Uses service role key; keep this endpoint protected and admin-only.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  
  // Require owner scoping to avoid nuking shared prod data
  const user_id_qs =
    (event.queryStringParameters &&
      (event.queryStringParameters.user_id || event.queryStringParameters.userId)) ||
    "";

  let user_id_body = "";
  try {
    const parsed = event.body ? JSON.parse(event.body) : {};
    user_id_body = parsed.user_id || parsed.userId || "";
  } catch (_) {}

  const user_id = String(user_id_qs || user_id_body || "").trim();

  if (!user_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing user_id" })
    };
  }

const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('[clearAllData] missing Supabase env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Supabase env vars missing' })
    };
  }

  const baseUrl = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal'
  };

  try {
    // Delete ALL jobs (id is not null => every row)
    const deleteJobs = await fetch(`${baseUrl}/jobs?user_id=eq.${encodeURIComponent(user_id)}`, {
      method: 'DELETE',
      headers
    });
    if (!deleteJobs.ok) {
      const body = await deleteJobs.text();
      throw new Error(`Jobs delete failed: ${deleteJobs.status} ${body}`);
    }

    // Delete ALL workers
    const deleteWorkers = await fetch(`${baseUrl}/workers?user_id=eq.${encodeURIComponent(user_id)}`, {
      method: 'DELETE',
      headers
    });
    if (!deleteWorkers.ok) {
      const body = await deleteWorkers.text();
      throw new Error(`Workers delete failed: ${deleteWorkers.status} ${body}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[clearAllData] error', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};