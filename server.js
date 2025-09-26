import express from "express";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// quick CORS header for all responses (simple, permissive)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ==== Simple Cache ====
const cacheFile = path.join(process.cwd(), "profiles.json");
let profileCache = {};
if (fs.existsSync(cacheFile)) {
  try { profileCache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); }
  catch (e) { console.error("Failed to load cache", e); }
}
function saveCache() {
  fs.writeFileSync(cacheFile, JSON.stringify(profileCache, null, 2));
}

// ==== Puppeteer Setup ====
const PUPPETEER_LAUNCH_OPTIONS = {
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
};

let browser;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
  }
  return browser;
}

// ==== 1️⃣ Puppeteer: Extract PGN ONLY ====
async function getPgn(url) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    const moves = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".main-line-row"));
      const result = [];
      rows.forEach(row => {
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
    try { await page.close(); } catch (e) {}
  }
}

// ==== 2️⃣ Chess.com API: Get usernames + profiles ====
async function getGameUsernames(gameUrl) {
  const match = gameUrl.match(/\/game\/live\/(\d+)/);
  if (!match) throw new Error("Invalid game URL");
  const gameId = match[1];

  const apiUrl = `https://api.chess.com/pub/game/live/${gameId}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error("Failed to fetch game JSON from Chess.com API");
  const data = await res.json();

  const white = data.white?.username;
  const black = data.black?.username;

  if (!white || !black) throw new Error("Could not get usernames from API");
  return [white, black];
}

// ==== Chess.com Profile Fetch ====
async function getProfile(username) {
  if (profileCache[username]) return profileCache[username];

  const url = `https://api.chess.com/pub/player/${username}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chess.com API error for ${username}`);
  const data = await res.json();

  let stats = {};
  try {
    const statsRes = await fetch(`https://api.chess.com/pub/player/${username}/stats`);
    if (statsRes.ok) stats = await statsRes.json();
  } catch (e) { console.warn("Failed to fetch stats for", username); }

  const profile = {
    username: data.username || username,
    name: data.name || "",
    country: data.country ? data.country.split("/").pop() : "",
    avatar: data.avatar || "",
    blitz: stats.chess_blitz?.last?.rating || null,
    bullet: stats.chess_bullet?.last?.rating || null,
    rapid: stats.chess_rapid?.last?.rating || null,
  };

  profileCache[username] = profile;
  saveCache();
  return profile;
}

// ==== Route: fetch-pgn ====
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });
    if (!/^https?:\/\/(www\.)?chess\.com/.test(url)) {
      return res.status(400).json({ ok: false, error: "Only chess.com URLs supported" });
    }

    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    const players = await getGameUsernames(url);

    const profiles = {};
    for (const player of players) {
      try { profiles[player] = await getProfile(player); }
      catch (err) { console.error("Profile fetch error for", player, err); }
    }

    res.json({ ok: true, pgn, profiles });
  } catch (err) {
    console.error("Error in /fetch-pgn:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// ==== Route: players-from-title ====
app.post("/players-from-title", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });
    if (!/^https?:\/\/(www\.)?chess\.com/.test(url)) {
      return res.status(400).json({ ok: false, error: "Only chess.com URLs supported" });
    }

    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      const title = await page.title();
      let match = title.match(/(.+)\s+vs\s+(.+?)\s+-\s+Chess\.com/i);

      if (!match) {
        match = title.match(/(.+)\s+v[s]?\s+(.+?)(\s*[-—|]|\s*$)/i);
      }

      const whiteRaw = match ? match[1].trim() : null;
      const blackRaw = match ? match[2].trim() : null;

      const white = whiteRaw ? whiteRaw.replace(/^Chess:\s*/i, "").trim() : null;
      const black = blackRaw ? blackRaw.replace(/^Chess:\s*/i, "").trim() : null;

      if (!white && !black) {
        return res.status(404).json({ ok: false, error: "Could not parse usernames from title", title });
      }

      const profiles = {};
      for (const u of [white, black].filter(Boolean)) {
        try {
          profiles[u] = await getProfile(u);
        } catch (err) {
          console.warn("Failed to fetch profile for", u, err?.message || err);
        }
      }

      return res.json({ ok: true, usernames: { white, black }, profiles, title });
    } finally {
      try { await page.close(); } catch (e) { }
    }
  } catch (err) {
    console.error("Error in /players-from-title:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

// ==== Shutdown ====
process.on("exit", async () => { if (browser) await browser.close(); });

// ==== Start Server ====
app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
