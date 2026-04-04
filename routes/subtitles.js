const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const express = require("express");
const multer = require("multer");
const { assertBinaries } = require("../utils/ffmpeg");
const { extractAudio, burnSubtitles } = require("../services/videoService");
const { transcribeAudio } = require("../services/subtitleService");

const router = express.Router();
const tempUploadRoot = path.join(process.cwd(), ".video-editor-jobs", "pipeline-upload-tmp");
const pipelineRoot = path.join(process.cwd(), ".video-editor-jobs", "pipeline");

const googleFontFallbacks = {
  Poppins: "Arial",
  Montserrat: "Arial",
  Roboto: "Arial",
  "Open Sans": "Arial",
  Lato: "Arial",
  Oswald: "Arial",
  Raleway: "Arial",
  Nunito: "Arial",
  "Work Sans": "Arial",
  "Source Sans 3": "Arial",
  Inter: "Arial",
  Ubuntu: "Arial",
  "PT Sans": "Arial",
  "Josefin Sans": "Arial",
  "Bebas Neue": "Helvetica",
  "Playfair Display": "Times New Roman",
  Merriweather: "Times New Roman",
  Lora: "Times New Roman",
  "Noto Serif": "Times New Roman",
  "Libre Baskerville": "Times New Roman",
  "Cormorant Garamond": "Times New Roman",
  Arvo: "Times New Roman",
  "DM Serif Display": "Times New Roman",
  "Abril Fatface": "Helvetica",
  "Space Grotesk": "Arial",
  "Titillium Web": "Arial",
  "Barlow Condensed": "Helvetica",
  Anton: "Helvetica",
  "Fira Sans": "Arial",
  Inconsolata: "Courier New",
};

function sanitizeJobId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!/^[a-zA-Z0-9-]+$/.test(value)) {
    return null;
  }
  return value;
}

function getFontFamily(fontChoice) {
  return googleFontFallbacks[fontChoice] || "Arial";
}

const upload = multer({
  dest: tempUploadRoot,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
});

router.get("/fonts", (_req, res) => {
  res.json({
    fonts: Object.keys(googleFontFallbacks),
  });
});

router.post("/process", upload.single("video"), async (req, res) => {
  let tempPath = req.file?.path || "";
  try {
    assertBinaries();

    if (!req.file) {
      return res.status(400).json({ error: "Video upload is required." });
    }

    await fs.mkdir(tempUploadRoot, { recursive: true });
    await fs.mkdir(pipelineRoot, { recursive: true });

    const jobId = randomUUID();
    const jobDir = path.join(pipelineRoot, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const ext = path.extname(req.file.originalname || "").trim() || ".mp4";
    const sourceVideoPath = path.join(jobDir, `source${ext}`);
    const audioPath = path.join(jobDir, "audio.wav");
    const srtPath = path.join(jobDir, `${jobId}.srt`);
    const wordsPath = path.join(jobDir, `${jobId}.words.json`);
    const outputVideoPath = path.join(jobDir, `${jobId}.mp4`);

    await fs.copyFile(req.file.path, sourceVideoPath);
    await fs.unlink(req.file.path);
    tempPath = "";

    const fontChoice = String(req.body.fontChoice || "Poppins");
    const fontSize = Number(req.body.fontSize || 48);
    const highlightColor = String(req.body.highlightColor || "#19b5fe");
    const language = String(req.body.language || "en");

    // 1) Upload video (multer stored + moved to job dir)
    // 2) Extract audio
    await extractAudio({
      inputVideoPath: sourceVideoPath,
      outputAudioPath: audioPath,
    });

    // 3) Transcribe audio
    // 4) Generate SRT
    await transcribeAudio({
      audioPath,
      srtPath,
      wordsPath,
      language,
    });

    // 5) Burn subtitles
    await burnSubtitles({
      inputVideoPath: sourceVideoPath,
      srtPath,
      wordsPath,
      outputVideoPath,
      fontSize,
      highlightColor,
      fontFamily: getFontFamily(fontChoice),
    });

    // 6) Return finished video
    return res.status(200).json({
      jobId,
      steps: [
        "1. Upload video",
        "2. Extract audio",
        "3. Transcribe audio",
        "4. Generate SRT",
        "5. Burn subtitles",
        "6. Return finished video",
      ],
      subtitlePath: `/api/subtitles/srt/${jobId}`,
      downloadPath: `/api/subtitles/download/${jobId}`,
    });
  } catch (error) {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {
        void 0;
      }
    }

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Subtitle pipeline failed.",
    });
  }
});

router.get("/download/:jobId", async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId);
  if (!jobId) {
    return res.status(400).json({ error: "Invalid job id." });
  }

  const outputVideoPath = path.join(pipelineRoot, jobId, `${jobId}.mp4`);
  try {
    await fs.access(outputVideoPath);
    return res.download(outputVideoPath, `${jobId}.mp4`);
  } catch {
    return res.status(404).json({ error: "Finished video not found." });
  }
});

router.get("/srt/:jobId", async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId);
  if (!jobId) {
    return res.status(400).json({ error: "Invalid job id." });
  }

  const srtPath = path.join(pipelineRoot, jobId, `${jobId}.srt`);
  try {
    await fs.access(srtPath);
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    return res.download(srtPath, `${jobId}.srt`);
  } catch {
    return res.status(404).json({ error: "Subtitle file not found." });
  }
});

module.exports = router;
