#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import ffmpegPath from "ffmpeg-static";

function parseArgs(argv) {
  const parsed = {
    host: "http://127.0.0.1:3004",
    outVideoPath: "",
    outSubtitlePath: "",
    logoPath: "",
    format: "wide",
    speechText:
      "Testing automatic subtitles from spoken audio. This render validates the no S R T workflow.",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      parsed.host = argv[i + 1] || parsed.host;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      parsed.outVideoPath = argv[i + 1] || parsed.outVideoPath;
      i += 1;
      continue;
    }
    if (arg === "--out-srt") {
      parsed.outSubtitlePath = argv[i + 1] || parsed.outSubtitlePath;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      parsed.format = argv[i + 1] || parsed.format;
      i += 1;
      continue;
    }
    if (arg === "--text") {
      parsed.speechText = argv[i + 1] || parsed.speechText;
      i += 1;
      continue;
    }
    if (!parsed.logoPath) {
      parsed.logoPath = arg;
    }
  }

  parsed.host = parsed.host.replace(/\/+$/, "");
  if (parsed.format !== "short" && parsed.format !== "wide") {
    throw new Error(`Invalid --format value "${parsed.format}". Use "short" or "wide".`);
  }
  return parsed;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safeFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Request failed (${url}): ${reason}`);
  }
}

async function runProcess(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }
  await runProcess(ffmpegPath, args);
}

async function main() {
  const { host, outVideoPath, outSubtitlePath, logoPath, format, speechText } = parseArgs(process.argv);
  if (!logoPath) {
    throw new Error(
      "Usage: npm run test:auto-subtitles -- /path/to/logo.svg [--host http://127.0.0.1:3004] [--out /tmp/e2e.mp4] [--out-srt /tmp/e2e.srt] [--format wide|short] [--text \"Custom speech text\"]",
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "auto-subtitles-e2e-"));
  const speechPath = path.join(tempDir, "speech.aiff");
  const sourcePath = path.join(tempDir, "source.mp4");

  await runProcess("say", ["-o", speechPath, speechText]);
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x111111:s=1280x720:r=30:d=6",
    "-i",
    speechPath,
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    sourcePath,
  ]);

  const [videoBytes, logoBytes] = await Promise.all([readFile(sourcePath), readFile(logoPath)]);
  const body = new FormData();
  body.append("video", new File([videoBytes], "source.mp4", { type: "video/mp4" }));
  body.append("logo", new File([logoBytes], path.basename(logoPath) || "logo.svg", { type: "image/svg+xml" }));
  body.append("generateTrailerIntroOutro", "true");
  body.append("videoFormat", format);
  body.append("fontChoice", "Poppins");
  body.append("soundtrackChoice", "theater-chime");
  body.append("backgroundColor", "#9a9a9a");
  body.append("textColor", "#ffffff");
  body.append("accentColor", "#ffffff");
  body.append("trailerTitle", "");
  body.append("trailerSubtitle", "");
  body.append("trailerOutroTitle", "");
  body.append("trailerOutroSubtitle", "");
  body.append("outroCredits", "");
  body.append("trailerDuration", "3.5");
  body.append("lowerThirdTitle", "");
  body.append("lowerThirdSubtitle", "");
  body.append("lowerThirdStart", "0");
  body.append("lowerThirdDuration", "0");
  body.append("subtitleFontChoice", "Poppins");
  body.append("subtitleFontSize", "48");
  body.append("subtitleTextColor", "#ffffff");
  body.append("subtitleHighlightColor", "#5f7f9a");
  body.append("renderSpeedMode", "turbo");
  body.append("subtitleLanguage", "en");

  const queueResponse = await safeFetch(`${host}/api/render`, {
    method: "POST",
    body,
  });
  const queuePayload = await queueResponse.json();
  if (!queueResponse.ok || !queuePayload?.jobId) {
    throw new Error(`Render queue failed: ${JSON.stringify(queuePayload)}`);
  }

  const jobId = String(queuePayload.jobId);
  process.stdout.write(`Queued job ${jobId}\n`);

  let completed = false;
  let failureMessage = "";
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await wait(1000);
    const statusResponse = await safeFetch(`${host}/api/render/${jobId}`, {
      cache: "no-store",
    });
    if (!statusResponse.ok) {
      continue;
    }

    const statusPayload = await statusResponse.json();
    const status = String(statusPayload?.status || "");
    const progress = Number(statusPayload?.progress || 0);
    const message = String(statusPayload?.message || "");
    process.stdout.write(`status=${status} progress=${progress}% ${message}\n`);

    if (status === "completed") {
      completed = true;
      break;
    }
    if (status === "failed") {
      failureMessage = String(statusPayload?.error || statusPayload?.message || "Render failed.");
      break;
    }
  }

  if (!completed) {
    throw new Error(failureMessage || "Timed out waiting for render completion.");
  }

  const videoResponse = await safeFetch(`${host}/api/download/${jobId}`);
  if (!videoResponse.ok) {
    throw new Error(`Video download failed with status ${videoResponse.status}.`);
  }
  const subtitleResponse = await safeFetch(`${host}/api/subtitles/${jobId}`);
  if (!subtitleResponse.ok) {
    throw new Error(`Subtitle download failed with status ${subtitleResponse.status}.`);
  }

  const finalVideoPath = outVideoPath || path.join(process.cwd(), `auto-subtitles-e2e-${jobId}.mp4`);
  const finalSubtitlePath =
    outSubtitlePath || path.join(process.cwd(), `auto-subtitles-e2e-${jobId}.srt`);
  const [videoBuffer, subtitleText] = await Promise.all([
    videoResponse.arrayBuffer(),
    subtitleResponse.text(),
  ]);

  if (!subtitleText.includes("-->")) {
    throw new Error("Subtitle file did not contain expected SRT timestamp markers.");
  }

  await Promise.all([
    writeFile(finalVideoPath, Buffer.from(videoBuffer)),
    writeFile(finalSubtitlePath, subtitleText, "utf8"),
  ]);

  const [videoStat, subtitleStat] = await Promise.all([
    stat(finalVideoPath),
    stat(finalSubtitlePath),
  ]);
  process.stdout.write(`Saved video ${finalVideoPath} (${videoStat.size} bytes)\n`);
  process.stdout.write(`Saved subtitles ${finalSubtitlePath} (${subtitleStat.size} bytes)\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
