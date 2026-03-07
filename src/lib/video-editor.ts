import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

export type RenderVideoInput = {
  sourceVideo: File;
  introVideo?: File | null;
  outroVideo?: File | null;
  introMusicFile?: File | null;
  outroMusicFile?: File | null;
  brandLogo?: File | null;
  subtitleFile?: File | null;
  subtitleText?: string;
  generateTrailerIntroOutro?: boolean;
  trailerTitle?: string;
  trailerSubtitle?: string;
  trailerDuration?: number;
  trailerOutroTitle?: string;
  trailerOutroSubtitle?: string;
  outroCredits?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontChoice?: string;
  qualityProfile?: "fast" | "balanced" | "high";
  soundtrackChoice?:
    | "startup-chime"
    | "spirited-blues"
    | "theater-chime"
    | "trailer-braam"
    | "piano-lift";
  videoFormat?: "short" | "wide";
  lowerThirdTitle?: string;
  lowerThirdSubtitle?: string;
  lowerThirdStart?: number;
  lowerThirdDuration?: number;
  subtitleFontChoice?: string;
  subtitleFontSize?: number;
  subtitleHighlightColor?: string;
  subtitlesEnabled?: boolean;
  subtitleLanguage?: string;
};

type RenderJobPhase = "queued" | "running" | "completed" | "failed";

type RenderJobStatusInput = {
  status: RenderJobPhase;
  progress: number;
  message: string;
  filename?: string;
  subtitleFilename?: string;
  sizeInBytes?: number;
  error?: string;
};

export type RenderJobStatus = RenderJobStatusInput & {
  jobId: string;
  updatedAt: string;
};

export type RenderVideoOptions = {
  jobId?: string;
};

type MediaInfo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
};

type RenderedVideo = {
  jobId: string;
  outputPath: string;
  filename: string;
  subtitleFilename?: string;
  sizeInBytes: number;
};

export type SavedRenderArtifacts = {
  destinationFolder: string;
  videoPath: string;
  videoFilename: string;
  subtitlePath?: string;
  subtitleFilename?: string;
};

export type GeneratedSubtitleFile = {
  filename: string;
  content: string;
  language: string;
};

export type RenderDraft = {
  draftId: string;
  sourceFilename: string;
  sourceStoredPath: string;
  subtitleFilename?: string;
  subtitleStoredPath?: string;
  logoFilename?: string;
  logoStoredPath?: string;
  createdAt: string;
  updatedAt: string;
};

type NormalizationTarget = {
  width: number;
  height: number;
  fps: number;
};

type LowerThirdSettings = {
  title?: string;
  subtitle?: string;
  start: number;
  duration: number;
};

type RenderTheme = {
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontChoice?: string;
};

type EncodeProfile = {
  key: "fast" | "balanced" | "high";
  preset: string;
  crf: number;
  scaleFlags: string;
  sharpen: boolean;
};

type SoundtrackChoice =
  | "startup-chime"
  | "spirited-blues"
  | "theater-chime"
  | "trailer-braam"
  | "piano-lift";

const jobsRoot = path.join(process.cwd(), ".video-editor-jobs");
const draftsRoot = path.join(jobsRoot, "drafts");
const subtitleCacheRoot = path.join(jobsRoot, "subtitle-cache");
const fallbackOutputName = "edited-video.mp4";
const defaultFps = 30;
const fallbackWidth = 1920;
const fallbackHeight = 1080;
const defaultSafeExportsRoot = path.join(os.homedir(), "Documents", "Video Editor Exports");
const defaultTrailerDuration = 3.5;
const maxTrailerDuration = 12;
const defaultSubtitleLanguage = "en";
const defaultSubtitleFontSize = 48;
const defaultSubtitleHighlightColor = "#E6FF00";
const statusProgressMax = 100;
const defaultTheme: RenderTheme = {
  backgroundColor: "#050816",
  textColor: "#f8fafc",
  accentColor: "#4f80ff",
  fontChoice: "Poppins",
};

const encodeProfiles: Record<"fast" | "balanced" | "high", EncodeProfile> = {
  fast: {
    key: "fast",
    preset: "veryfast",
    crf: 27,
    scaleFlags: "bilinear",
    sharpen: false,
  },
  balanced: {
    key: "balanced",
    preset: "medium",
    crf: 19,
    scaleFlags: "lanczos",
    sharpen: false,
  },
  high: {
    key: "high",
    preset: "slow",
    crf: 16,
    scaleFlags: "lanczos",
    sharpen: true,
  },
};

const fontCandidates = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Helvetica.ttc",
  "/Library/Fonts/Arial.ttf",
];

const fontCategoryCandidates = {
  sans: [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
  ],
  serif: [
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/System/Library/Fonts/Palatino.ttc",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
  ],
  mono: [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
  ],
  display: [
    "/System/Library/Fonts/Supplemental/Marker Felt.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
  ],
} as const;

const googleFontToCategory: Record<string, keyof typeof fontCategoryCandidates> = {
  Poppins: "sans",
  Montserrat: "sans",
  Roboto: "sans",
  "Open Sans": "sans",
  Lato: "sans",
  Oswald: "sans",
  Raleway: "sans",
  Nunito: "sans",
  "Work Sans": "sans",
  "Source Sans 3": "sans",
  Inter: "sans",
  Ubuntu: "sans",
  "PT Sans": "sans",
  "Josefin Sans": "sans",
  "Bebas Neue": "display",
  "Playfair Display": "serif",
  Merriweather: "serif",
  Lora: "serif",
  "Noto Serif": "serif",
  "Libre Baskerville": "serif",
  "Cormorant Garamond": "serif",
  Arvo: "serif",
  "DM Serif Display": "serif",
  "Abril Fatface": "display",
  "Space Grotesk": "sans",
  "Titillium Web": "sans",
  "Barlow Condensed": "display",
  "Anton": "display",
  "Fira Sans": "sans",
  "Inconsolata": "mono",
};

function assertBinaries() {
  getFfmpegBinaryPath();
  getFfprobeBinaryPath();
}

function getFfmpegBinaryPath(): string {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary is unavailable.");
  }

  return ffmpegPath;
}

function getFfprobeBinaryPath(): string {
  if (!ffprobe.path) {
    throw new Error("FFprobe binary is unavailable.");
  }

  return ffprobe.path;
}

function makeEven(value: number, fallback: number) {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  return safeValue % 2 === 0 ? safeValue : safeValue - 1;
}

function normalizeProgress(value: number) {
  return Math.max(0, Math.min(statusProgressMax, Math.round(Number.isFinite(value) ? value : 0)));
}

function getJobStatusPath(jobId: string) {
  return path.join(jobsRoot, jobId, "status.json");
}

function getJobSubtitlePath(jobId: string) {
  return path.join(jobsRoot, jobId, `${jobId}.srt`);
}

function resolveHomePath(value: string) {
  const trimmedValue = value.trim();
  if (trimmedValue === "~") {
    return os.homedir();
  }

  if (trimmedValue.startsWith("~/")) {
    return path.join(os.homedir(), trimmedValue.slice(2));
  }

  return trimmedValue;
}

function getSafeExportsRoot() {
  const configuredPath = process.env.VIDEO_SAFE_EXPORTS_PATH?.trim();
  if (!configuredPath) {
    return defaultSafeExportsRoot;
  }

  return resolveHomePath(configuredPath);
}

function getDraftDirectory(draftId: string) {
  return path.join(draftsRoot, draftId);
}

function getDraftStatePath(draftId: string) {
  return path.join(getDraftDirectory(draftId), "draft.json");
}

async function writeRenderDraft(draft: RenderDraft) {
  await ensureDirectory(getDraftDirectory(draft.draftId));
  await writeFile(getDraftStatePath(draft.draftId), `${JSON.stringify(draft)}\n`);
}

export async function getRenderDraft(draftId: string) {
  try {
    const content = await readFile(getDraftStatePath(draftId), "utf8");
    return JSON.parse(content) as RenderDraft;
  } catch {
    return null;
  }
}

async function fileFromDisk(filePath: string, name: string, type: string) {
  const bytes = await readFile(filePath);
  return new File([bytes], name, { type });
}

export async function createRenderDraftFromStepOne(input: {
  sourceVideo: File;
  subtitleContent: string;
  subtitleFilename: string;
}) {
  const draftId = randomUUID();
  const directory = getDraftDirectory(draftId);
  const sourceStoredPath = path.join(
    directory,
    `source${getExtension(input.sourceVideo.name, ".mp4")}`,
  );
  const subtitleStoredPath = path.join(directory, "subtitles.srt");
  const createdAt = new Date().toISOString();

  await ensureDirectory(directory);
  await saveFormFile(input.sourceVideo, sourceStoredPath);
  await writeFile(subtitleStoredPath, input.subtitleContent, "utf8");

  const draft: RenderDraft = {
    draftId,
    sourceFilename: input.sourceVideo.name || "source.mp4",
    sourceStoredPath,
    subtitleFilename: input.subtitleFilename || "subtitles.srt",
    subtitleStoredPath,
    createdAt,
    updatedAt: createdAt,
  };

  await writeRenderDraft(draft);
  return draft;
}

export async function updateRenderDraftAssets(
  draftId: string,
  input: { subtitleFile?: File | null; logoFile?: File | null },
) {
  const draft = await getRenderDraft(draftId);
  if (!draft) {
    throw new Error("Draft not found.");
  }

  const directory = getDraftDirectory(draftId);
  await ensureDirectory(directory);
  let nextDraft: RenderDraft = { ...draft };

  if (input.subtitleFile?.size) {
    const subtitleStoredPath = path.join(
      directory,
      `subtitles${getExtension(input.subtitleFile.name, ".srt")}`,
    );
    await saveFormFile(input.subtitleFile, subtitleStoredPath);
    nextDraft = {
      ...nextDraft,
      subtitleFilename: input.subtitleFile.name || "subtitles.srt",
      subtitleStoredPath,
    };
  }

  if (input.logoFile?.size) {
    const logoStoredPath = path.join(
      directory,
      `logo${getExtension(input.logoFile.name, ".png")}`,
    );
    await saveFormFile(input.logoFile, logoStoredPath);
    nextDraft = {
      ...nextDraft,
      logoFilename: input.logoFile.name || "logo.png",
      logoStoredPath,
    };
  }

  nextDraft.updatedAt = new Date().toISOString();
  await writeRenderDraft(nextDraft);
  return nextDraft;
}

export async function resolveRenderInputFromDraft(draftId: string) {
  const draft = await getRenderDraft(draftId);
  if (!draft) {
    return null;
  }

  const sourceVideo = await fileFromDisk(
    draft.sourceStoredPath,
    draft.sourceFilename,
    "video/mp4",
  );

  let subtitleFile: File | null = null;
  if (draft.subtitleStoredPath) {
    try {
      subtitleFile = await fileFromDisk(
        draft.subtitleStoredPath,
        draft.subtitleFilename || "subtitles.srt",
        "application/x-subrip; charset=utf-8",
      );
    } catch {
      subtitleFile = null;
    }
  }

  let logoFile: File | null = null;
  if (draft.logoStoredPath) {
    try {
      logoFile = await fileFromDisk(
        draft.logoStoredPath,
        draft.logoFilename || "logo.png",
        "image/png",
      );
    } catch {
      logoFile = null;
    }
  }

  return {
    draft,
    sourceVideo,
    subtitleFile,
    logoFile,
  };
}

export async function getRenderJobStatus(jobId: string) {
  try {
    const content = await readFile(getJobStatusPath(jobId), "utf8");
    return JSON.parse(content) as RenderJobStatus;
  } catch {
    return null;
  }
}

async function writeRenderJobStatus(
  jobId: string,
  payload: RenderJobStatusInput & { jobId?: string },
) {
  const status: RenderJobStatus = {
    jobId: payload.jobId ?? jobId,
    status: payload.status,
    progress: normalizeProgress(payload.progress),
    message: payload.message,
    filename: payload.filename,
    subtitleFilename: payload.subtitleFilename,
    sizeInBytes: payload.sizeInBytes,
    error: payload.error,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(getJobStatusPath(jobId), `${JSON.stringify(status)}\n`);
}

function parseFraction(value?: string) {
  if (!value) {
    return defaultFps;
  }

  const [numerator, denominator] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return defaultFps;
  }

  return top / bottom;
}

function clampFrameRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return defaultFps;
  }

  return Math.min(60, Math.max(24, Math.round(value)));
}

function parseDurationSeconds(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseSrtTimestampToMs(value: string) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(milliseconds)
  ) {
    return null;
  }

  return (
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000 +
    milliseconds
  );
}

function formatMsToSrtTimestamp(totalMs: number) {
  const clamped = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(clamped / 3600000);
  const minutes = Math.floor((clamped % 3600000) / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const milliseconds = clamped % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function shiftSrtByOffset(content: string, offsetMs: number) {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) {
    return content;
  }

  return content.replace(
    /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})(.*)$/gm,
    (_full, startText: string, endText: string, suffix: string) => {
      const startMs = parseSrtTimestampToMs(startText);
      const endMs = parseSrtTimestampToMs(endText);

      if (startMs === null || endMs === null) {
        return `${startText} --> ${endText}${suffix}`;
      }

      const nextStart = formatMsToSrtTimestamp(startMs + offsetMs);
      const nextEnd = formatMsToSrtTimestamp(endMs + offsetMs);
      return `${nextStart} --> ${nextEnd}${suffix}`;
    },
  );
}

function removeSrtSegmentsInRanges(
  content: string,
  ranges: Array<{ startSeconds: number; endSeconds: number }>,
) {
  if (!ranges.length) {
    return content;
  }

  const sanitizedRanges = ranges
    .map((range) => ({
      startMs: Math.max(0, Math.round(range.startSeconds * 1000)),
      endMs: Math.max(0, Math.round(range.endSeconds * 1000)),
    }))
    .filter((range) => range.endMs > range.startMs);

  if (!sanitizedRanges.length) {
    return content;
  }

  const blocks = content.split(/\r?\n\r?\n/);
  const kept: string[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
    if (!lines.length) {
      continue;
    }

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) {
      kept.push(block);
      continue;
    }

    const match = /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/.exec(
      lines[timeLineIndex],
    );
    if (!match) {
      kept.push(block);
      continue;
    }

    const startMs = parseSrtTimestampToMs(match[1]);
    const endMs = parseSrtTimestampToMs(match[2]);
    if (startMs === null || endMs === null) {
      kept.push(block);
      continue;
    }

    const overlapsHiddenRange = sanitizedRanges.some(
      (range) => startMs < range.endMs && endMs > range.startMs,
    );
    if (!overlapsHiddenRange) {
      kept.push(block);
    }
  }

  if (!kept.length) {
    return "";
  }

  return `${kept.join("\n\n").trim()}\n`;
}

function formatSubtitleChunkWords(words: string[]) {
  if (words.length <= 5) {
    return words.join(" ");
  }

  const splitAt = Math.ceil(words.length / 2);
  return `${words.slice(0, splitAt).join(" ")}\n${words.slice(splitAt).join(" ")}`;
}

function normalizeSrtForBurn(content: string) {
  const blocks = content
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const rewritten: string[] = [];
  let nextIndex = 1;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) {
      continue;
    }

    const match = /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/.exec(
      lines[timeLineIndex],
    );
    if (!match) {
      continue;
    }

    const startMs = parseSrtTimestampToMs(match[1]);
    const endMs = parseSrtTimestampToMs(match[2]);
    if (startMs === null || endMs === null) {
      continue;
    }

    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      continue;
    }

    const words = text.split(" ").filter(Boolean);
    const maxWordsPerChunk = 8;
    const chunkCount = Math.max(1, Math.ceil(words.length / maxWordsPerChunk));
    const durationMs = Math.max(300, endMs - startMs);

    for (let i = 0; i < chunkCount; i += 1) {
      const chunkWords = words.slice(i * maxWordsPerChunk, (i + 1) * maxWordsPerChunk);
      if (!chunkWords.length) {
        continue;
      }

      const chunkStart = startMs + Math.floor((durationMs * i) / chunkCount);
      let chunkEnd =
        i === chunkCount - 1
          ? endMs
          : startMs + Math.floor((durationMs * (i + 1)) / chunkCount);
      if (chunkEnd <= chunkStart + 80) {
        chunkEnd = Math.min(endMs, chunkStart + Math.max(120, Math.floor(durationMs / chunkCount)));
      }

      rewritten.push(
        `${nextIndex}\n${formatMsToSrtTimestamp(chunkStart)} --> ${formatMsToSrtTimestamp(chunkEnd)}\n${formatSubtitleChunkWords(chunkWords)}`,
      );
      nextIndex += 1;
    }
  }

  if (!rewritten.length) {
    return content;
  }

  return `${rewritten.join("\n\n").trim()}\n`;
}

function formatAssTime(seconds: number) {
  const totalCentiseconds = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centis = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    centis,
  ).padStart(2, "0")}`;
}

function escapeAssText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function normalizeWordsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("words" in payload)) {
    return [];
  }
  const wordsRaw = (payload as { words?: unknown }).words;
  if (!Array.isArray(wordsRaw)) {
    return [];
  }

  return wordsRaw
    .filter((word) => word && typeof word === "object")
    .map((word) => {
      const token = String((word as { word?: unknown }).word || "").trim();
      const start = Number((word as { start?: unknown }).start);
      const end = Number((word as { end?: unknown }).end);
      return {
        word: token,
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : start + 0.08,
      };
    })
    .filter((word) => word.word.length > 0)
    .sort((a, b) => a.start - b.start)
    .map((word) => ({
      word: word.word,
      start: Math.max(0, word.start),
      end: Math.max(word.start + 0.05, word.end),
    }));
}

function groupWordsForSingleLineKaraoke(words: Array<{ word: string; start: number; end: number }>) {
  const groups: Array<{
    words: Array<{ word: string; start: number; end: number }>;
    start: number;
    end: number;
  }> = [];
  let current: Array<{ word: string; start: number; end: number }> = [];

  const flush = () => {
    if (!current.length) {
      return;
    }
    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    if (!current.length) {
      current.push(word);
      continue;
    }

    const previous = current[current.length - 1];
    const gap = Math.max(0, word.start - previous.end);
    const elapsed = word.end - current[0].start;
    const punctuationBreak = /[.!?]$/.test(previous.word);
    const maxWords = current.length >= 5;
    const maxDuration = elapsed > 3.2;
    const hardGap = gap > 0.75;

    if (punctuationBreak || maxWords || maxDuration || hardGap) {
      flush();
    }

    current.push(word);
  }

  flush();
  return groups;
}

function buildAssKaraokeText(
  lineWords: Array<{ word: string; start: number; end: number }>,
  activeIndex: number,
) {
  return lineWords
    .map((word, index) => {
      const token = escapeAssText(word.word);
      if (index !== activeIndex) {
        return token;
      }
      return `{\\rHighlight}${token}{\\rDefault}`;
    })
    .join(" ");
}

function buildAssFromTimedWords(input: {
  words: Array<{ word: string; start: number; end: number }>;
  fontFamily: string;
  fontSize: number;
  highlightColor: string;
  hideRanges: Array<{ startSeconds: number; endSeconds: number }>;
}) {
  const hiddenRanges = input.hideRanges
    .map((range) => ({
      start: Math.max(0, Number(range.startSeconds) || 0),
      end: Math.max(0, Number(range.endSeconds) || 0),
    }))
    .filter((range) => range.end > range.start);

  const visibleWords = input.words.filter((word) => {
    return !hiddenRanges.some((range) => word.start < range.end && word.end > range.start);
  });
  const grouped = groupWordsForSingleLineKaraoke(visibleWords);
  if (!grouped.length) {
    return "";
  }

  const safeFontSize = Math.max(12, Math.min(72, Number(input.fontSize) || defaultSubtitleFontSize));
  const highlightBgr = toAssBgrHex(input.highlightColor || defaultSubtitleHighlightColor);
  const fontName = (input.fontFamily || "Arial").replace(/,/g, " ").replace(/'/g, "");
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${fontName},${safeFontSize},&H00FFFFFF,&H00${highlightBgr},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,1.8,0,2,26,26,36,1`,
    `Style: Highlight,${fontName},${safeFontSize},&H00000000,&H00${highlightBgr},&H00000000,&H00${highlightBgr},-1,0,0,0,100,100,0,0,3,0,0,2,26,26,36,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const events: string[] = [];
  for (const group of grouped) {
    for (let i = 0; i < group.words.length; i += 1) {
      const current = group.words[i];
      const next = group.words[i + 1];
      const start = current.start;
      const end = Math.max(start + 0.06, Math.min(group.end, next ? next.start : current.end));
      const text = buildAssKaraokeText(group.words, i);
      events.push(
        `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`,
      );
    }
  }

  return `${header.join("\n")}\n${events.join("\n")}\n`;
}

function toAssBgrHex(value: string) {
  const clean = value.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return "FFFFFF";
  }
  const red = clean.slice(0, 2);
  const green = clean.slice(2, 4);
  const blue = clean.slice(4, 6);
  return `${blue}${green}${red}`.toUpperCase();
}

function escapeSubtitlesFilterPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function buildSubtitleForceStyle(input: RenderVideoInput) {
  const fontName = (input.subtitleFontChoice || "Arial")
    .replace(/,/g, " ")
    .replace(/'/g, "");
  const fontSize = Math.max(
    12,
    Math.min(72, Number(input.subtitleFontSize) || defaultSubtitleFontSize),
  );
  const highlightBgr = toAssBgrHex(input.subtitleHighlightColor || defaultSubtitleHighlightColor);
  return [
    `Fontname=${fontName}`,
    `Fontsize=${fontSize}`,
    "PrimaryColour=&H00FFFFFF",
    `SecondaryColour=&H00${highlightBgr}`,
    "OutlineColour=&H00000000",
    "BackColour=&H00000000",
    "BorderStyle=1",
    "Outline=2.2",
    "Shadow=0",
    "Alignment=2",
    "MarginV=36",
  ].join(",");
}

function getExtension(filename: string | undefined, fallback = ".mp4") {
  if (!filename) {
    return fallback;
  }

  const extension = path.extname(filename).trim();
  return extension || fallback;
}

function escapeFilterValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function escapeConcatPath(value: string) {
  return value.replace(/'/g, "'\\''");
}

async function extractAudioFromConcatList(params: {
  concatListPath: string;
  outputPath: string;
}) {
  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    params.concatListPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    params.outputPath,
  ]);
}

async function extractAudioFromVideo(params: { inputPath: string; outputPath: string }) {
  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-i",
    params.inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    params.outputPath,
  ]);
}

async function transcribeAudioToSrt(params: {
  audioPath: string;
  outputPath: string;
  language: string;
  wordsOutputPath?: string;
}) {
  const modelPath = process.env.VOSK_MODEL_PATH?.trim();
  if (!modelPath) {
    throw new Error(
      "Speech recognition requires VOSK_MODEL_PATH to point at a local Vosk model directory.",
    );
  }
  const scriptPath = path.join(process.cwd(), "scripts", "vosk_transcribe.py");
  await runCommand("python3", [
    scriptPath,
    "--input",
    params.audioPath,
    "--output",
    params.outputPath,
    "--model",
    modelPath,
    "--language",
    params.language,
    ...(params.wordsOutputPath ? ["--words-output", params.wordsOutputPath] : []),
  ]);

  const generatedSrt = await readFile(params.outputPath, "utf8");
  if (!generatedSrt.trim()) {
    throw new Error("Speech recognition returned no subtitle segments.");
  }
}

function clampTrailerDuration(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return defaultTrailerDuration;
  }

  return Math.max(1.2, Math.min(maxTrailerDuration, Number(value)));
}

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true });
}

function normalizeHexColor(value: string | undefined, fallback: string) {
  const clean = (value || "").trim();
  const candidate = clean.startsWith("#") ? clean : `#${clean}`;
  const isHex = /^#[0-9a-fA-F]{6}$/.test(candidate);
  return (isHex ? candidate : fallback).toLowerCase();
}

function toFfmpegHex(value: string) {
  return `0x${value.replace("#", "")}`;
}

function isLightColor(value: string) {
  const hex = value.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.72;
}

function resolveTheme(input: RenderVideoInput): RenderTheme {
  return {
    backgroundColor: normalizeHexColor(input.backgroundColor, defaultTheme.backgroundColor),
    textColor: normalizeHexColor(input.textColor, defaultTheme.textColor),
    accentColor: normalizeHexColor(input.accentColor, defaultTheme.accentColor),
    fontChoice: input.fontChoice || defaultTheme.fontChoice,
  };
}

function resolveEncodeProfile(
  input: RenderVideoInput["qualityProfile"],
): EncodeProfile {
  if (input === "fast" || input === "balanced" || input === "high") {
    return encodeProfiles[input];
  }

  return encodeProfiles.high;
}

function buildVideoEncoderArgs(quality: EncodeProfile): string[] {
  if (quality.key === "fast") {
    return [
      "-c:v",
      "h264_videotoolbox",
      "-allow_sw",
      "1",
      "-b:v",
      "6M",
      "-maxrate",
      "8M",
      "-bufsize",
      "12M",
    ];
  }

  if (quality.key === "balanced") {
    return [
      "-c:v",
      "h264_videotoolbox",
      "-allow_sw",
      "1",
      "-b:v",
      "8M",
      "-maxrate",
      "12M",
      "-bufsize",
      "16M",
    ];
  }

  return [
    "-c:v",
    "libx264",
    "-preset",
    quality.preset,
    "-crf",
    quality.crf.toString(),
    "-threads",
    "0",
  ];
}

function resolveSoundtrackChoice(
  input: RenderVideoInput["soundtrackChoice"],
): SoundtrackChoice {
  if (
    input === "startup-chime" ||
    input === "spirited-blues" ||
    input === "theater-chime" ||
    input === "trailer-braam" ||
    input === "piano-lift"
  ) {
    return input;
  }

  return "theater-chime";
}

function buildSoundtrackSource(choice: SoundtrackChoice, duration: number) {
  if (choice === "startup-chime") {
    return `aevalsrc=0.62*sin(2*PI*740*t)*exp(-2.4*t)+0.36*sin(2*PI*1080*t)*exp(-3.4*t)+0.15*sin(2*PI*1480*t)*exp(-5.6*t):s=48000:d=${duration}`;
  }

  if (choice === "theater-chime") {
    return `aevalsrc=0.54*sin(2*PI*220*t)*exp(-1.4*t)+0.36*sin(2*PI*440*t)*exp(-1.7*t)+0.22*sin(2*PI*880*t)*exp(-2.2*t)+0.12*sin(2*PI*1320*t)*exp(-2.8*t):s=48000:d=${duration}`;
  }

  if (choice === "trailer-braam") {
    return `aevalsrc=0.45*sin(2*PI*58*t)+0.32*sin(2*PI*87*t)+0.2*sin(2*PI*116*t)+0.07*sin(2*PI*30*t):s=48000:d=${duration}`;
  }

  if (choice === "piano-lift") {
    return `aevalsrc=0.22*sin(2*PI*(261.63+3*sin(2*PI*1.6*t))*t)+0.2*sin(2*PI*(329.63+2.5*sin(2*PI*1.3*t))*t)+0.16*sin(2*PI*(392+2*sin(2*PI*1.1*t))*t)+0.12*sin(2*PI*(523.25+1.7*sin(2*PI*0.9*t))*t):s=48000:d=${duration}`;
  }

  return `aevalsrc=0.26*sin(2*PI*(146.83+7*sin(2*PI*3.5*t))*t)+0.2*sin(2*PI*(220+9*sin(2*PI*2*t))*t)+0.14*sin(2*PI*(293.66+5*sin(2*PI*5*t))*t)+0.08*sin(2*PI*73.41*t)*abs(sin(2*PI*2*t)):s=48000:d=${duration}`;
}

function buildSoundtrackFilter(
  choice: SoundtrackChoice,
  fadeLength: number,
  fadeOutStart: number,
) {
  if (choice === "startup-chime") {
    return `[1:a]volume=0.42,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
  }

  if (choice === "theater-chime") {
    return `[1:a]highpass=f=120,lowpass=f=9000,aecho=0.75:0.85:35:0.25,volume=0.54,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
  }

  if (choice === "trailer-braam") {
    return `[1:a]highpass=f=35,lowpass=f=3500,acompressor=threshold=-20dB:ratio=3:attack=12:release=260,volume=0.7,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
  }

  if (choice === "piano-lift") {
    return `[1:a]highpass=f=90,lowpass=f=5200,volume=0.58,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
  }

  return `[1:a]highpass=f=70,lowpass=f=2400,tremolo=f=5:d=0.17,volume=0.6,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
}

function buildUploadedSoundtrackFilter(duration: number, fadeLength: number, fadeOutStart: number) {
  return `[1:a]atrim=0:${duration},asetpts=N/SR/TB,highpass=f=60,lowpass=f=14000,volume=0.72,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength}[aud]`;
}

async function resolveFontPath(fontChoice?: string) {
  const category =
    googleFontToCategory[fontChoice || ""] || googleFontToCategory[defaultTheme.fontChoice || "Poppins"] || "sans";
  const candidates = fontCategoryCandidates[category];

  for (const fontPath of candidates) {
    try {
      await access(fontPath);
      return fontPath;
    } catch {
      continue;
    }
  }

  for (const fontPath of fontCandidates) {
    try {
      await access(fontPath);
      return fontPath;
    } catch {
      continue;
    }
  }

  return null;
}

async function saveFormFile(file: File, outputPath: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, bytes);
}

function isSvgPath(filePath: string) {
  return filePath.toLowerCase().endsWith(".svg");
}

async function rasterizeSvgLogoToPng(params: {
  inputPath: string;
  outputPath: string;
  target: NormalizationTarget;
}) {
  const rasterSize = Math.max(
    1200,
    Math.round(Math.max(params.target.width, params.target.height) * 0.42),
  );

  try {
    await runCommand("sips", [
      "-s",
      "format",
      "png",
      "-Z",
      String(rasterSize),
      params.inputPath,
      "--out",
      params.outputPath,
    ]);
    return;
  } catch {
    const quicklookOutputPath = path.join(
      path.dirname(params.outputPath),
      `${path.basename(params.inputPath)}.png`,
    );

    await runCommand("qlmanage", [
      "-t",
      "-s",
      String(rasterSize),
      "-o",
      path.dirname(params.outputPath),
      params.inputPath,
    ]);
    await access(quicklookOutputPath);
    await rename(quicklookOutputPath, params.outputPath);
  }
}

async function runCommand(binary: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Command failed with exit code ${code}.`));
    });
  });
}

async function runJsonCommand(binary: string, args: string[]) {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function probeMedia(filePath: string): Promise<MediaInfo> {
  const raw = await runJsonCommand(getFfprobeBinaryPath(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);

  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const videoStream = streams.find((stream) => {
    return (
      typeof stream === "object" &&
      stream !== null &&
      "codec_type" in stream &&
      stream.codec_type === "video"
    );
  }) as
    | {
        width?: number;
        height?: number;
        r_frame_rate?: string;
      }
    | undefined;

  const hasAudio = streams.some((stream) => {
    return (
      typeof stream === "object" &&
      stream !== null &&
      "codec_type" in stream &&
      stream.codec_type === "audio"
    );
  });

  const formatInfo =
    typeof raw.format === "object" && raw.format !== null
      ? (raw.format as { duration?: string | number })
      : {};

  return {
    width: makeEven(videoStream?.width ?? fallbackWidth, fallbackWidth),
    height: makeEven(videoStream?.height ?? fallbackHeight, fallbackHeight),
    fps: clampFrameRate(parseFraction(videoStream?.r_frame_rate)),
    duration: parseDurationSeconds(formatInfo.duration),
    hasAudio,
  };
}

function buildVideoFilter(
  target: NormalizationTarget,
  lowerThird: LowerThirdSettings | null,
  theme: RenderTheme,
  quality: EncodeProfile,
  fontPath: string | null,
) {
  const filters = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease:flags=${quality.scaleFlags}`,
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=0x09090b`,
    `fps=${target.fps}`,
  ];

  if (quality.sharpen) {
    filters.push("unsharp=5:5:0.65:3:3:0.0");
  }

  filters.push("setsar=1");

  if (!lowerThird || (!lowerThird.title && !lowerThird.subtitle)) {
    return filters.join(",");
  }

  const titleText = lowerThird.title?.trim() || "";
  const subtitleText = lowerThird.subtitle?.trim() || "";
  const start = Math.max(0, lowerThird.start);
  const end = start + Math.max(0.5, lowerThird.duration);
  const accentWidth = Math.max(11, Math.round(target.width * 0.008));
  const horizontalPadding = Math.max(16, Math.round(target.width * 0.01));
  const verticalPadding = Math.max(12, Math.round(target.height * 0.012));
  const lineGap = Math.max(4, Math.round(target.height * 0.005));
  const borderWidth = Math.max(2, Math.round(target.width * 0.0016));
  const shadowOffset = Math.max(4, Math.round(target.width * 0.003));
  const titleSize = Math.max(24, Math.round(target.height * 0.037));
  const subtitleSize = Math.max(18, Math.round(target.height * 0.026));
  const approxTitleWidth = Math.max(
    Math.round(target.width * 0.14),
    Math.round(titleText.length * titleSize * 0.56),
  );
  const approxSubtitleWidth = subtitleText.length
    ? Math.round(subtitleText.length * subtitleSize * 0.54)
    : 0;
  const estimatedTextWidth = Math.max(approxTitleWidth, approxSubtitleWidth);
  const boxWidth = Math.max(
    Math.round(target.width * 0.24),
    Math.min(
      Math.round(target.width * 0.58),
      Math.round(estimatedTextWidth + accentWidth + horizontalPadding * 2 + 8),
    ),
  );
  const contentHeight = subtitleText
    ? titleSize + subtitleSize + lineGap
    : titleSize;
  const boxHeight = Math.max(
    subtitleText ? Math.round(target.height * 0.09) : Math.round(target.height * 0.065),
    contentHeight + verticalPadding * 2,
  );
  const margin = Math.max(22, Math.round(target.width * 0.018));
  const boxX = target.width - boxWidth - margin;
  const boxY = target.height - boxHeight - margin;
  const titleY = boxY + verticalPadding;
  const subtitleY = titleY + titleSize + lineGap;
  const slideDuration = Math.max(0.25, Math.min(0.7, (end - start) * 0.2));
  const offscreenX = target.width + Math.max(26, Math.round(target.width * 0.018));
  const slideProgress = `((t-${start})/${slideDuration})`;
  const animatedBoxX = `if(lt(t\\,${start + slideDuration})\\,${offscreenX}+(${boxX - offscreenX})*${slideProgress}\\,${boxX})`;
  const textXPadding = Math.max(14, Math.round(target.width * 0.0085));
  const titleTargetX = boxX + accentWidth + textXPadding;
  const subtitleTargetX = boxX + accentWidth + textXPadding;
  const titleStartX = offscreenX + accentWidth + textXPadding;
  const subtitleStartX = offscreenX + accentWidth + textXPadding;
  const animatedTitleX = `if(lt(t\\,${start + slideDuration})\\,${titleStartX}+(${titleTargetX - titleStartX})*${slideProgress}\\,${titleTargetX})`;
  const animatedSubtitleX = `if(lt(t\\,${start + slideDuration})\\,${subtitleStartX}+(${subtitleTargetX - subtitleStartX})*${slideProgress}\\,${subtitleTargetX})`;
  const enable = `between(t\\,${start}\\,${end})`;
  const font = fontPath ? `:fontfile='${escapeFilterValue(fontPath)}'` : "";
  const boxColor = `${toFfmpegHex(theme.backgroundColor)}@0.82`;
  const boxBorderColor = `${toFfmpegHex(theme.accentColor)}@0.5`;
  const boxShadowColor = "0x000000@0.35";
  const accentColor = `${toFfmpegHex(theme.accentColor)}@0.96`;
  const textColor = isLightColor(theme.textColor)
    ? toFfmpegHex(theme.textColor)
    : "white";
  const subtitleColor = isLightColor(theme.textColor)
    ? `${toFfmpegHex(theme.textColor)}@0.8`
    : "white@0.78";

  filters.push(
    `drawbox=x=${animatedBoxX}+${shadowOffset}:y=${boxY + shadowOffset}:w=${boxWidth}:h=${boxHeight}:color=${boxShadowColor}:t=fill:enable='${enable}'`,
    `drawbox=x=${animatedBoxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=${boxColor}:t=fill:enable='${enable}'`,
    `drawbox=x=${animatedBoxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=${boxBorderColor}:t=${borderWidth}:enable='${enable}'`,
    `drawbox=x=${animatedBoxX}:y=${boxY}:w=${accentWidth}:h=${boxHeight}:color=${accentColor}:t=fill:enable='${enable}'`,
  );

  if (lowerThird.title) {
    filters.push(
      `drawtext=text='${escapeFilterValue(lowerThird.title)}'${font}:fontcolor=${textColor}:fontsize=${titleSize}:shadowcolor=black@0.45:shadowx=2:shadowy=2:x=${animatedTitleX}:y=${titleY}:enable='${enable}'`,
    );
  }

  if (lowerThird.subtitle) {
    filters.push(
      `drawtext=text='${escapeFilterValue(lowerThird.subtitle)}'${font}:fontcolor=${subtitleColor}:fontsize=${subtitleSize}:shadowcolor=black@0.35:shadowx=1:shadowy=1:x=${animatedSubtitleX}:y=${subtitleY}:enable='${enable}'`,
    );
  }

  return filters.join(",");
}

async function concatenateClipsDirect(params: { concatListPath: string; outputPath: string }) {
  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    params.concatListPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    params.outputPath,
  ]);
}

async function normalizeClip(params: {
  inputPath: string;
  outputPath: string;
  target: NormalizationTarget;
  lowerThird?: LowerThirdSettings | null;
  subtitlePath?: string | null;
  subtitleForceStyle?: string;
  theme: RenderTheme;
  quality: EncodeProfile;
  fontPath: string | null;
}) {
  const mediaInfo = await probeMedia(params.inputPath);
  const videoFilter = buildVideoFilter(
    params.target,
    params.lowerThird ?? null,
    params.theme,
    params.quality,
    params.fontPath,
  );

  const subtitleFilter = params.subtitlePath
    ? `,subtitles=${escapeSubtitlesFilterPath(params.subtitlePath)}${
        params.subtitlePath.toLowerCase().endsWith(".ass")
          ? ""
          : params.subtitleForceStyle
            ? `:force_style='${params.subtitleForceStyle}'`
            : ""
      }`
    : "";
  const args = mediaInfo.hasAudio
    ? ["-y", "-i", params.inputPath]
    : [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-i",
        params.inputPath,
      ];

  if (mediaInfo.hasAudio) {
    args.push("-map", "0:v:0", "-map", "0:a:0?");
  } else {
    args.push("-map", "1:v:0", "-map", "0:a:0", "-shortest");
  }

  args.push(
    "-vf",
    `${videoFilter}${subtitleFilter}`,
    ...buildVideoEncoderArgs(params.quality),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    params.outputPath,
  );

  await runCommand(getFfmpegBinaryPath(), args);
}

async function prepareLogoOverlay(params: {
  inputPath: string;
  outputPath: string;
  target: NormalizationTarget;
}) {
  const maxLogoWidth = Math.max(240, Math.round(params.target.width * 0.26));

  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-i",
    params.inputPath,
    "-vf",
    `scale=${maxLogoWidth}:-1:force_original_aspect_ratio=decrease,format=rgba`,
    "-frames:v",
    "1",
    params.outputPath,
  ]);
}

async function createTrailerBrandClip(params: {
  outputPath: string;
  target: NormalizationTarget;
  fontPath: string | null;
  logoPath?: string | null;
  soundtrackPath?: string | null;
  theme: RenderTheme;
  quality: EncodeProfile;
  soundtrackChoice: SoundtrackChoice;
  title?: string;
  subtitle?: string;
  creditsText?: string;
  duration?: number;
  outro?: boolean;
}) {
  const duration = clampTrailerDuration(params.duration);
  const fadeLength = Math.min(0.55, duration * 0.25);
  const fadeOutStart = Math.max(0, duration - fadeLength);
  const introTitle = params.title?.trim() || "COMING UP NEXT";
  const introSubtitle = params.subtitle?.trim() || "A cinematic AI-finished trailer";
  const outroTitle = params.title?.trim() || "THANK YOU FOR WATCHING";
  const outroSubtitle = params.subtitle?.trim() || "Stay tuned for the next release";
  const logoFadeDuration = Math.min(1.35, Math.max(0.8, duration * 0.45));
  const contentFadeDuration = Math.min(1.1, Math.max(0.6, duration * 0.32));
  const contentAlphaExpr = `if(lt(t\\,${contentFadeDuration})\\,t/${contentFadeDuration}\\,1)`;
  const baseColor = "0x000000";
  const textColor = toFfmpegHex(params.theme.textColor);
  const font = params.fontPath
    ? `:fontfile='${escapeFilterValue(params.fontPath)}'`
    : "";
  const introTitleSize = Math.max(46, Math.round(params.target.height * 0.066));
  const introSubtitleSize = Math.max(24, Math.round(params.target.height * 0.036));

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${baseColor}:s=${params.target.width}x${params.target.height}:r=${params.target.fps}:d=${duration}`,
  ];
  if (params.soundtrackPath) {
    args.push("-stream_loop", "-1", "-i", params.soundtrackPath);
  } else {
    args.push("-f", "lavfi", "-i", buildSoundtrackSource(params.soundtrackChoice, duration));
  }

  let logoInputIndex: number | null = null;
  if (params.logoPath) {
    logoInputIndex = 2;
    args.push("-loop", "1", "-i", params.logoPath);
  }

  const filters: string[] = [
    params.soundtrackPath
      ? buildUploadedSoundtrackFilter(duration, fadeLength, fadeOutStart)
      : buildSoundtrackFilter(params.soundtrackChoice, fadeLength, fadeOutStart),
  ];

  let visualLabel = "[0:v]";
  if (logoInputIndex !== null) {
    const logoScale = Math.max(
      200,
      Math.round(params.target.width * (params.outro ? 0.14 : 0.18)),
    );
    filters.push(
      `[${logoInputIndex}:v]format=rgba,scale=${logoScale}:-1:force_original_aspect_ratio=decrease,fade=t=in:st=0:d=${logoFadeDuration}:alpha=1,colorchannelmixer=aa=1[logo]`,
    );
  }

  if (!params.outro) {
    if (logoInputIndex !== null) {
      filters.push(`${visualLabel}[logo]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1[vstage]`);
      visualLabel = "[vstage]";
    } else {
      const introTitleEscaped = escapeFilterValue(introTitle);
      const introSubtitleEscaped = escapeFilterValue(introSubtitle);
      filters.push(
        `${visualLabel}drawtext=text='${introTitleEscaped}'${font}:fontcolor=${textColor}:fontsize=${introTitleSize}:x=(w-text_w)/2:y=h*0.44:alpha='${contentAlphaExpr}',drawtext=text='${introSubtitleEscaped}'${font}:fontcolor=${textColor}@0.85:fontsize=${introSubtitleSize}:x=(w-text_w)/2:y=h*0.56:alpha='${contentAlphaExpr}'[vstage]`,
      );
      visualLabel = "[vstage]";
    }
  } else {
    if (logoInputIndex !== null) {
      const outroLogoY = Math.round(params.target.height * 0.12);
      filters.push(
        `${visualLabel}[logo]overlay=x='(W-w)/2':y='${outroLogoY}':shortest=1[vstage-logo]`,
      );
      visualLabel = "[vstage-logo]";
    }

    const outroLines: string[] = [];
    const extraCredits = (params.creditsText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    outroLines.push(...extraCredits);
    if (outroLines.length === 0) {
      if (outroTitle.trim()) {
        outroLines.push(outroTitle.trim());
      }
      if (outroSubtitle.trim()) {
        outroLines.push(outroSubtitle.trim());
      }
      if (outroLines.length === 0) {
        outroLines.push("NAME - TITLE");
      }
    }

    const creditsFontSize = Math.max(22, Math.round(params.target.height * 0.058));
    const lineHeight = Math.max(creditsFontSize + 8, Math.round(creditsFontSize * 1.42));
    const creditsStartY = Math.round(params.target.height * 0.43);

    let currentLabel = visualLabel;
    for (let i = 0; i < outroLines.length; i += 1) {
      const nextLabel = i === outroLines.length - 1 ? "[vstage]" : `[vstage-credits-${i}]`;
      const escapedLine = escapeFilterValue(outroLines[i]);
      const lineY = creditsStartY + i * lineHeight;
      filters.push(
        `${currentLabel}drawtext=text='${escapedLine}'${font}:fontcolor=${textColor}@0.95:fontsize=${creditsFontSize}:x=(w-text_w)/2:y=${lineY}:alpha='${contentAlphaExpr}'${i === 0 ? ":borderw=2:bordercolor=black@0.52:shadowcolor=black@0.35:shadowx=2:shadowy=2" : ""}${nextLabel}`,
      );
      currentLabel = nextLabel;
    }
    visualLabel = "[vstage]";
  }

  filters.push(
    `${visualLabel}drawbox=x=0:y=0:w=iw:h=ih:color=${baseColor}@0.2:t=fill,fade=t=in:st=0:d=${fadeLength},fade=t=out:st=${fadeOutStart}:d=${fadeLength}[vout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aud]",
    ...buildVideoEncoderArgs(params.quality),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    params.outputPath,
  );

  await runCommand(getFfmpegBinaryPath(), args);
}

function buildTargetFromMainVideo(
  mediaInfo: MediaInfo,
  outputFormat?: RenderVideoInput["videoFormat"],
): NormalizationTarget {
  if (outputFormat === "short") {
    return {
      width: 1080,
      height: 1920,
      fps: clampFrameRate(mediaInfo.fps),
    };
  }

  if (outputFormat === "wide") {
    return {
      width: 1920,
      height: 1080,
      fps: clampFrameRate(mediaInfo.fps),
    };
  }

  return {
    width: makeEven(mediaInfo.width, fallbackWidth),
    height: makeEven(mediaInfo.height, fallbackHeight),
    fps: clampFrameRate(mediaInfo.fps),
  };
}

export function getJobOutputPath(jobId: string) {
  return path.join(jobsRoot, jobId, fallbackOutputName);
}

export function getDownloadFilename(jobId: string) {
  return `${jobId}.mp4`;
}

export function getSubtitleFilename(jobId: string) {
  return `${jobId}.srt`;
}

export function getDownloadStream(jobId: string) {
  return createReadStream(getJobOutputPath(jobId));
}

export async function getDownloadStat(jobId: string) {
  return await stat(getJobOutputPath(jobId));
}

export function getSubtitleStream(jobId: string) {
  return createReadStream(getJobSubtitlePath(jobId));
}

export async function getSubtitleStat(jobId: string) {
  return await stat(getJobSubtitlePath(jobId));
}

export async function saveRenderArtifactsToSafeFolder(
  jobId: string,
): Promise<SavedRenderArtifacts> {
  const safeExportsRoot = getSafeExportsRoot();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destinationFolder = path.join(safeExportsRoot, `${timestamp}-${jobId}`);
  const sourceVideoPath = getJobOutputPath(jobId);
  const destinationVideoPath = path.join(destinationFolder, getDownloadFilename(jobId));
  const sourceSubtitlePath = getJobSubtitlePath(jobId);
  const destinationSubtitlePath = path.join(destinationFolder, getSubtitleFilename(jobId));

  await ensureDirectory(safeExportsRoot);
  await ensureDirectory(destinationFolder);
  await copyFile(sourceVideoPath, destinationVideoPath);

  let subtitlePath: string | undefined;
  let subtitleFilename: string | undefined;
  try {
    await access(sourceSubtitlePath);
    await copyFile(sourceSubtitlePath, destinationSubtitlePath);
    subtitlePath = destinationSubtitlePath;
    subtitleFilename = getSubtitleFilename(jobId);
  } catch {
    subtitlePath = undefined;
    subtitleFilename = undefined;
  }

  return {
    destinationFolder,
    videoPath: destinationVideoPath,
    videoFilename: getDownloadFilename(jobId),
    subtitlePath,
    subtitleFilename,
  };
}

export async function generateSubtitlesFromSourceVideo(input: {
  sourceVideo: File;
  subtitleLanguage?: string;
}): Promise<GeneratedSubtitleFile> {
  assertBinaries();

  if (!input.sourceVideo || input.sourceVideo.size === 0) {
    throw new Error("A main video file is required to generate subtitles.");
  }

  const language = (input.subtitleLanguage || defaultSubtitleLanguage).trim() || defaultSubtitleLanguage;
  const tempId = randomUUID();
  const tempDirectory = path.join(jobsRoot, "subtitle-only", tempId);
  const sourceUploadPath = path.join(
    tempDirectory,
    `source${getExtension(input.sourceVideo.name)}`,
  );
  const extractedAudioPath = path.join(tempDirectory, "speech.wav");
  const subtitlePath = path.join(tempDirectory, `${tempId}.srt`);
  const sourceName = path.parse(input.sourceVideo.name || "subtitles").name || "subtitles";
  const subtitleFilename = `${sourceName}.srt`;

  await ensureDirectory(tempDirectory);

  try {
    await saveFormFile(input.sourceVideo, sourceUploadPath);
    await runCommand(getFfmpegBinaryPath(), [
      "-y",
      "-i",
      sourceUploadPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      "-f",
      "wav",
      extractedAudioPath,
    ]);
    await transcribeAudioToSrt({
      audioPath: extractedAudioPath,
      outputPath: subtitlePath,
      language,
    });
    const content = await readFile(subtitlePath, "utf8");
    return {
      filename: subtitleFilename,
      content,
      language,
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function renderVideo(
  input: RenderVideoInput,
  options: RenderVideoOptions = {},
): Promise<RenderedVideo> {
  assertBinaries();

  const jobId = options.jobId ?? randomUUID();
  const reportProgress = (status: RenderJobPhase, progress: number, message: string) => {
    writeRenderJobStatus(jobId, {
      status,
      progress,
      message,
    }).catch(() => {
      void 0;
    });
  };

  if (!input.sourceVideo || input.sourceVideo.size === 0) {
    reportProgress("failed", 0, "A main video file is required.");
    throw new Error("A main video file is required.");
  }

  const jobDirectory = path.join(jobsRoot, jobId);
  const uploadsDirectory = path.join(jobDirectory, "uploads");
  const workingDirectory = path.join(jobDirectory, "working");
  const outputPath = getJobOutputPath(jobId);

  reportProgress("queued", 2, "Render job queued.");

  await ensureDirectory(jobDirectory);
  await ensureDirectory(uploadsDirectory);
  await ensureDirectory(workingDirectory);
  await writeRenderJobStatus(jobId, {
    status: "queued",
    progress: 2,
    message: "Render job queued.",
  });

  try {
    const sourceUploadPath = path.join(
      uploadsDirectory,
      `source${getExtension(input.sourceVideo.name)}`,
    );

    await saveFormFile(input.sourceVideo, sourceUploadPath);

    const introUploadPath = input.introVideo?.size
      ? path.join(uploadsDirectory, `intro${getExtension(input.introVideo.name)}`)
      : null;
    const outroUploadPath = input.outroVideo?.size
      ? path.join(uploadsDirectory, `outro${getExtension(input.outroVideo.name)}`)
      : null;
    const introMusicUploadPath = input.introMusicFile?.size
      ? path.join(
          uploadsDirectory,
          `intro-music${getExtension(input.introMusicFile.name, ".mp3")}`,
        )
      : null;
    const outroMusicUploadPath = input.outroMusicFile?.size
      ? path.join(
          uploadsDirectory,
          `outro-music${getExtension(input.outroMusicFile.name, ".mp3")}`,
        )
      : null;
    const logoUploadPath = input.brandLogo?.size
      ? path.join(uploadsDirectory, `logo${getExtension(input.brandLogo.name, ".png")}`)
      : null;
    const subtitleUploadPath = input.subtitleFile?.size
      ? path.join(uploadsDirectory, `subtitles${getExtension(input.subtitleFile.name, ".srt")}`)
      : null;

    if (introUploadPath && input.introVideo) {
      await saveFormFile(input.introVideo, introUploadPath);
    }

    if (outroUploadPath && input.outroVideo) {
      await saveFormFile(input.outroVideo, outroUploadPath);
    }
    if (introMusicUploadPath && input.introMusicFile) {
      await saveFormFile(input.introMusicFile, introMusicUploadPath);
    }
    if (outroMusicUploadPath && input.outroMusicFile) {
      await saveFormFile(input.outroMusicFile, outroMusicUploadPath);
    }

    if (logoUploadPath && input.brandLogo) {
      await saveFormFile(input.brandLogo, logoUploadPath);
    }
    if (subtitleUploadPath && input.subtitleFile) {
      await saveFormFile(input.subtitleFile, subtitleUploadPath);
    }

    reportProgress("running", 10, "Uploaded source and optional assets.");
    const shouldGenerateTrailerIntroOutro = input.generateTrailerIntroOutro ?? true;
    const subtitlesEnabled = input.subtitlesEnabled ?? true;
    const wantsLowerThird =
      Boolean(input.lowerThirdTitle?.trim()) || Boolean(input.lowerThirdSubtitle?.trim());
    const useFastPassThrough =
      input.qualityProfile === "fast" &&
      !shouldGenerateTrailerIntroOutro &&
      !input.introVideo?.size &&
      !input.outroVideo?.size &&
      !input.introMusicFile?.size &&
      !input.outroMusicFile?.size &&
      !input.brandLogo?.size &&
      !subtitlesEnabled &&
      !wantsLowerThird;

    if (useFastPassThrough) {
      try {
        reportProgress("running", 18, "Applying fast pass-through render path.");
        await runCommand(getFfmpegBinaryPath(), [
          "-y",
          "-i",
          sourceUploadPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-c:v",
          "copy",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          outputPath,
        ]);

        const fileStat = await stat(outputPath);
        await writeRenderJobStatus(jobId, {
          status: "completed",
          progress: 100,
          message: "Fast render complete. Download is ready.",
          filename: getDownloadFilename(jobId),
          sizeInBytes: fileStat.size,
        });

        return {
          jobId,
          outputPath,
          filename: getDownloadFilename(jobId),
          sizeInBytes: fileStat.size,
        };
      } catch (error) {
        reportProgress(
          "running",
          22,
          "Fast pass-through not possible for this source. Falling back to normal render.",
        );
        void error;
      }
    }

    const sourceMedia = await probeMedia(sourceUploadPath);
    const target = buildTargetFromMainVideo(sourceMedia, input.videoFormat);
    const theme = resolveTheme(input);
    const quality = resolveEncodeProfile(input.qualityProfile);
    const soundtrackChoice = resolveSoundtrackChoice(input.soundtrackChoice);
    const fontPath = await resolveFontPath(theme.fontChoice);
    reportProgress("running", 17, "Analyzed source video and resolved render settings.");

    const normalizedSourcePath = path.join(workingDirectory, "main-normalized.mp4");
    const normalizedIntroPath = path.join(workingDirectory, "intro-normalized.mp4");
    const normalizedOutroPath = path.join(workingDirectory, "outro-normalized.mp4");
    const subtitleSourcePath = path.join(workingDirectory, "subtitles-source.srt");
    const preparedLogoPath = logoUploadPath
      ? path.join(workingDirectory, "logo-prepared.png")
      : null;
    let logoRasterInputPath: string | null = logoUploadPath;
    let hasIntroClip = false;
    let hasOutroClip = false;
    let subtitleOffsetSeconds = 0;
    let subtitleBurnPath: string | null = null;
    let subtitleWordsPath: string | null = null;
    let subtitleFilename: string | undefined;

    const lowerThird =
      input.lowerThirdTitle?.trim() || input.lowerThirdSubtitle?.trim()
        ? {
            title: input.lowerThirdTitle?.trim(),
            subtitle: input.lowerThirdSubtitle?.trim(),
            start: input.lowerThirdStart ?? 4,
            duration: input.lowerThirdDuration ?? 6,
          }
        : null;
    const lowerThirdHideRanges = lowerThird
      ? [
          {
            startSeconds: lowerThird.start,
            endSeconds: lowerThird.start + lowerThird.duration,
          },
        ]
      : [];

    if (subtitlesEnabled) {
      const subtitleLanguage =
        (input.subtitleLanguage || defaultSubtitleLanguage).trim() ||
        defaultSubtitleLanguage;
      const subtitleAudioPath = path.join(workingDirectory, "subtitle-source.wav");
      const generatedSubtitlePath = path.join(workingDirectory, "auto-subtitles.srt");
      const generatedWordsPath = path.join(workingDirectory, "auto-subtitles.words.json");

      if (subtitleUploadPath) {
        const uploadedSubtitleRaw = await readFile(subtitleUploadPath, "utf8");
        const filteredSubtitle = removeSrtSegmentsInRanges(
          uploadedSubtitleRaw,
          lowerThirdHideRanges,
        );
        const normalizedSubtitle = normalizeSrtForBurn(
          filteredSubtitle || uploadedSubtitleRaw,
        );
        await writeFile(subtitleSourcePath, normalizedSubtitle || uploadedSubtitleRaw, "utf8");
        reportProgress("running", 24, "Loaded uploaded subtitle file.");
      } else {
        await ensureDirectory(subtitleCacheRoot);
        const subtitleCacheKey = createHash("sha1")
          .update(
            `${input.sourceVideo.name}|${input.sourceVideo.size}|${input.sourceVideo.lastModified}|${subtitleLanguage}`,
          )
          .digest("hex");
        const cachedSubtitlePath = path.join(subtitleCacheRoot, `${subtitleCacheKey}.srt`);
        let rawSubtitle = "";

        try {
          rawSubtitle = await readFile(cachedSubtitlePath, "utf8");
          reportProgress("running", 23, "Loaded cached speech-to-text subtitles.");
        } catch {
          reportProgress("running", 22, "Extracting audio for speech recognition.");
          await extractAudioFromVideo({
            inputPath: sourceUploadPath,
            outputPath: subtitleAudioPath,
          });
          reportProgress("running", 26, "Transcribing speech to subtitles.");
          await transcribeAudioToSrt({
            audioPath: subtitleAudioPath,
            outputPath: generatedSubtitlePath,
            language: subtitleLanguage,
            wordsOutputPath: generatedWordsPath,
          });
          rawSubtitle = await readFile(generatedSubtitlePath, "utf8");
          await writeFile(cachedSubtitlePath, rawSubtitle, "utf8");
        }

        const filteredSubtitle = removeSrtSegmentsInRanges(rawSubtitle, lowerThirdHideRanges);
        const normalizedSubtitle = normalizeSrtForBurn(filteredSubtitle || rawSubtitle);
        await writeFile(subtitleSourcePath, normalizedSubtitle || rawSubtitle, "utf8");
        try {
          await access(generatedWordsPath);
          subtitleWordsPath = generatedWordsPath;
        } catch {
          subtitleWordsPath = null;
        }
        reportProgress("running", 29, "Prepared speech-to-text subtitles.");
      }

      subtitleBurnPath = subtitleSourcePath;
      subtitleFilename = getSubtitleFilename(jobId);
    }

    if (subtitleBurnPath && subtitleWordsPath) {
      try {
        const wordsRaw = await readFile(subtitleWordsPath, "utf8");
        const parsedWords = JSON.parse(wordsRaw) as unknown;
        const normalizedWords = normalizeWordsPayload(parsedWords);
        const karaokeAss = buildAssFromTimedWords({
          words: normalizedWords,
          fontFamily: input.subtitleFontChoice || "Arial",
          fontSize: Number(input.subtitleFontSize) || defaultSubtitleFontSize,
          highlightColor: input.subtitleHighlightColor || defaultSubtitleHighlightColor,
          hideRanges: lowerThirdHideRanges,
        });
        if (karaokeAss.trim()) {
          const assPath = path.join(workingDirectory, "subtitles-karaoke.ass");
          await writeFile(assPath, karaokeAss, "utf8");
          subtitleBurnPath = assPath;
          reportProgress("running", 31, "Prepared karaoke subtitle styling.");
        }
      } catch {
        void 0;
      }
    }

    await normalizeClip({
      inputPath: sourceUploadPath,
      outputPath: normalizedSourcePath,
      target,
      lowerThird,
      subtitlePath: subtitleBurnPath,
      subtitleForceStyle: buildSubtitleForceStyle(input),
      theme,
      quality,
      fontPath,
    });
    reportProgress("running", 30, "Normalized main source clip.");

    if (logoUploadPath && isSvgPath(logoUploadPath)) {
      const rasterizedLogoPath = path.join(workingDirectory, "logo-rasterized.png");
      await rasterizeSvgLogoToPng({
        inputPath: logoUploadPath,
        outputPath: rasterizedLogoPath,
        target,
      });
      logoRasterInputPath = rasterizedLogoPath;
      reportProgress("running", 33, "Converted SVG logo for compositing.");
    }

    if (preparedLogoPath && logoRasterInputPath) {
      await prepareLogoOverlay({
        inputPath: logoRasterInputPath,
        outputPath: preparedLogoPath,
        target,
      });
      reportProgress("running", 35, "Prepared logo overlay.");
    }

    if (shouldGenerateTrailerIntroOutro) {
      const trailerRawIntroPath = path.join(workingDirectory, "trailer-intro-raw.mp4");
      await createTrailerBrandClip({
        outputPath: trailerRawIntroPath,
        target,
        fontPath,
        logoPath: preparedLogoPath,
        soundtrackPath: introMusicUploadPath,
        theme,
        quality,
        soundtrackChoice,
        title: input.trailerTitle,
        subtitle: input.trailerSubtitle,
        duration: input.trailerDuration,
      });
      await normalizeClip({
        inputPath: trailerRawIntroPath,
        outputPath: normalizedIntroPath,
        target,
        theme,
        quality,
        fontPath,
      });
      hasIntroClip = true;
      subtitleOffsetSeconds = clampTrailerDuration(input.trailerDuration);
      reportProgress("running", 38, "Generated intro clip.");
    } else if (introUploadPath) {
      await normalizeClip({
        inputPath: introUploadPath,
        outputPath: normalizedIntroPath,
        target,
        theme,
        quality,
        fontPath,
      });
      hasIntroClip = true;
      subtitleOffsetSeconds = (await probeMedia(normalizedIntroPath)).duration;
      reportProgress("running", 38, "Prepared uploaded intro clip.");
    }

    if (shouldGenerateTrailerIntroOutro) {
      const trailerRawOutroPath = path.join(workingDirectory, "trailer-outro-raw.mp4");
      await createTrailerBrandClip({
        outputPath: trailerRawOutroPath,
        target,
        fontPath,
        logoPath: preparedLogoPath,
        soundtrackPath: outroMusicUploadPath,
        theme,
        quality,
        soundtrackChoice,
        title: input.trailerOutroTitle,
        subtitle: input.trailerOutroSubtitle || input.trailerSubtitle,
        creditsText: input.outroCredits,
        duration: Math.max(1.5, (input.trailerDuration ?? defaultTrailerDuration) - 0.2),
        outro: true,
      });
      await normalizeClip({
        inputPath: trailerRawOutroPath,
        outputPath: normalizedOutroPath,
        target,
        theme,
        quality,
        fontPath,
      });
      hasOutroClip = true;
      reportProgress("running", 45, "Generated outro clip.");
    } else if (outroUploadPath) {
      await normalizeClip({
        inputPath: outroUploadPath,
        outputPath: normalizedOutroPath,
        target,
        theme,
        quality,
        fontPath,
      });
      hasOutroClip = true;
      reportProgress("running", 45, "Prepared uploaded outro clip.");
    }

    const clips = [
      hasIntroClip ? normalizedIntroPath : null,
      normalizedSourcePath,
      hasOutroClip ? normalizedOutroPath : null,
    ].filter((value): value is string => Boolean(value));

    const concatListPath = path.join(workingDirectory, "concat.txt");
    const concatList = clips.map((clip) => `file '${escapeConcatPath(clip)}'`).join("\n");
    await writeFile(concatListPath, concatList);
    reportProgress("running", 50, "Built timeline and concat list.");

    if (subtitlesEnabled && subtitleFilename) {
      const subtitleOutputPath = getJobSubtitlePath(jobId);
      const sourceSubtitle = await readFile(subtitleSourcePath, "utf8");
      const timelineSubtitle =
        subtitleOffsetSeconds > 0.01
          ? shiftSrtByOffset(sourceSubtitle, Math.round(subtitleOffsetSeconds * 1000))
          : sourceSubtitle;
      await writeFile(subtitleOutputPath, timelineSubtitle, "utf8");
      reportProgress("running", 72, "Prepared subtitle track.");
    }

    reportProgress("running", 82, "Concatenating clips.");
    await concatenateClipsDirect({
      concatListPath,
      outputPath,
    });

    reportProgress("running", 90, "Finalizing output file.");
    const fileStat = await stat(outputPath);

    await writeRenderJobStatus(jobId, {
      status: "completed",
      progress: 100,
      message: "Render complete. Download is ready.",
      filename: getDownloadFilename(jobId),
      subtitleFilename,
      sizeInBytes: fileStat.size,
    });

    return {
      jobId,
      outputPath,
      filename: getDownloadFilename(jobId),
      subtitleFilename,
      sizeInBytes: fileStat.size,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video rendering failed unexpectedly.";
    await writeRenderJobStatus(jobId, {
      status: "failed",
      progress: 0,
      message: `Render failed: ${message}`,
      error: message,
    });
    throw error;
  }
}
