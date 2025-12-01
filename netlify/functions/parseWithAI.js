exports.handler = async (event) => {
  try {
    // Allow only POST
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    const { text } = JSON.parse(event.body || '{}');

    if (!text) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing text' })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing OPENAI_API_KEY' })
      };
    }

    const prompt = `
You are an expert convention labor scheduler.

Extract structured job details from the text below and return ONLY a JSON object with these keys:
{
  "jobName": "string",
  "jobNameMinimal": "string",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "location": "string",
  "workerCount": number,
  "jobPhase": "Install | Show | Teardown | Other",
  "boothNumber": "string"
}

Rules:
- Build a minimal job name field: "jobNameMinimal" in the format "<ClientShort> – <ShowShort> – <Phase>".
- ClientShort: extract the client name, strip suffixes like Inc., Inc, LLC, Corp, Corporation, Company, Co., Labs, Lab, Group, Holdings, Enterprises, etc., then take the first distinctive word (e.g., "NovaSignal Labs, Inc." -> "NovaSignal"; "Aeroflow Dynamics LLC" -> "Aeroflow"; "Raven Tech Corp." -> "Raven").
- ShowShort: use the shortest show code; if an acronym appears use it (e.g., "Consumer Electronics Show (CES)" -> "CES"; "National Association of Broadcasters Show (NAB)" -> "NAB"; "Specialty Equipment Market Association (SEMA)" -> "SEMA"). If no acronym, use the shortest recognizable form.
- jobNameMinimal = "<ClientShort> – <ShowShort> – <jobPhase>" (omit missing parts as needed but keep order client → show → phase).
- Identify booth numbers from patterns like "Booth W-3142", "Booth 55035", "Booth #4417", "Booth: 4021", "#W3124", etc. Return the booth number exactly as it appears (alphanumeric, include hyphens).
- jobName must be constructed in this order: Client name (if present) → Show name (if present) → Phase. Format: "<Client> – <Show> – <Phase>". If only one of client/show is present, include what you have. Avoid generic labels like "Exhibitor Labor Install".
- Detect jobPhase: setup/install -> "Install"; teardown/load-out -> "Teardown"; show hours -> "Show"; otherwise -> "Other". Include the phase inside jobName (e.g., "CES 2026 – NovaSignal Labs – Install").
- The "date" must be in "YYYY-MM-DD" format.
- "startTime" and "endTime" must be 24-hour "HH:MM" strings.
- "workerCount" must be an integer (no quotes).
- Choose jobPhase from Install, Show, Teardown, or Other.
- If you are unsure, make a reasonable best guess.
- Do not include any explanation, comments, or extra keys. Return only the JSON object.

Text:
"""${text}"""
`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    if (!aiRes.ok) {
      const errorText = await aiRes.text();
      console.error('OpenAI error:', aiRes.status, errorText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream AI error', detail: aiRes.status })
      };
    }

    const aiJson = await aiRes.json();
    const rawContent = aiJson.choices?.[0]?.message?.content || '';

    console.log('AI raw content:', rawContent);

    const cleaned = rawContent
      .replace(/```json/i, '```')
      .replace(/```/g, '')
      .trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const slice =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : '{}';

    let parsed;
    try {
      parsed = JSON.parse(slice);
    } catch (e) {
      console.error('Failed to JSON.parse AI content:', e, 'slice:', slice);
      parsed = {};
    }

    const response = {
      jobName: parsed.jobNameMinimal || parsed.jobName || '',
      jobNameMinimal: parsed.jobNameMinimal || '',
      date: parsed.date || '',
      startTime: parsed.startTime || '',
      endTime: parsed.endTime || '',
      location: parsed.location || '',
      workerCount: parsed.workerCount ?? '',
      jobPhase: parsed.jobPhase || '',
      boothNumber: parsed.boothNumber || ''
    };

    console.log('Normalized response:', response);

    return {
      statusCode: 200,
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error('parseWithAI error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
