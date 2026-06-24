export const config = {
  runtime: 'nodejs20.x',
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.PRINTAVO_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "PRINTAVO_API_TOKEN not set in environment variables" });
  }

  // For GET requests (browser test), return a status check
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", message: "Printavo proxy is running. Token is set." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } catch {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const printavoRes = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body,
    });

    const data = await printavoRes.json();
    return res.status(printavoRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
