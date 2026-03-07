const path = require("node:path");
const { runCommand } = require("../utils/ffmpeg");

async function transcribeAudio({ audioPath, srtPath, wordsPath, language = "en", modelPath }) {
  const resolvedModelPath = String(modelPath || process.env.VOSK_MODEL_PATH || "").trim();
  if (!resolvedModelPath) {
    throw new Error(
      "VOSK_MODEL_PATH is required for speech-to-text transcription.",
    );
  }

  const scriptPath = path.join(process.cwd(), "scripts", "vosk_transcribe.py");
  const args = [
    scriptPath,
    "--input",
    audioPath,
    "--output",
    srtPath,
    "--model",
    resolvedModelPath,
    "--language",
    String(language || "en"),
  ];

  if (wordsPath) {
    args.push("--words-output", wordsPath);
  }

  await runCommand("python3", args);
}

module.exports = {
  transcribeAudio,
};
