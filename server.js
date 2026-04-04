const express = require("express");
const subtitlesRouter = require("./routes/subtitles");

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api/subtitles", subtitlesRouter);

const port = Number(process.env.PORT || 3004);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Subtitle pipeline server listening on http://localhost:${port}`);
});
