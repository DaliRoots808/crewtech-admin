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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=*`, {
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
          error: 'Failed to fetch jobs from Supabase',
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
      console.error('[getJobsFromSupabase] JSON parse error', err);
      rows = [];
    }

    // Keep the shape simple and compatible with the app
    const jobs = rows.map((row) => ({
      id: row.id,
      name: row.name || '',
      jobName: row.jobname ?? row.jobName ?? null,
      jobNameMinimal: row.jobnameminimal ?? row.jobNameMinimal ?? null,
      date: row.date || '',
      startTime: row.start_time ?? row.startTime ?? '',
      endTime: row.end_time ?? row.endTime ?? '',
      booth: row.booth || '',
      boothNumber: row.boothnumber ?? row.boothNumber ?? null,
      location: row.location || '',
      phase: row.phase || '',
      jobPhase: row.jobphase ?? row.jobPhase ?? null,
      notes: row.notes || '',
      rawText: row.raw_text ?? row.rawText ?? '',
      assignments: row.worker_assignments ?? row.assignments ?? null,
      finalizedWorkLog: row.finalized_work_log ?? row.finalizedWorkLog ?? null,
      finalizedNotes: row.finalized_notes ?? row.finalizedNotes ?? null,
      reportCompleted: row.report_completed ?? row.reportCompleted ?? false,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null
    }));

    console.log('[getJobsFromSupabase] jobs returned:', jobs.length);

    return {
      statusCode: 200,
      body: JSON.stringify({ jobs })
    };
  } catch (err) {
    console.error('[getJobsFromSupabase] Unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unexpected error' })
    };
  }
};
