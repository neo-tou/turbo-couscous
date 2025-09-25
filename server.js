import express from "express";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

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
let browser;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

// ==== Scraper: PGN + Player usernames ====
async function getPgnAndPlayers(url) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    // Extract moves
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

    if (!moves || moves.length === 0) return { pgn: null, players: [] };

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }

    // Extract usernames
    const players = await page.evaluate(() => {
      const names = [];
      const whiteEl = document.querySelector(
        ".player-tagline-username-component.player-tagline-username-white a"
      );
      const blackEl = document.querySelector(
        ".player-tagline-username-component.player-tagline-username-black a"
      );
      if (whiteEl) names.push(whiteEl.innerText.trim());
      if (blackEl) names.push(blackEl.innerText.trim());
      return names;
    });

    return { pgn: pgn.trim(), players };
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

// ==== Chess.com Profile Fetch (username + country + Elo) ====
async function getProfile(username) {
  if (profileCache[username]) return profileCache[username];

  const url = `https://api.chess.com/pub/player/${username}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chess.com API error for ${username}`);
  const data = await res.json();

  // Fetch stats for Elo ratings
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

// ==== Routes ====
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });
    if (!/^https?:\/\/(www\.)?chess\.com/.test(url)) {
      return res.status(400).json({ ok: false, error: "Only chess.com URLs supported" });
    }

    const { pgn, players } = await getPgnAndPlayers(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    let profiles = {};
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

// ==== Shutdown ====
process.on("exit", async () => { if (browser) await browser.close(); });

// ==== Start Server ====
app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
