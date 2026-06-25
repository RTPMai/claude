export const config = { api: { bodyParser: true }, maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const token      = process.env.PRINTAVO_API_TOKEN;
  const email      = process.env.PRINTAVO_EMAIL;
  const kvUrl      = process.env.KV_REST_API_URL;
  const kvToken    = process.env.KV_REST_API_TOKEN;

  if(!token||!email)     return res.status(500).json({ error: "Missing Printavo credentials" });
  if(!kvUrl||!kvToken)   return res.status(500).json({ error: "Missing Upstash env vars" });

  // What are we syncing? invoices, quotes, or finalize
  const mode = req.query.mode || "invoices";
  // Resume cursor lets us pick up where we left off
  const resumeCursor = req.query.cursor || null;

  async function gql(query) {
    const r = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "email": email, "token": token },
      body: JSON.stringify({ query })
    });
    if(!r.ok) throw new Error(`Printavo HTTP ${r.status}`);
    const json = await r.json();
    if(json.errors) throw new Error(json.errors.map(e=>e.message).join(", "));
    return json.data;
  }

  async function kvGet(key) {
    const r = await fetch(`${kvUrl}/get/${key}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    const j = await r.json();
    if(!j.result) return null;
    let val = j.result;
    if(typeof val === "string") val = JSON.parse(val);
    if(!val.invoices && val[0] !== undefined) {
      val = JSON.parse(Object.keys(val).sort((a,b)=>Number(a)-Number(b)).map(k=>val[k]).join(""));
    }
    return val;
  }

  async function kvSet(key, value) {
    const payload = JSON.stringify(value);
    await fetch(`${kvUrl}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", key, payload]])
    });
  }

  async function fetchAllStatuses() {
    const nodes = []; let cursor = null;
    do {
      const after = cursor ? `after:"${cursor}",` : "";
      const data = await gql(`query{statuses(${after}first:25){nodes{id name}pageInfo{hasNextPage endCursor}}}`);
      nodes.push(...data.statuses.nodes);
      cursor = data.statuses.pageInfo.hasNextPage ? data.statuses.pageInfo.endCursor : null;
      if(cursor) await new Promise(r=>setTimeout(r,400));
    } while(cursor);
    return nodes;
  }

  try {
    if(mode === "invoices") {
      // Fetch invoices in batches, storing progress in KV
      // Load existing partial data if resuming
      let existing = [];
      try { const p = await kvGet("printavo_invoices_partial"); if(p&&p.nodes) existing=p.nodes; } catch(e){}
      if(!resumeCursor) existing = []; // Fresh start

      const nodes = [...existing];
      let cursor = resumeCursor;
      const deadline = Date.now() + 240000; // Stop after 4 min to leave time for response

      let pages = 0;
      do {
        const after = cursor ? `,after:"${cursor}"` : "";
        const data = await gql(`query{invoices(first:25,sortOn:VISUAL_ID${after}){nodes{id visualId createdAt total amountOutstanding status{id name}contact{fullName}}pageInfo{hasNextPage endCursor}}}`);
        nodes.push(...data.invoices.nodes);
        cursor = data.invoices.pageInfo.hasNextPage ? data.invoices.pageInfo.endCursor : null;
        pages++;
        if(cursor) await new Promise(r=>setTimeout(r,1200));
      } while(cursor && Date.now() < deadline);

      // Save progress
      await kvSet("printavo_invoices_partial", { nodes, cursor, updatedAt: new Date().toISOString() });

      if(cursor) {
        // More pages remain — return next cursor for caller to continue
        return res.status(200).json({ ok:true, status:"partial", fetched:nodes.length, pages, nextCursor:cursor, nextUrl:`/api/sync?mode=invoices&cursor=${encodeURIComponent(cursor)}` });
      } else {
        // Done with invoices — move on to quotes
        return res.status(200).json({ ok:true, status:"invoices_done", fetched:nodes.length, pages, nextUrl:"/api/sync?mode=quotes" });
      }
    }

    else if(mode === "quotes") {
      let existing = [];
      try { const p = await kvGet("printavo_quotes_partial"); if(p&&p.nodes) existing=p.nodes; } catch(e){}
      if(!resumeCursor) existing = [];

      const nodes = [...existing];
      let cursor = resumeCursor;
      const deadline = Date.now() + 240000;
      let pages = 0;

      do {
        const after = cursor ? `,after:"${cursor}"` : "";
        const data = await gql(`query{quotes(first:25,sortOn:VISUAL_ID${after}){nodes{id visualId createdAt total amountOutstanding status{id name}contact{fullName}}pageInfo{hasNextPage endCursor}}}`);
        nodes.push(...data.quotes.nodes);
        cursor = data.quotes.pageInfo.hasNextPage ? data.quotes.pageInfo.endCursor : null;
        pages++;
        if(cursor) await new Promise(r=>setTimeout(r,1200));
      } while(cursor && Date.now() < deadline);

      await kvSet("printavo_quotes_partial", { nodes, cursor, updatedAt: new Date().toISOString() });

      if(cursor) {
        return res.status(200).json({ ok:true, status:"partial", fetched:nodes.length, pages, nextCursor:cursor, nextUrl:`/api/sync?mode=quotes&cursor=${encodeURIComponent(cursor)}` });
      } else {
        return res.status(200).json({ ok:true, status:"quotes_done", fetched:nodes.length, pages, nextUrl:"/api/sync?mode=finalize" });
      }
    }

    else if(mode === "finalize") {
      // Combine everything and save to main key
      const invPartial = await kvGet("printavo_invoices_partial");
      const quoPartial = await kvGet("printavo_quotes_partial");
      const statuses   = await fetchAllStatuses();

      const invoices = invPartial&&invPartial.nodes ? invPartial.nodes : [];
      const quotes   = quoPartial&&quoPartial.nodes ? quoPartial.nodes : [];

      await kvSet("printavo_data", { invoices, quotes, statuses, syncedAt: new Date().toISOString() });

      return res.status(200).json({ ok:true, status:"complete", invoices:invoices.length, quotes:quotes.length, statuses:statuses.length, syncedAt:new Date().toISOString() });
    }

    else {
      return res.status(400).json({ error: "Invalid mode. Use: invoices, quotes, finalize" });
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
