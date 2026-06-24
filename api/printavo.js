// Minimal Vercel-style serverless proxy for Printavo.
// NOTE: Edit authorization or sensitive headers as needed.
export default async function handler(req, res) {
  try {
    const targetBase = 'https://api.printavo.com';
    // req.url in serverless often includes the leading path (e.g., /api/endpoint)
    const path = (req.url || '').replace(/^\//, '');
    const url = new URL(path, targetBase);

    // Forward method, headers, and body (except some hop-by-hop headers)
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];

    const init = {
      method: req.method,
      headers,
      // In Node/Vercel, req has a readable body — use fetch's body passthrough when present
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    };

    const resp = await fetch(url.toString(), init);
    const respBody = await resp.arrayBuffer();

    // Copy response headers
    for (const [k, v] of resp.headers.entries()) {
      if (k.toLowerCase() === 'transfer-encoding') continue;
      res.setHeader(k, v);
    }

    res.status(resp.status).send(Buffer.from(respBody));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error', detail: String(err) });
  }
}
