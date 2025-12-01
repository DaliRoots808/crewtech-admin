exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');

    const to = payload.to || payload.phone;
    const body = payload.body || payload.message;

    if (!to || !body) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Missing required fields: provide 'to' or 'phone', and 'body' or 'message'."
        })
      };
    }

    const mockSid = 'SM-MOCKED-' + Date.now();
    console.log(`[MOCK SMS] to: ${to} | body: ${body}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        mock: true,
        sid: mockSid,
        to,
        body
      })
    };
  } catch (error) {
    console.error('Mock sendSMS error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
