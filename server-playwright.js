import express from "express";
import { chromium } from "playwright";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

// CORS
app.use((req,res,next)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS") return res.sendStatus(204);
  next();
});

let browser;
async function getBrowser(){ if(!browser) browser = await chromium.launch({headless:true}); return browser; }

async function getPlayerProfiles(url){
  const b = await getBrowser();
  const page = await b.newPage();
  try{
    await page.goto(url,{waitUntil:"domcontentloaded"});
    const title = await page.title();
    let match = title.match(/(.+)\s+vs\s+(.+?)\s+-\s+Chess\.com/i) || title.match(/(.+)\s+v[s]?\s+(.+?)(\s*[-—|]|\s*$)/i);
    const white = match?.[1]?.replace(/^Chess:\s*/i,"").trim() || null;
    const black = match?.[2]?.replace(/^Chess:\s*/i,"").trim() || null;
    if(!white && !black) return {error:"Could not parse usernames", title};

    const profiles={};
    for(const u of [white,black].filter(Boolean)){
      try{
        const res = await fetch(`https://api.chess.com/pub/player/${u}`);
        const data = await res.ok ? await res.json() : {};
        const statsRes = await fetch(`https://api.chess.com/pub/player/${u}/stats`);
        const stats = statsRes.ok ? await statsRes.json() : {};
        profiles[u] = {
          username: data.username||u,
          name:data.name||"",
          country:data.country?.split("/").pop()||"",
          avatar:data.avatar||"",
          blitz:stats.chess_blitz?.last?.rating||null,
          bullet:stats.chess_bullet?.last?.rating||null,
          rapid:stats.chess_rapid?.last?.rating||null
        };
      }catch(e){console.warn(e);}
    }
    return {white,black,profiles,title};
  }finally{ try{await page.close();}catch{} }
}

// Route
app.post("/players-from-title", async(req,res)=>{
  try{
    const {url}=req.body;
    if(!url) return res.status(400).json({ok:false,error:"Missing URL"});
    const result = await getPlayerProfiles(url);
    res.json({ok:true,...result});
  }catch(e){console.error(e);res.status(500).json({ok:false,error:"server error"});}
});

// Shutdown
process.on("exit",async()=>{ if(browser) await browser.close(); });

// Start server
app.listen(PORT,()=>console.log(`Playwright player server running on port ${PORT}`));
