export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.PRINTAVO_API_TOKEN;
  const email = process.env.PRINTAVO_EMAIL;

  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", message: "Proxy running. Token: " + (token ? "set" : "missing") + ", Email: " + (email ? "set" : "missing") });
  }

  if (!token || !email) {
    return res.status(500).json({ error: "Missing PRINTAVO_API_TOKEN or PRINTAVO_EMAIL env vars" });
  }

  const body = JSON.stringify(req.body || {});

  try {
    const printavoRes = await fetch("https://www.printavo.com/api/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "email": email,
        "token": token,
      },
      body,
    });

    const text = await printavoRes.text();
    res.setHeader("Content-Type", "application/json");
    return res.status(printavoRes.status).send(text);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
