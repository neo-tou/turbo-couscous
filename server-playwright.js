import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

app.post("/test-playwright", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const title = await page.title();
    await browser.close();

    res.json({ ok: true, title });
  } catch (err) {
    console.error("Playwright test error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
