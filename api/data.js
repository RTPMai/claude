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

    // Parse once — if still a string or numeric-keyed object, parse again
    let data = json.result;
    if(typeof data === "string") data = JSON.parse(data);
    if(!data.invoices && typeof data === "object") {
      // Double-encoded — convert numeric-keyed object back to string then parse
      const str = Object.values(data).join("");
      data = JSON.parse(str);
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
