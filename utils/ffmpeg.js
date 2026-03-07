const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobe = require("ffprobe-static");

function runCommand(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function assertBinaries() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary unavailable.");
  }
  if (!ffprobe?.path) {
    throw new Error("ffprobe-static binary unavailable.");
  }
}

function escapeSubtitlesPath(filePath) {
  return filePath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'");
}

function normalizeHexColor(value, fallback = "#19b5fe") {
  const raw = String(value || "").trim();
  const candidate = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : fallback;
}

function hexToAssBgr(value) {
  const hex = normalizeHexColor(value).replace("#", "");
  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);
  return `${bb}${gg}${rr}`;
}

function getSubtitleStyle({ fontSize = 48, highlightColor = "#19b5fe", fontFamily = "Arial" }) {
  const clampedFontSize = Math.max(12, Math.min(120, Number(fontSize) || 48));
  const assHighlight = `&H00${hexToAssBgr(highlightColor)}`;
  return [
    `Fontname=${fontFamily}`,
    `Fontsize=${clampedFontSize}`,
    "PrimaryColour=&H00FFFFFF",
    `SecondaryColour=${assHighlight}`,
    "OutlineColour=&H00000000",
    "BackColour=&H64000000",
    "BorderStyle=1",
    "Outline=2",
    "Shadow=0",
    "Bold=1",
    "Alignment=2",
    "MarginV=38",
  ].join(",");
}

module.exports = {
  ffmpegPath,
  ffprobePath: ffprobe.path,
  runCommand,
  assertBinaries,
  escapeSubtitlesPath,
  hexToAssBgr,
  getSubtitleStyle,
};
