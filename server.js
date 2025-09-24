const express = require("express");
const fetch = require("node-fetch"); // for HTTP requests
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Function to pull PGN out of chess.com HTML
function extractPgnFromHtml(html) {
  let m = html.match(/<pre[^>]*class=["']?pgn["']?[^>]*>([\s\S]*?)<\/pre>/i);
  if (m && m[1]) return m[1].trim();

  m = html.match(/"pgn"\s*:\s*"([^"]{20,})"/i);
  if (m && m[1]) return m[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n');

  m = html.match(/(\[Event[\s\S]{50,}?\n\n?)(?=<|$)/i);
  if (m && m[1]) return m[1].trim();

  return null;
}

// Endpoint: send game link → get PGN
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "missing url" });

    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ ok: false, error: `status ${r.status}` });

    const html = await r.text();
    const pgn = extractPgnFromHtml(html);

    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    res.json({ ok: true, pgn });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PGN server running on http://localhost:${port}`));
