export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if(req.method === "OPTIONS") return res.status(200).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if(!url || !token) return res.status(500).json({ error: "Upstash not configured" });

  try {
    const r = await fetch(`${url}/get/printavo_data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await r.json();

    if(!json.result) {
      return res.status(404).json({ error: "No data yet — visit /api/sync to populate" });
    }

    // Upstash may return a string or already-parsed object
    let data = json.result;
    if(typeof data === "string") {
      try { data = JSON.parse(data); } catch(e) {
        // If it's still a string after parse attempt, it may be double-encoded
        data = JSON.parse(JSON.parse(data));
      }
    }

    if(!data.invoices) {
      return res.status(500).json({ error: "Data malformed — re-run /api/sync", raw: typeof json.result, keys: Object.keys(data).slice(0,5) });
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
