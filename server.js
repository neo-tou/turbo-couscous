/*
  server.js - Node backend
  - Scrapes Chess.com PGN with Puppeteer
  - Fetches player profiles via Chess.com API
  - Caches profiles in profiles.json for 30 days
*/
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import fs from "fs";

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

/* =========
   PGN Scraper
   ========= */
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
    try { await page.close(); } catch {}
  }
}

/* =========
   Profile Cache
   ========= */
const CACHE_FILE = "profiles.json";
let profileCache = {};

// Load existing cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    profileCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (err) {
    console.error("Error reading cache file:", err);
  }
}

// Save cache to disk
function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(profileCache, null, 2));
}

// Fetch Chess.com profile (with cache)
async function getProfile(username) {
  username = username.toLowerCase();
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  if (profileCache[username] && now - profileCache[username].lastFetched < THIRTY_DAYS) {
    return profileCache[username];
  }

  const res = await fetch(`https://api.chess.com/pub/player/${username}`);
  if (!res.ok) throw new Error("Chess.com API error for " + username);
  const data = await res.json();

  const profile = {
    username: data.username,
    rating: data.rating || "N/A",
    country: data.country || "N/A",
    avatar: data.avatar || null,
    lastFetched: now,
  };

  profileCache[username] = profile;
  saveCache();
  return profile;
}

/* =========
   Routes
   ========= */
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url, players } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });
    if (!/^https?:\/\/(www\.)?chess\.com/.test(url)) {
      return res.status(400).json({ ok: false, error: "Only chess.com URLs supported" });
    }

    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    let profiles = {};
    if (players && Array.isArray(players)) {
      for (const player of players) {
        try {
          profiles[player] = await getProfile(player);
        } catch (err) {
          console.error("Profile fetch error for", player, err);
        }
      }
    }

    res.json({ ok: true, pgn, profiles });
  } catch (err) {
    console.error("Error in /fetch-pgn:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

/* =========
   Server
   ========= */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PGN server running on port ${port}`));

process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
