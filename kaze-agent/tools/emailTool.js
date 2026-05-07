const https = require('https');

async function sendEmail(to, subject, body) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { error: 'RESEND_API_KEY_MISSING' };
  
  const payload = JSON.stringify({
    from: 'Kaze AI <onboarding@resend.dev>',
    to: [to],
    subject: subject,
    text: body
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(payload);
    req.end();
  });
}

module.exports = { sendEmail };
