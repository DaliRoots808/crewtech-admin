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

  const payload = {};

// Only set fields that were actually provided.
// This prevents "partial updates" from overwriting NOT NULL columns with null.

payload.id = job.id;

if (job.name !== undefined) payload.name = job.name;
if (job.jobName !== undefined) payload.jobName = job.jobName;
if (job.jobNameMinimal !== undefined) payload.jobNameMinimal = job.jobNameMinimal;
if (job.date !== undefined) payload.date = job.date;

// Times: only include if provided (avoid nulling NOT NULL columns)
const start = (job.start_time !== undefined) ? job.start_time : job.startTime;
const end   = (job.end_time   !== undefined) ? job.end_time   : job.endTime;
if (start !== undefined) payload.start_time = start;
if (end !== undefined) payload.end_time = end;

if (job.booth !== undefined) payload.booth = job.booth;
if (job.boothNumber !== undefined) payload.boothNumber = job.boothNumber;
if (job.location !== undefined) payload.location = job.location;
if (job.phase !== undefined) payload.phase = job.phase;
if (job.jobPhase !== undefined) payload.jobPhase = job.jobPhase;
if (job.notes !== undefined) payload.notes = job.notes;

// raw_text: accept either raw_text or rawText; only include if provided
const rawText = (job.raw_text !== undefined) ? job.raw_text : job.rawText;
if (rawText !== undefined) payload.raw_text = rawText;

// assignments: accept either worker_assignments or assignments; only include if provided
const assignments = (job.worker_assignments !== undefined) ? job.worker_assignments : job.assignments;
if (assignments !== undefined) payload.worker_assignments = assignments;

const workLog = (job.finalized_work_log !== undefined) ? job.finalized_work_log : job.finalizedWorkLog;
if (workLog !== undefined) payload.finalized_work_log = workLog;

const finNotes = (job.finalized_notes !== undefined) ? job.finalized_notes : job.finalizedNotes;
if (finNotes !== undefined) payload.finalized_notes = finNotes;

// report_completed: only include if provided; do NOT default to false on partial updates
const reportCompleted = (job.report_completed !== undefined) ? job.report_completed : job.reportCompleted;
if (reportCompleted !== undefined) payload.report_completed = reportCompleted;

if (job.created_at !== undefined) payload.created_at = job.created_at;
if (job.updated_at !== undefined) payload.updated_at = job.updated_at;


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
