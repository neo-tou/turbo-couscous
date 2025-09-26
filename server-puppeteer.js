app.get("/puppeteer-test", async (req, res) => {
  try {
    const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    await browser.close();
    res.send("Puppeteer launched successfully!");
  } catch (e) {
    res.status(500).send("Puppeteer failed: " + e.message);
  }
});