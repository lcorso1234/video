#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import ffmpegPath from "ffmpeg-static";

function parseArgs(argv) {
  const parsed = {
    host: "http://127.0.0.1:3004",
    outPath: "",
    logoPath: "",
    format: "wide",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      parsed.host = argv[i + 1] || parsed.host;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      parsed.outPath = argv[i + 1] || parsed.outPath;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      parsed.format = argv[i + 1] || parsed.format;
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

async function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg exited with code ${code}.`));
    });
  });
}

async function main() {
  const { host, outPath, logoPath, format } = parseArgs(process.argv);
  if (!logoPath) {
    throw new Error(
      "Usage: npm run test:brand -- /absolute/or/relative/path/to/logo.svg [--host http://127.0.0.1:3004] [--out ./brand-test.mp4] [--format wide|short]",
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "brand-test-"));
  const sourcePath = path.join(tempDir, "source.mp4");
  const subtitlePath = path.join(tempDir, "subtitles.srt");

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x111111:s=1280x720:r=30:d=1.6",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    sourcePath,
  ]);

  await writeFile(
    subtitlePath,
    "1\n00:00:00,100 --> 00:00:01,200\nBranding test\n",
    "utf8",
  );

  const [logoBytes, videoBytes, subtitleBytes] = await Promise.all([
    readFile(logoPath),
    readFile(sourcePath),
    readFile(subtitlePath),
  ]);

  const body = new FormData();
  body.append("video", new File([videoBytes], "source.mp4", { type: "video/mp4" }));
  body.append(
    "subtitleFile",
    new File([subtitleBytes], "subtitles.srt", { type: "application/x-subrip" }),
  );
  body.append("logo", new File([logoBytes], path.basename(logoPath) || "logo.svg", { type: "image/svg+xml" }));
  body.append("renderSpeedMode", "turbo");
  body.append("videoFormat", format);
  body.append("generateTrailerIntroOutro", "true");
  body.append("trailerDuration", "3.5");
  body.append("trailerTitle", "");
  body.append("trailerSubtitle", "");
  body.append("trailerOutroTitle", "");
  body.append("trailerOutroSubtitle", "");
  body.append(
    "outroCredits",
    "Executive Producer - Name\nDirector - Name\nEditor - Name\nPresented by - Organization",
  );

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
    await wait(1500);
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

  const downloadResponse = await safeFetch(`${host}/api/download/${jobId}`);
  if (!downloadResponse.ok) {
    throw new Error(`Download failed with status ${downloadResponse.status}.`);
  }

  const output = outPath || path.join(process.cwd(), `brand-test-${jobId}.mp4`);
  const bytes = Buffer.from(await downloadResponse.arrayBuffer());
  await writeFile(output, bytes);

  process.stdout.write(`Saved ${output}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
