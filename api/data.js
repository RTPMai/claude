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
    if(!json.result) return res.status(404).json({ error: "No data yet — run /api/sync first" });

    // Upstash returns the value as-is. Our sync stored a JSON string,
    // so result is a string. Parse until we have an object with invoices.
    let data = json.result;
    let attempts = 0;
    while(typeof data === "string" && attempts < 3) {
      data = JSON.parse(data);
      attempts++;
    }

    // If it's still not right, it may be a numeric-keyed object (string split across keys)
    if(typeof data === "object" && !data.invoices && data[0] !== undefined) {
      const rebuilt = Object.keys(data).sort((a,b)=>Number(a)-Number(b)).map(k=>data[k]).join("");
      data = JSON.parse(rebuilt);
    }

    if(!data.invoices) {
      return res.status(500).json({ error: "Could not parse stored data", type: typeof data });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
