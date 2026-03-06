import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

export type RenderVideoInput = {
  sourceVideo: File;
  introVideo?: File | null;
  outroVideo?: File | null;
  brandLogo?: File | null;
  generateTrailerIntroOutro?: boolean;
  trailerTitle?: string;
  trailerSubtitle?: string;
  trailerDuration?: number;
  trailerOutroTitle?: string;
  trailerOutroSubtitle?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontChoice?: string;
  qualityProfile?: "fast" | "balanced" | "high";
  soundtrackChoice?: "startup-chime" | "spirited-blues";
  lowerThirdTitle?: string;
  lowerThirdSubtitle?: string;
  lowerThirdStart?: number;
  lowerThirdDuration?: number;
  subtitlesEnabled?: boolean;
  subtitleFile?: File | null;
  subtitleAutoGenerate?: boolean;
  subtitleFontSize?: number;
  subtitleFontColor?: string;
  subtitleOutlineColor?: string;
  subtitleOutlineWidth?: number;
  subtitleBackgroundColor?: string;
  subtitleBackgroundOpacity?: number;
  subtitleMarginV?: number;
  subtitleShadow?: number;
};

type MediaInfo = {
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

type RenderedVideo = {
  jobId: string;
  outputPath: string;
  filename: string;
  sizeInBytes: number;
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

type SubtitleSettings = {
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  marginV: number;
  shadow: number;
};

type EncodeProfile = {
  key: "fast" | "balanced" | "high";
  preset: string;
  crf: number;
  scaleFlags: string;
  sharpen: boolean;
};

type SoundtrackChoice = "startup-chime" | "spirited-blues";

type WhisperSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type WhisperResponse = {
  text?: string;
  segments?: Array<WhisperSegment>;
};

const jobsRoot = path.join(process.cwd(), ".video-editor-jobs");
const fallbackOutputName = "edited-video.mp4";
const defaultFps = 30;
const fallbackWidth = 1920;
const fallbackHeight = 1080;
const defaultTrailerDuration = 3.5;
const maxTrailerDuration = 12;
const defaultSubtitleFontSize = 40;
const defaultSubtitleOutlineWidth = 2;
const defaultSubtitleBackgroundColor = "#0f172a";
const defaultSubtitleBackgroundOpacity = 28;
const defaultSubtitleMarginV = 95;
const defaultSubtitleShadow = 1;
const defaultSubtitleLanguage = "en";
const defaultTheme: RenderTheme = {
  backgroundColor: "#050816",
  textColor: "#f8fafc",
  accentColor: "#4f80ff",
  fontChoice: "Poppins",
};

const encodeProfiles: Record<"fast" | "balanced" | "high", EncodeProfile> = {
  fast: {
    key: "fast",
    preset: "faster",
    crf: 23,
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

function getExtension(filename: string | undefined, fallback = ".mp4") {
  if (!filename) {
    return fallback;
  }

  const extension = path.extname(filename).trim();
  return extension || fallback;
}

function isSvgFile(file: File) {
  const type = file.type?.toLowerCase() || "";
  const name = file.name?.toLowerCase() || "";
  return type.includes("svg") || name.endsWith(".svg");
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

function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, value));
}

function escapeSubtitlePath(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeSubtitleStyleValue(value: string) {
  return value.replace(/'/g, "\\'").replace(/,/g, "\\,");
}

function toAssColor(value: string, fallback: string, opacityPercent: number) {
  const normalized = normalizeHexColor(value, fallback);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const opacity = Math.round(Math.max(0, Math.min(100, opacityPercent)) * 2.55);
  const alpha = opacity.toString(16).padStart(2, "0");

  return `&H${alpha}${blue.toString(16).padStart(2, "0")}${green.toString(
    16,
  ).padStart(2, "0")}${red.toString(16).padStart(2, "0")}`;
}

function timestampToSrtTime(value: number) {
  const clamped = Math.max(0, value);
  const totalMs = Math.floor(clamped * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function sanitizeSrtText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSrtFromTranscription(segments: Array<WhisperSegment>) {
  const lines: string[] = [];
  const validSegments = segments.filter(
    (segment) =>
      Number.isFinite(segment.start ?? NaN) &&
      Number.isFinite(segment.end ?? NaN) &&
      segment.text &&
      segment.text.trim(),
  );
  validSegments.forEach((segment, index) => {
    const start = Number(segment.start);
    const end = Number(segment.end);
    const text = sanitizeSrtText(segment.text);
    lines.push(String(index + 1));
    lines.push(`${timestampToSrtTime(start)} --> ${timestampToSrtTime(end)}`);
    lines.push(text);
    lines.push("");
  });

  return lines.join("\n");
}

async function extractAudioForTranscription(params: {
  inputPath: string;
  outputPath: string;
}) {
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
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Auto subtitle generation requires OPENAI_API_KEY in the environment.");
  }

  const audioBytes = await readFile(params.audioPath);
  const formData = new FormData();
  formData.append("file", new Blob([audioBytes]), "audio.wav");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("language", params.language);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper transcription failed: ${detail || response.status}`);
  }

  const payload = (await response.json()) as WhisperResponse;
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const srt = buildSrtFromTranscription(segments);
  if (!srt.trim()) {
    throw new Error("No subtitle segments found in transcription result.");
  }

  await writeFile(params.outputPath, `${srt.trim()}\n`);
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

function resolveSoundtrackChoice(
  input: RenderVideoInput["soundtrackChoice"],
): SoundtrackChoice {
  if (input === "startup-chime" || input === "spirited-blues") {
    return input;
  }

  return "spirited-blues";
}

function buildSoundtrackSource(choice: SoundtrackChoice, duration: number) {
  if (choice === "startup-chime") {
    return `aevalsrc=0.62*sin(2*PI*740*t)*exp(-2.4*t)+0.36*sin(2*PI*1080*t)*exp(-3.4*t)+0.15*sin(2*PI*1480*t)*exp(-5.6*t):s=48000:d=${duration}`;
  }

  return `aevalsrc=0.26*sin(2*PI*(146.83+7*sin(2*PI*3.5*t))*t)+0.2*sin(2*PI*(220+9*sin(2*PI*2*t))*t)+0.14*sin(2*PI*(293.66+5*sin(2*PI*5*t))*t)+0.08*sin(2*PI*73.41*t)*abs(sin(2*PI*2*t)):s=48000:d=${duration}`;
}

function buildSoundtrackFilter(
  choice: SoundtrackChoice,
  fadeLength: number,
  fadeOutStart: number,
) {
  if (choice === "startup-chime") {
    return `[1:a]volume=0.42,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength},asplit=2[aud][viz]`;
  }

  return `[1:a]highpass=f=70,lowpass=f=2400,tremolo=f=5:d=0.17,volume=0.6,afade=t=in:st=0:d=${fadeLength},afade=t=out:st=${fadeOutStart}:d=${fadeLength},asplit=2[aud][viz]`;
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

  return {
    width: makeEven(videoStream?.width ?? fallbackWidth, fallbackWidth),
    height: makeEven(videoStream?.height ?? fallbackHeight, fallbackHeight),
    fps: clampFrameRate(parseFraction(videoStream?.r_frame_rate)),
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

  const start = Math.max(0, lowerThird.start);
  const end = start + Math.max(0.5, lowerThird.duration);
  const boxWidth = Math.max(420, Math.round(target.width * 0.42));
  const boxHeight = lowerThird.subtitle
    ? Math.max(120, Math.round(target.height * 0.16))
    : Math.max(76, Math.round(target.height * 0.1));
  const margin = Math.max(42, Math.round(target.width * 0.03));
  const boxX = target.width - boxWidth - margin;
  const boxY = target.height - boxHeight - margin;
  const accentWidth = Math.max(11, Math.round(target.width * 0.008));
  const titleSize = Math.max(24, Math.round(target.height * 0.037));
  const subtitleSize = Math.max(18, Math.round(target.height * 0.026));
  const titleY = boxY + Math.max(20, Math.round(target.height * 0.023));
  const subtitleY = titleY + titleSize + Math.max(5, Math.round(target.height * 0.007));
  const enable = `between(t\\,${start}\\,${end})`;
  const font = fontPath ? `:fontfile='${escapeFilterValue(fontPath)}'` : "";
  const boxColor = `${toFfmpegHex(theme.backgroundColor)}@0.82`;
  const accentColor = `${toFfmpegHex(theme.accentColor)}@0.96`;
  const textColor = isLightColor(theme.textColor)
    ? toFfmpegHex(theme.textColor)
    : "white";
  const subtitleColor = isLightColor(theme.textColor)
    ? `${toFfmpegHex(theme.textColor)}@0.8`
    : "white@0.78";

  filters.push(
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=${boxColor}:t=fill:enable='${enable}'`,
    `drawbox=x=${boxX}:y=${boxY}:w=${accentWidth}:h=${boxHeight}:color=${accentColor}:t=fill:enable='${enable}'`,
  );

  if (lowerThird.title) {
    filters.push(
      `drawtext=text='${escapeFilterValue(lowerThird.title)}'${font}:fontcolor=${textColor}:fontsize=${titleSize}:x=${boxX + accentWidth + 20}:y=${titleY}:enable='${enable}'`,
    );
  }

  if (lowerThird.subtitle) {
    filters.push(
      `drawtext=text='${escapeFilterValue(lowerThird.subtitle)}'${font}:fontcolor=${subtitleColor}:fontsize=${subtitleSize}:x=${boxX + accentWidth + 20}:y=${subtitleY}:enable='${enable}'`,
    );
  }

  return filters.join(",");
}

function buildSubtitleForceStyle(theme: RenderTheme, settings: SubtitleSettings) {
  const fontName = escapeSubtitleStyleValue(theme.fontChoice || "Poppins");

  return [
    `Fontname=${fontName}`,
    `Fontsize=${Math.round(settings.fontSize)}`,
    `PrimaryColour=${toAssColor(settings.fontColor, "#ffffff", 0)}`,
    `Outline=${Math.max(0, Math.round(settings.outlineWidth))}`,
    `OutlineColour=${toAssColor(settings.outlineColor, "#000000", 0)}`,
    `BackColour=${toAssColor(settings.backgroundColor, "#0f172a", settings.backgroundOpacity)}`,
    "BorderStyle=3",
    "Alignment=2",
    `MarginV=${Math.round(settings.marginV)}`,
    `Shadow=${Math.max(0, Math.round(settings.shadow))}`,
    "Bold=1",
  ].join(",");
}

function buildSubtitleFilter(path: string, theme: RenderTheme, settings: SubtitleSettings) {
  const style = buildSubtitleForceStyle(theme, settings);
  const safePath = escapeSubtitlePath(path);
  return `subtitles=filename='${safePath}':force_style='${style}'`;
}

async function applySubtitlesToVideo(params: {
  inputPath: string;
  outputPath: string;
  subtitlePath: string;
  theme: RenderTheme;
  quality: EncodeProfile;
  subtitleSettings: SubtitleSettings;
}) {
  const subtitleFilter = buildSubtitleFilter(
    params.subtitlePath,
    params.theme,
    params.subtitleSettings,
  );

  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-i",
    params.inputPath,
    "-vf",
    subtitleFilter,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    params.quality.preset,
    "-crf",
    params.quality.crf.toString(),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
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
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    params.quality.preset,
    "-crf",
    params.quality.crf.toString(),
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
  theme: RenderTheme;
  quality: EncodeProfile;
  soundtrackChoice: SoundtrackChoice;
  title?: string;
  subtitle?: string;
  duration?: number;
  outro?: boolean;
}) {
  const duration = clampTrailerDuration(params.duration);
  const fadeLength = Math.min(0.55, duration * 0.25);
  const fadeOutStart = Math.max(0, duration - fadeLength);
  const title = escapeFilterValue(
    params.title?.trim() || (params.outro ? "THANK YOU FOR WATCHING" : "COMING UP NEXT"),
  );
  const subtitle = escapeFilterValue(
    params.subtitle?.trim() ||
      (params.outro ? "Stay tuned for the next release" : "A cinematic AI-finished trailer"),
  );
  const titleSize = Math.max(52, Math.round(params.target.height * 0.058));
  const subtitleSize = Math.max(24, Math.round(params.target.height * 0.032));
  const titleY = Math.round(params.target.height * 0.73);
  const subtitleY = Math.round(params.target.height * 0.82);
  const panelX = Math.round(params.target.width * 0.14);
  const panelY = Math.round(params.target.height * 0.64);
  const panelW = Math.round(params.target.width * 0.72);
  const panelH = Math.round(params.target.height * 0.28);
  const baseColor = toFfmpegHex(params.theme.backgroundColor);
  const textColor = toFfmpegHex(params.theme.textColor);
  const accentColor = toFfmpegHex(params.theme.accentColor);
  const font = params.fontPath
    ? `:fontfile='${escapeFilterValue(params.fontPath)}'`
    : "";
  const sparkleColor = params.outro ? "0x9ca3af" : accentColor;
  const accentRailFilter = params.outro
    ? `,drawbox=x=${panelX + 20}:y=${panelY + 20}:w=${Math.max(8, Math.round(params.target.width * 0.007))}:h=${panelH - 40}:color=${accentColor}@0.9:t=fill`
    : "";

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${baseColor}:s=${params.target.width}x${params.target.height}:r=${params.target.fps}:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    buildSoundtrackSource(params.soundtrackChoice, duration),
  ];

  let logoInputIndex: number | null = null;
  if (params.logoPath) {
    logoInputIndex = 2;
    args.push("-loop", "1", "-i", params.logoPath);
  }

  const filters: string[] = [
    buildSoundtrackFilter(params.soundtrackChoice, fadeLength, fadeOutStart),
    `[viz]showwaves=s=${params.target.width}x${params.target.height}:mode=p2p:rate=${params.target.fps}:colors=${sparkleColor}|${accentColor}|0x60a5fa,format=rgba,colorchannelmixer=aa=0.76[waves]`,
    `[0:v][waves]overlay=0:0[base]`,
  ];

  let visualLabel = "[base]";
  if (logoInputIndex !== null) {
    const logoScale = Math.max(200, Math.round(params.target.width * 0.22));
    filters.push(
      `[${logoInputIndex}:v]format=rgba,scale=${logoScale}:-1:force_original_aspect_ratio=decrease,colorchannelmixer=aa=0.95[logo_src]`,
    );
    filters.push("[logo_src]split=3[logo_main_src][logo_r_src][logo_b_src]");
    filters.push("[logo_r_src]colorchannelmixer=rr=1:gg=0:bb=0:aa=0.4[logo_r]");
    filters.push("[logo_b_src]colorchannelmixer=rr=0:gg=0.65:bb=1:aa=0.4[logo_b]");
    const logoY = Math.round(params.target.height * 0.3);
    const glitchWindow = `between(mod(t\\,0.42)\\,0.03\\,0.1)+between(mod(t\\,0.78)\\,0.04\\,0.08)`;
    filters.push(
      `${visualLabel}[logo_main_src]overlay=x='(W-w)/2+2*sin(18*t)':y='${logoY}+1*sin(12*t)':shortest=1[logo_main]`,
    );
    filters.push(
      `[logo_main][logo_r]overlay=x='(W-w)/2+8*(${glitchWindow})':y='${logoY}-1':shortest=1[logo_glitch_r]`,
    );
    filters.push(
      `[logo_glitch_r][logo_b]overlay=x='(W-w)/2-8*(${glitchWindow})':y='${logoY}+1':shortest=1[logoed]`,
    );
    visualLabel = "[logoed]";
  }

  filters.push(
    `${visualLabel}drawbox=x=0:y=0:w=iw:h=ih:color=${baseColor}@0.2:t=fill,drawbox=x=${panelX}:y=${panelY}:w=${panelW}:h=${panelH}:color=${baseColor}@0.48:t=fill${accentRailFilter},drawtext=text='${title}'${font}:fontcolor=${textColor}:fontsize=${titleSize}:x=(w-text_w)/2:y=${titleY},drawtext=text='${subtitle}'${font}:fontcolor=${textColor}@0.8:fontsize=${subtitleSize}:x=(w-text_w)/2:y=${subtitleY},fade=t=in:st=0:d=${fadeLength},fade=t=out:st=${fadeOutStart}:d=${fadeLength}[vout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aud]",
    "-c:v",
    "libx264",
    "-preset",
    params.quality.preset,
    "-crf",
    params.quality.crf.toString(),
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

function buildTargetFromMainVideo(mediaInfo: MediaInfo): NormalizationTarget {
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

export function getDownloadStream(jobId: string) {
  return createReadStream(getJobOutputPath(jobId));
}

export async function getDownloadStat(jobId: string) {
  return await stat(getJobOutputPath(jobId));
}

export async function renderVideo(input: RenderVideoInput): Promise<RenderedVideo> {
  assertBinaries();

  if (!input.sourceVideo || input.sourceVideo.size === 0) {
    throw new Error("A main video file is required.");
  }

  if (input.brandLogo && isSvgFile(input.brandLogo)) {
    throw new Error("SVG logos are not supported yet. Please upload a PNG, JPG, or WebP logo.");
  }

  const jobId = randomUUID();
  const jobDirectory = path.join(jobsRoot, jobId);
  const uploadsDirectory = path.join(jobDirectory, "uploads");
  const workingDirectory = path.join(jobDirectory, "working");

  await ensureDirectory(uploadsDirectory);
  await ensureDirectory(workingDirectory);

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

  if (logoUploadPath && input.brandLogo) {
    await saveFormFile(input.brandLogo, logoUploadPath);
  }
  if (subtitleUploadPath && input.subtitleFile) {
    await saveFormFile(input.subtitleFile, subtitleUploadPath);
  }

  const sourceMedia = await probeMedia(sourceUploadPath);
  const target = buildTargetFromMainVideo(sourceMedia);
  const theme = resolveTheme(input);
  const quality = resolveEncodeProfile(input.qualityProfile);
  const soundtrackChoice = resolveSoundtrackChoice(input.soundtrackChoice);
  const fontPath = await resolveFontPath(theme.fontChoice);

  const normalizedSourcePath = path.join(workingDirectory, "main-normalized.mp4");
  const normalizedIntroPath = path.join(workingDirectory, "intro-normalized.mp4");
  const normalizedOutroPath = path.join(workingDirectory, "outro-normalized.mp4");
  const preparedLogoPath = logoUploadPath
    ? path.join(workingDirectory, "logo-prepared.png")
    : null;
  let hasIntroClip = false;
  let hasOutroClip = false;

  const lowerThird =
    input.lowerThirdTitle?.trim() || input.lowerThirdSubtitle?.trim()
      ? {
          title: input.lowerThirdTitle?.trim(),
          subtitle: input.lowerThirdSubtitle?.trim(),
          start: input.lowerThirdStart ?? 4,
          duration: input.lowerThirdDuration ?? 6,
        }
      : null;

  const subtitleSettings =
    input.subtitlesEnabled && (subtitleUploadPath || input.subtitleAutoGenerate)
      ? {
          fontSize: clampNumber(input.subtitleFontSize, defaultSubtitleFontSize, 18, 110),
          fontColor: normalizeHexColor(input.subtitleFontColor || "", "#ffffff"),
          outlineColor: normalizeHexColor(input.subtitleOutlineColor || "", "#000000"),
          outlineWidth: clampNumber(input.subtitleOutlineWidth, defaultSubtitleOutlineWidth, 0, 8),
          backgroundColor: normalizeHexColor(
            input.subtitleBackgroundColor || "",
            defaultSubtitleBackgroundColor,
          ),
          backgroundOpacity: clampNumber(
            input.subtitleBackgroundOpacity,
            defaultSubtitleBackgroundOpacity,
            0,
            100,
          ),
          marginV: clampNumber(input.subtitleMarginV, defaultSubtitleMarginV, 20, 220),
          shadow: clampNumber(input.subtitleShadow, defaultSubtitleShadow, 0, 8),
        }
      : null;
  let subtitleRenderPath: string | null = subtitleUploadPath;

  await normalizeClip({
    inputPath: sourceUploadPath,
    outputPath: normalizedSourcePath,
    target,
    lowerThird,
    theme,
    quality,
    fontPath,
  });

  if (preparedLogoPath && logoUploadPath) {
    await prepareLogoOverlay({
      inputPath: logoUploadPath,
      outputPath: preparedLogoPath,
      target,
    });
  }

  const generateTrailerIntroOutro = input.generateTrailerIntroOutro ?? true;

  if (generateTrailerIntroOutro) {
    const trailerRawIntroPath = path.join(workingDirectory, "trailer-intro-raw.mp4");
    await createTrailerBrandClip({
      outputPath: trailerRawIntroPath,
      target,
      fontPath,
      logoPath: preparedLogoPath,
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
  }

  if (generateTrailerIntroOutro) {
    const trailerRawOutroPath = path.join(workingDirectory, "trailer-outro-raw.mp4");
    await createTrailerBrandClip({
      outputPath: trailerRawOutroPath,
      target,
      fontPath,
      logoPath: preparedLogoPath,
      theme,
      quality,
      soundtrackChoice,
      title: input.trailerOutroTitle,
      subtitle: input.trailerOutroSubtitle || input.trailerSubtitle,
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
  }

  const clips = [
    hasIntroClip ? normalizedIntroPath : null,
    normalizedSourcePath,
    hasOutroClip ? normalizedOutroPath : null,
  ].filter((value): value is string => Boolean(value));

  const concatListPath = path.join(workingDirectory, "concat.txt");
  const concatList = clips.map((clip) => `file '${escapeConcatPath(clip)}'`).join("\n");
  await writeFile(concatListPath, concatList);

  const outputPath = getJobOutputPath(jobId);
  const stitchedPath = path.join(workingDirectory, "stitched.mp4");
  await runCommand(getFfmpegBinaryPath(), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:v",
    "libx264",
    "-preset",
    quality.preset,
    "-crf",
    quality.crf.toString(),
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
    stitchedPath,
  ]);

  if (input.subtitlesEnabled && !subtitleRenderPath && input.subtitleAutoGenerate) {
    const subtitleAudioPath = path.join(workingDirectory, "subtitle-source.wav");
    const generatedSubtitlePath = path.join(workingDirectory, "auto-subtitles.srt");
    await extractAudioForTranscription({
      inputPath: stitchedPath,
      outputPath: subtitleAudioPath,
    });
    await transcribeAudioToSrt({
      audioPath: subtitleAudioPath,
      outputPath: generatedSubtitlePath,
      language: defaultSubtitleLanguage,
    });
    subtitleRenderPath = generatedSubtitlePath;
  }

  if (input.subtitlesEnabled && !subtitleRenderPath) {
    throw new Error(
      "Subtitles are enabled, but no subtitle file was provided. Upload a .srt, .vtt, or .ass file or enable auto-generation.",
    );
  }

  if (subtitleSettings && subtitleRenderPath) {
    await applySubtitlesToVideo({
      inputPath: stitchedPath,
      outputPath,
      subtitlePath: subtitleRenderPath,
      theme,
      quality,
      subtitleSettings,
    });
  } else {
    await runCommand(getFfmpegBinaryPath(), [
      "-y",
      "-i",
      stitchedPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  }

  const fileStat = await stat(outputPath);

  return {
    jobId,
    outputPath,
    filename: getDownloadFilename(jobId),
    sizeInBytes: fileStat.size,
  };
}
