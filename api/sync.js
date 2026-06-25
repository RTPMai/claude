export const config = { api: { bodyParser: true }, maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const token = process.env.PRINTAVO_API_TOKEN;
  const email = process.env.PRINTAVO_EMAIL;
  if(!token || !email) return res.status(500).json({ error: "Missing PRINTAVO_API_TOKEN or PRINTAVO_EMAIL" });

  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!upstashUrl || !upstashToken) return res.status(500).json({ error: "Missing Upstash env vars" });

  async function gql(query) {
    const r = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "email": email, "token": token },
      body: JSON.stringify({ query })
    });
    if(!r.ok) throw new Error(`Printavo HTTP ${r.status}`);
    const json = await r.json();
    if(json.errors) throw new Error(json.errors.map(e => e.message).join(", "));
    return json.data;
  }

  async function fetchAll(type, yearFilter) {
    const nodes = []; let cursor = null;
    do {
      const after = cursor ? `,after:"${cursor}"` : "";
      const yf = yearFilter || "";
      const data = await gql(`query{${type}(first:25,sortOn:VISUAL_ID${yf}${after}){nodes{id visualId createdAt total amountOutstanding status{id name}contact{fullName}}pageInfo{hasNextPage endCursor}}}`);
      if(!data[type]) throw new Error(`No ${type} field in response`);
      nodes.push(...data[type].nodes);
      cursor = data[type].pageInfo.hasNextPage ? data[type].pageInfo.endCursor : null;
      if(cursor) await new Promise(r => setTimeout(r, 700));
    } while(cursor);
    return nodes;
  }

  async function fetchAllStatuses() {
    const nodes = []; let cursor = null;
    do {
      const after = cursor ? `after:"${cursor}",` : "";
      const data = await gql(`query{statuses(${after}first:25){nodes{id name}pageInfo{hasNextPage endCursor}}}`);
      if(!data.statuses) throw new Error("No statuses field in response");
      nodes.push(...data.statuses.nodes);
      cursor = data.statuses.pageInfo.hasNextPage ? data.statuses.pageInfo.endCursor : null;
      if(cursor) await new Promise(r => setTimeout(r, 300));
    } while(cursor);
    return nodes;
  }

  try {
    const year = new Date().getFullYear();
    const yearFilter = `,inProductionAfter:"${year}-01-01T00:00:00Z"`;

    const statuses = await fetchAllStatuses();
    const invoices = await fetchAll("invoices", yearFilter);
    const quotes   = await fetchAll("quotes", "");

    const payload = JSON.stringify({ invoices, quotes, statuses, syncedAt: new Date().toISOString() });

    // Save to Upstash via REST
    const setRes = await fetch(`${upstashUrl}/set/printavo_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${upstashToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const setJson = await setRes.json();
    if(setJson.error) throw new Error("Upstash error: " + setJson.error);

    return res.status(200).json({
      ok: true,
      invoices: invoices.length,
      quotes: quotes.length,
      statuses: statuses.length,
      syncedAt: new Date().toISOString()
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
