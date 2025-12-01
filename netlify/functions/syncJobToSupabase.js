function looksLikeUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Invalid JSON' })
    };
  }

  const job = parsed.job || parsed;
  if (!job || !job.id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: 'Missing job payload or id' })
    };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[syncJobToSupabase] missing Supabase env vars');
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Supabase env vars missing' })
    };
  }

  const payload = {
    name: job.name,
    jobName: job.jobName,
    jobNameMinimal: job.jobNameMinimal,
    date: job.date,
    start_time: job.start_time ?? job.startTime ?? null,
    end_time: job.end_time ?? job.endTime ?? null,
    booth: job.booth,
    boothNumber: job.boothNumber,
    location: job.location,
    phase: job.phase,
    jobPhase: job.jobPhase,
    notes: job.notes,
    raw_text: job.raw_text,
    worker_assignments: job.worker_assignments ?? job.assignments ?? null,
    finalized_work_log: job.finalized_work_log ?? job.finalizedWorkLog ?? null,
    finalized_notes: job.finalized_notes ?? job.finalizedNotes ?? null,
    report_completed: job.report_completed ?? job.reportCompleted ?? false,
    created_at: job.created_at,
    updated_at: job.updated_at
  };

  if (looksLikeUuid(job.id)) {
    payload.id = job.id;
  }

  console.log('[syncJobToSupabase] payload to Supabase:', {
    ...payload,
    id: payload.id ? '[uuid-present]' : '[omitted]'
  });

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[syncJobToSupabase] error', res.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: text || 'Failed to upsert job into Supabase'
        })
      };
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      json = null;
    }

    const row = Array.isArray(json) ? json[0] : json;
    console.log('[syncJobToSupabase] upserted job', row?.id || payload.id);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, row: row || null })
    };
  } catch (err) {
    console.error('[syncJobToSupabase] unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Unexpected error' })
    };
  }
};
