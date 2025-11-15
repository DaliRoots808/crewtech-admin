exports.handler = async (event) => {
  try {
    const { phone, message } = JSON.parse(event.body || '{}');

    if (!phone || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing phone or message' }),
      };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    const client = require('twilio')(accountSid, authToken);

    const resp = await client.messages.create({
      body: message,
      from: fromNumber,
      to: phone,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, sid: resp.sid }),
    };
  } catch (err) {
    console.error('SMS error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
