const https = require('https');

exports.handler = async function (event) {
  console.log('[claude] invoked —', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('[claude] API key present:', !!apiKey, '| key prefix:', apiKey ? apiKey.slice(0, 8) + '...' : 'MISSING');

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }),
    };
  }

  let payload;
  try {
    const parsed = JSON.parse(event.body || '{}');
    console.log('[claude] model:', parsed.model, '| max_tokens:', parsed.max_tokens, '| tools:', (parsed.tools || []).map(t => t.name || t.type).join(', ') || 'none');
    payload = JSON.stringify(parsed);
  } catch {
    console.log('[claude] failed to parse request body');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Request body must be valid JSON' }),
    };
  }

  console.log('[claude] payload size:', Buffer.byteLength(payload), 'bytes — sending to Anthropic');

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
      (res) => {
        console.log('[claude] Anthropic status:', res.statusCode);
        console.log('[claude] Anthropic headers:', JSON.stringify(res.headers));

        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
          console.log('[claude] chunk received, size:', chunk.length, 'bytes');
        });

        res.on('error', (err) => {
          console.log('[claude] response stream error:', err.message);
          resolve({
            statusCode: 502,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Response stream error: ' + err.message }),
          });
        });

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          console.log('[claude] response complete — total:', raw.length, 'bytes');
          console.log('[claude] response preview:', raw.slice(0, 300));

          let data;
          try {
            data = JSON.parse(raw);
          } catch (e) {
            console.log('[claude] JSON parse failed:', e.message);
            return resolve({
              statusCode: 502,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: 'Non-JSON response from Anthropic API', raw: raw.slice(0, 500) }),
            });
          }

          console.log('[claude] parsed OK — stop_reason:', data.stop_reason, '| content blocks:', (data.content || []).length, '| error:', data.error || 'none');
          resolve({
            statusCode: res.statusCode,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        });
      }
    );

    req.on('error', (err) => {
      console.log('[claude] request error:', err.message, '| code:', err.code);
      resolve({
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to reach Anthropic API: ' + err.message }),
      });
    });

    req.write(payload);
    req.end();
    console.log('[claude] request written and ended');
  });
};
