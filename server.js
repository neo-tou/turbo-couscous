/*
  server.js - ES module (Render-ready)
  - Uses Puppeteer to scrape Chess.com moves and return PGN.
  - No require() calls — uses import syntax.
*/
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";

const app = express();
app.use(cors());
app.use(express.json());

let browser = null;
async function getBrowser() {
  if (browser) return browser;
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browser;
}

async function getPgn(url) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    const moves = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".main-line-row"));
      const result = [];
      rows.forEach((row) => {
        const white = row.querySelector(".white-move .node-highlight-content")?.innerText.trim();
        const black = row.querySelector(".black-move .node-highlight-content")?.innerText.trim();
        if (white) result.push(white);
        if (black) result.push(black);
      });
      return result;
    });

    if (!moves || moves.length === 0) return null;

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }
    return pgn.trim();
  } finally {
    try { await page.close(); } catch (e) { /* ignore */ }
  }
}

app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });
    if (!/^https?:\/\/(www\.)?chess\.com/.test(url)) {
      return res.status(400).json({ ok: false, error: "Only chess.com URLs supported" });
    }

    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });
    res.json({ ok: true, pgn });
  } catch (err) {
    console.error("Error in /fetch-pgn:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PGN server running on port ${port}`));

process.on("SIGINT", async () => { console.log("SIGINT — closing browser"); if (browser) await browser.close(); process.exit(0); });
process.on("SIGTERM", async () => { console.log("SIGTERM — closing browser"); if (browser) await browser.close(); process.exit(0); });
