// Netlify function: fetch a single worker by id from Supabase.
// Uses service role key on the backend; never expose this key to the client.

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const workerId =
    (event.queryStringParameters && event.queryStringParameters.workerId) || "";

  if (!workerId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing workerId query parameter" })
    };
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("[getWorkerFromSupabaseById] missing Supabase env vars");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Supabase env vars missing" })
    };
  }

  const baseUrl = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };

  try {
    const endpoint = `${baseUrl}/workers?id=eq.${encodeURIComponent(
      workerId
    )}&select=*&limit=1`;

    const res = await fetch(endpoint, { headers });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        "[getWorkerFromSupabaseById] Supabase error",
        res.status,
        text
      );
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "Supabase request failed" })
      };
    }

    const rows = await res.json();
    const worker = rows && rows.length > 0 ? rows[0] : null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: !!worker,
        worker
      })
    };
  } catch (err) {
    console.error("[getWorkerFromSupabaseById] unexpected error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", details: err.message })
    };
  }
};
