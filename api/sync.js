export const config = { api: { bodyParser: true } };

async function redis(method, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/${method}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const secret = process.env.SYNC_SECRET;
  if(secret && req.query.secret !== secret && req.headers['x-sync-secret'] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = process.env.PRINTAVO_API_TOKEN;
  const email = process.env.PRINTAVO_EMAIL;
  if(!token || !email) return res.status(500).json({ error: "Missing Printavo credentials" });

  async function gql(query) {
    const r = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "email": email, "token": token },
      body: JSON.stringify({ query })
    });
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
      nodes.push(...data.statuses.nodes);
      cursor = data.statuses.pageInfo.hasNextPage ? data.statuses.pageInfo.endCursor : null;
      if(cursor) await new Promise(r => setTimeout(r, 300));
    } while(cursor);
    return nodes;
  }

  try {
    const year = new Date().getFullYear();
    const yearFilter = `,inProductionAfter:"${year}-01-01T00:00:00Z"`;

    const [invoices, quotes, statuses] = await Promise.all([
      fetchAll("invoices", yearFilter),
      fetchAll("quotes", ""),
      fetchAllStatuses()
    ]);

    const payload = JSON.stringify({ invoices, quotes, statuses, syncedAt: new Date().toISOString() });

    // Store in Upstash Redis via REST API — split into chunks if needed
    // Upstash REST SET: /set/key/value
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const authToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    await fetch(`${url}/set/printavo_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(["set", "printavo_data", payload])
    });

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
