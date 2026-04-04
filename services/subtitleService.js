const path = require("node:path");
const { runCommand } = require("../utils/ffmpeg");

function normalizeSubtitleLanguage(value) {
  return String(value || "en").trim().toLowerCase().replace(/_/g, "-") || "en";
}

function getSubtitleModelEnvKeys(language) {
  const parts = normalizeSubtitleLanguage(language)
    .split("-")
    .map((part) => part.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  const keys = [];

  if (parts.length > 1) {
    keys.push(`VOSK_MODEL_PATH_${parts.join("_").toUpperCase()}`);
  }
  if (parts.length > 0) {
    keys.push(`VOSK_MODEL_PATH_${parts[0].toUpperCase()}`);
  }
  keys.push("VOSK_MODEL_PATH");

  return [...new Set(keys)];
}

function resolveSubtitleModelPath(language, explicitModelPath) {
  const directPath = String(explicitModelPath || "").trim();
  if (directPath) {
    return directPath;
  }

  for (const key of getSubtitleModelEnvKeys(language)) {
    const value = String(process.env[key] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function getSubtitleModelConfigError(language) {
  const keys = getSubtitleModelEnvKeys(language)
    .map((key) => `\`${key}\``)
    .join(", ");
  return `Speech-to-text subtitles require a local Vosk model. Set ${keys} to a model folder and restart the server.`;
}

function getConfiguredTranscriptionBackend() {
  const backend = String(process.env.TRANSCRIPTION_BACKEND || "auto")
    .trim()
    .toLowerCase();
  if (backend === "whisper" || backend === "vosk") {
    return backend;
  }
  return "auto";
}

function getWhisperModelName() {
  return String(process.env.WHISPER_MODEL || "small").trim() || "small";
}

function getWhisperComputeType() {
  return String(process.env.WHISPER_COMPUTE_TYPE || "int8").trim() || "int8";
}

function getWhisperDevice() {
  return String(process.env.WHISPER_DEVICE || "auto").trim() || "auto";
}

function isLikelyWhisperRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("faster-whisper") ||
    normalized.includes("no module named") ||
    normalized.includes("ctranslate2") ||
    normalized.includes("whisper transcription requires") ||
    normalized.includes("localentrynotfounderror") ||
    normalized.includes("huggingface_hub") ||
    normalized.includes("snapshot folder") ||
    normalized.includes("connecterror")
  );
}

async function transcribeAudio({ audioPath, srtPath, wordsPath, language = "en", modelPath }) {
  const resolvedLanguage = normalizeSubtitleLanguage(language);
  const backend = getConfiguredTranscriptionBackend();
  const sharedArgs = [
    "--input",
    audioPath,
    "--output",
    srtPath,
    "--language",
    resolvedLanguage,
    ...(wordsPath ? ["--words-output", wordsPath] : []),
  ];

  const runVosk = async () => {
    const resolvedModelPath = resolveSubtitleModelPath(resolvedLanguage, modelPath);
    if (!resolvedModelPath) {
      throw new Error(getSubtitleModelConfigError(resolvedLanguage));
    }

    await runCommand("python3", [
      path.join(process.cwd(), "scripts", "vosk_transcribe.py"),
      ...sharedArgs,
      "--model",
      resolvedModelPath,
    ]);
  };

  const runWhisper = async () => {
    await runCommand("python3", [
      path.join(process.cwd(), "scripts", "whisper_transcribe.py"),
      ...sharedArgs,
      "--model",
      getWhisperModelName(),
      "--device",
      getWhisperDevice(),
      "--compute-type",
      getWhisperComputeType(),
    ]);
  };

  if (backend === "whisper") {
    await runWhisper();
    return;
  }

  if (backend === "vosk") {
    await runVosk();
    return;
  }

  try {
    await runWhisper();
  } catch (error) {
    if (!isLikelyWhisperRuntimeError(error) || !resolveSubtitleModelPath(resolvedLanguage, modelPath)) {
      throw error;
    }
    await runVosk();
  }
}

module.exports = {
  transcribeAudio,
};
