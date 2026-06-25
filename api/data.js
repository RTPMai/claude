export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if(req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if(!url || !token) return res.status(500).json({ error: "Upstash not configured" });

  try {
    const r = await fetch(`${url}/get/printavo_data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await r.json();

    if(!json.result) {
      return res.status(404).json({ error: "No data yet. Trigger a sync first by visiting /api/sync?secret=YOUR_SECRET" });
    }

    const data = JSON.parse(json.result);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
