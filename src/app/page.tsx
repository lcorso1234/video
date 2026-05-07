"use client";

/* eslint-disable @next/next/no-img-element */

import { type FormEvent, useEffect, useRef, useState } from "react";
import { isLikelyVideoFile, VIDEO_UPLOAD_ACCEPT_ATTR } from "@/lib/media-file";

const isElectron = typeof window !== "undefined" && !!window.electronAPI;
const isMac = isElectron && window.electronAPI.platform === "darwin";

function TitleBar() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isElectron) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 h-10 z-[100] flex items-center justify-center pointer-events-none select-none"
      style={{ WebkitAppRegion: "drag" } as any}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-medium pt-1">
        Video Editor Pro
      </div>
    </div>
  );
}

type RenderJobPhase = "queued" | "running" | "completed" | "failed";

type RenderStatusResponse = {
  jobId: string;
  status: RenderJobPhase;
  progress: number;
  message: string;
  filename?: string;
  sizeInBytes?: number;
  error?: string;
};

type RenderResponse = {
  jobId: string;
  filename: string;
  downloadUrl: string;
  previewUrl?: string;
  sizeInBytes: number;
};

type AppPhase = 1 | 2 | 3;

type RenderStartPayload = (RenderResponse &
  RenderStatusResponse & {
    error?: string;
  }) | { error?: string; message?: string };

const INTRO_OUTRO_BACKGROUND = "#6f7b86";
const DEFAULT_LOWER_THIRD_COMPANY = "Company Name";
const DEFAULT_LOWER_THIRD_PERSON = "Name of Person";
const DEFAULT_LOWER_THIRD_START_SECONDS = 3;
const DEFAULT_LOWER_THIRD_DURATION_SECONDS = 6;
const ACCEPTED_LOGO_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ACCEPTED_LOGO_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
]);
const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"];
const AUDIO_UPLOAD_ACCEPT_ATTR = `audio/*,${ACCEPTED_AUDIO_EXTENSIONS.join(",")}`;

function hasAcceptedLogoExtension(filename: string) {
  const lower = filename.toLowerCase();
  return ACCEPTED_LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isSvgLogoFile(file: File) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function isAcceptedLogoFile(file: File) {
  return ACCEPTED_LOGO_TYPES.has(file.type) || hasAcceptedLogoExtension(file.name);
}

function hasAcceptedAudioExtension(filename: string) {
  const lower = filename.toLowerCase();
  return ACCEPTED_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isAcceptedAudioFile(file: File) {
  const lowerType = file.type.toLowerCase();
  return (
    lowerType.startsWith("audio/") ||
    ACCEPTED_AUDIO_TYPES.has(lowerType) ||
    hasAcceptedAudioExtension(file.name)
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode image."));
    };
    image.src = objectUrl;
  });
}

async function extractRasterPalette(file: File) {
  const image = await loadImageElement(file);
  const sampleWidth = Math.max(1, Math.min(96, image.naturalWidth || image.width || 96));
  const sampleHeight = Math.max(1, Math.min(96, image.naturalHeight || image.height || 96));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const counts = new Map<string, number>();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) {
      continue;
    }

    const red = Math.round(data[index] / 16) * 16;
    const green = Math.round(data[index + 1] / 16) * 16;
    const blue = Math.round(data[index + 2] / 16) * 16;
    const hex = rgbToHex(red, green, blue);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([hex]) => hex)
    .slice(0, 8);
}

async function convertRasterLogoToSvg(file: File) {
  const image = await loadImageElement(file);
  const width = Math.max(1, image.naturalWidth || image.width || 512);
  const height = Math.max(1, image.naturalHeight || image.height || 512);
  const rasterPalette = await extractRasterPalette(file);
  const paletteNote =
    rasterPalette.length > 0 ? `\n  <desc>palette:${rasterPalette.join(",")}</desc>` : "";
  const dataUrl = await readFileAsDataUrl(file);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paletteNote}
  <image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
</svg>`;
  const baseName = stripFileExtension(file.name || "logo");
  return new File([svgMarkup], `${baseName || "logo"}.svg`, { type: "image/svg+xml" });
}

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed.slice(0, 6).toLowerCase()}`;
  }
  return null;
}

function parseRgbChannel(value: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function extractSvgPalette(svgText: string) {
  const collected = new Set<string>();
  const addColor = (color: string | null) => {
    if (!color) {
      return;
    }
    collected.add(color);
  };

  const hexMatches = svgText.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) || [];
  for (const match of hexMatches) {
    addColor(normalizeHexColor(match));
  }

  const rgbRegex = /rgba?\(([^)]+)\)/gi;
  let rgbMatch = rgbRegex.exec(svgText);
  while (rgbMatch) {
    const channels = rgbMatch[1].split(",").slice(0, 3);
    if (channels.length === 3) {
      const red = parseRgbChannel(channels[0]);
      const green = parseRgbChannel(channels[1]);
      const blue = parseRgbChannel(channels[2]);
      if (red !== null && green !== null && blue !== null) {
        addColor(rgbToHex(red, green, blue));
      }
    }
    rgbMatch = rgbRegex.exec(svgText);
  }

  return Array.from(collected).slice(0, 8);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureMp4Filename(value: string) {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, "-");
  if (!trimmed) {
    return "final-video.mp4";
  }
  return trimmed.toLowerCase().endsWith(".mp4") ? trimmed : `${trimmed}.mp4`;
}

function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCreditsDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(value);
  const month = parts.find((part) => part.type === "month")?.value || "Mar";
  const day = parts.find((part) => part.type === "day")?.value || "18";
  const year = parts.find((part) => part.type === "year")?.value || "2026";
  return `${month}, ${day} ${year}`;
}

function formatCreditsTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function buildCreditsTemplate(value = new Date()) {
  return [
    "Executive Producer - Jung International",
    "Director - Larry Corso",
    'Invention Name - "Inverted Backend"',
    `Date - ${formatCreditsDate(value)}`,
    `Time: ${formatCreditsTime(value)}`,
    "",
    "We appreciate your consideration!",
  ].join("\n");
}

function getCreditsValue(credits: string, label: string) {
  const prefix = `${label} -`;
  const line = credits
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!line) {
    return "";
  }
  return line.slice(prefix.length).trim();
}

function normalizeSentence(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function buildVideoSummarySeed(input: {
  credits: string;
  lowerThirdCompany: string;
  lowerThirdPerson: string;
}) {
  const inventionName = getCreditsValue(input.credits, "Invention Name").replace(/^"+|"+$/g, "");
  const director = getCreditsValue(input.credits, "Director");
  const presenter = getCreditsValue(input.credits, "Executive Producer");
  const speaker = input.lowerThirdPerson.trim() || director || "Larry Corso";
  const company = input.lowerThirdCompany.trim() || presenter || "Jung International";
  const invention = inventionName || "Inverted Backend";

  return `${speaker} from ${company} introduces ${invention}, a concept focused on simplifying the user experience and removing setup friction.`;
}

function buildYouTubeSummary(input: {
  credits: string;
  lowerThirdCompany: string;
  lowerThirdPerson: string;
  videoSummary: string;
}) {
  const sourceSummary =
    normalizeSentence(input.videoSummary) ||
    buildVideoSummarySeed({
      credits: input.credits,
      lowerThirdCompany: input.lowerThirdCompany,
      lowerThirdPerson: input.lowerThirdPerson,
    });

  return `${sourceSummary} This video highlights entrepreneurship, startup innovation, product thinking, and practical founder-led execution.`;
}

function buildYouTubeDescription(input: {
  credits: string;
  lowerThirdCompany: string;
  lowerThirdPerson: string;
  videoSummary: string;
}) {
  const inventionName = getCreditsValue(input.credits, "Invention Name").replace(/^"+|"+$/g, "");
  const director = getCreditsValue(input.credits, "Director");
  const presenter = getCreditsValue(input.credits, "Executive Producer");
  const speaker = input.lowerThirdPerson.trim() || director || "Larry Corso";
  const company = input.lowerThirdCompany.trim() || presenter || "Jung International";
  const invention = inventionName || "Inverted Backend";
  const sourceSummary =
    normalizeSentence(input.videoSummary) ||
    buildVideoSummarySeed({
      credits: input.credits,
      lowerThirdCompany: input.lowerThirdCompany,
      lowerThirdPerson: input.lowerThirdPerson,
    });

  return [
    sourceSummary,
    "",
    `Presented by ${company}, this video is positioned for audiences interested in entrepreneur stories, entrepreneurship, startup ideas, business innovation, product design, and founder-led execution.`,
    "",
    "Keywords:",
    "Entrepreneur, entrepreneurship, startup, founder, innovation, product development, business idea, software invention, tech entrepreneur",
    "",
    "Callouts:",
    `${speaker}`,
    `${company}`,
    `${invention}`,
  ].join("\n");
}

function buildRenderFormData(input: {
  videoFile?: File | { nativePath: string; name: string; type?: string } | null;
  logoFile: File;
  trailerMusicFile?: File | { nativePath: string; name: string; type?: string } | null;
  videoFormat: "short" | "wide" | "50/50";
  credits: string;
  subtitleHighlightColor: string;
  subtitlesEnabled: boolean;
  lowerThirdCompany: string;
  lowerThirdPerson: string;
}) {
  const formData = new FormData();
  if (input.videoFile) {
    if ("nativePath" in input.videoFile) {
      formData.append("videoPath", input.videoFile.nativePath);
    } else if ("path" in input.videoFile && typeof (input.videoFile as any).path === "string" && (input.videoFile as any).path) {
      formData.append("videoPath", (input.videoFile as any).path);
    } else {
      const file = input.videoFile as File;
      if (file.size > 100 * 1024 * 1024) {
        throw new Error("Video file is too large for standard upload. Please use the 'Pick Native' button.");
      }
      formData.append("video", file);
    }
  }
  if (input.trailerMusicFile) {
    if ("nativePath" in input.trailerMusicFile) {
      formData.append("introMusicPath", input.trailerMusicFile.nativePath);
      formData.append("outroMusicPath", input.trailerMusicFile.nativePath);
    } else if ("path" in input.trailerMusicFile && typeof (input.trailerMusicFile as any).path === "string" && (input.trailerMusicFile as any).path) {
      formData.append("introMusicPath", (input.trailerMusicFile as any).path);
      formData.append("outroMusicPath", (input.trailerMusicFile as any).path);
    } else {
      const file = input.trailerMusicFile as File;
      if (file.size > 50 * 1024 * 1024) {
        throw new Error("Audio file is too large for standard upload. Please use the 'Pick Native' button.");
      }
      formData.append("introMusic", file);
      formData.append("outroMusic", file);
    }
  }
  formData.append("logo", input.logoFile);
  formData.append("generateTrailerIntroOutro", "true");
  formData.append("videoFormat", input.videoFormat);
  formData.append("fontChoice", "Poppins");
  formData.append("soundtrackChoice", "startup-chime");
  formData.append("backgroundColor", INTRO_OUTRO_BACKGROUND);
  formData.append("textColor", "#ffffff");
  formData.append("accentColor", input.subtitleHighlightColor);
  formData.append("trailerTitle", "");
  formData.append("trailerSubtitle", "");
  formData.append("trailerOutroTitle", "");
  formData.append("trailerOutroSubtitle", "");
  formData.append("outroCredits", input.credits);
  formData.append("trailerDuration", "3.5");
  formData.append("lowerThirdTitle", input.lowerThirdCompany);
  formData.append("lowerThirdSubtitle", input.lowerThirdPerson);
  formData.append("lowerThirdStart", String(DEFAULT_LOWER_THIRD_START_SECONDS));
  formData.append("lowerThirdDuration", String(DEFAULT_LOWER_THIRD_DURATION_SECONDS));
  formData.append("subtitleFontChoice", "Poppins");
  formData.append("subtitleFontSize", "76");
  formData.append("subtitleTextColor", "#ffffff");
  formData.append("subtitleHighlightColor", input.subtitleHighlightColor);
  formData.append("subtitlesEnabled", String(input.subtitlesEnabled));
  formData.append("renderSpeedMode", "turbo");
  formData.append("subtitleLanguage", "en");
  return formData;
}

async function parseRenderStartError(response: Response) {
  if (response.status === 413) {
    return "Upload rejected (413): request body too large. Use a smaller file or run this locally without serverless size limits.";
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      return payload.error || payload.message || `Unable to start render (HTTP ${response.status}).`;
    } catch {
      return `Unable to start render (HTTP ${response.status}).`;
    }
  }

  return `Unable to start render (HTTP ${response.status}).`;
}

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const [activePhase, setActivePhase] = useState<AppPhase>(1);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [logoPalette, setLogoPalette] = useState<string[]>([]);
  const [subtitleHighlightColor, setSubtitleHighlightColor] = useState("");
  const [logoPaletteError, setLogoPaletteError] = useState("");
  const [videoFile, setVideoFile] = useState<File | { nativePath: string; name: string; type?: string } | null>(null);
  const [trailerMusicFile, setTrailerMusicFile] = useState<File | { nativePath: string; name: string; type?: string } | null>(null);
  const [videoFormat, setVideoFormat] = useState<"short" | "wide" | "50/50">("wide");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [credits, setCredits] = useState(() => buildCreditsTemplate());
  const [lowerThirdCompany, setLowerThirdCompany] = useState(DEFAULT_LOWER_THIRD_COMPANY);
  const [lowerThirdPerson, setLowerThirdPerson] = useState(DEFAULT_LOWER_THIRD_PERSON);
  const [videoSummaryInput, setVideoSummaryInput] = useState(() =>
    buildVideoSummarySeed({
      credits: buildCreditsTemplate(),
      lowerThirdCompany: DEFAULT_LOWER_THIRD_COMPANY,
      lowerThirdPerson: DEFAULT_LOWER_THIRD_PERSON,
    }),
  );
  const [youtubeSummary, setYoutubeSummary] = useState(() =>
    buildYouTubeSummary({
      credits: buildCreditsTemplate(),
      lowerThirdCompany: DEFAULT_LOWER_THIRD_COMPANY,
      lowerThirdPerson: DEFAULT_LOWER_THIRD_PERSON,
      videoSummary: buildVideoSummarySeed({
        credits: buildCreditsTemplate(),
        lowerThirdCompany: DEFAULT_LOWER_THIRD_COMPANY,
        lowerThirdPerson: DEFAULT_LOWER_THIRD_PERSON,
      }),
    }),
  );
  const [youtubeDescription, setYoutubeDescription] = useState(() =>
    buildYouTubeDescription({
      credits: buildCreditsTemplate(),
      lowerThirdCompany: DEFAULT_LOWER_THIRD_COMPANY,
      lowerThirdPerson: DEFAULT_LOWER_THIRD_PERSON,
      videoSummary: buildVideoSummarySeed({
        credits: buildCreditsTemplate(),
        lowerThirdCompany: DEFAULT_LOWER_THIRD_COMPANY,
        lowerThirdPerson: DEFAULT_LOWER_THIRD_PERSON,
      }),
    }),
  );
  const [isAutoSummarizing, setIsAutoSummarizing] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Phase 1: upload a logo image and confirm preview.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatusResponse | null>(null);
  const [result, setResult] = useState<RenderResponse | null>(null);
  const [downloadFilename, setDownloadFilename] = useState("final-video.mp4");
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewMuted, setIsPreviewMuted] = useState(false);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const statusPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (statusPollerRef.current) {
        clearInterval(statusPollerRef.current);
        statusPollerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  useEffect(() => {
    let cancelled = false;

    async function loadPalette() {
      if (!logoFile) {
        setLogoPalette([]);
        setSubtitleHighlightColor("");
        setLogoPaletteError("");
        return;
      }

      try {
        const content = await logoFile.text();
        if (cancelled) {
          return;
        }
        const palette = extractSvgPalette(content);
        setLogoPalette(palette);
        setSubtitleHighlightColor((current) =>
          current && palette.includes(current) ? current : (palette[0] || ""),
        );
        setLogoPaletteError(
          palette.length
            ? ""
            : "No usable brand colors were found in this logo. Try a higher-contrast image or SVG.",
        );
      } catch {
        if (cancelled) {
          return;
        }
        setLogoPalette([]);
        setSubtitleHighlightColor("");
        setLogoPaletteError("Unable to read logo colors.");
      }
    }

    void loadPalette();
    return () => {
      cancelled = true;
    };
  }, [logoFile]);

  useEffect(() => {
    if (!activeRenderJobId || !isSubmitting) {
      if (statusPollerRef.current) {
        clearInterval(statusPollerRef.current);
        statusPollerRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/render/${activeRenderJobId}`, {
          cache: "no-store",
        });

        if (response.status === 404) {
          return;
        }

        const payload = (await response.json()) as RenderStatusResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to fetch render status.");
        }

        setRenderStatus(payload);
        setStatusMessage(payload.message || "Rendering...");

        if (payload.status === "completed") {
          setResult((current) => {
            if (current?.jobId === payload.jobId) {
              return current;
            }
            return {
              jobId: payload.jobId,
              filename: payload.filename || `${payload.jobId}.mp4`,
              downloadUrl: `/api/download/${payload.jobId}`,
              previewUrl: `/api/preview/${payload.jobId}`,
              sizeInBytes: payload.sizeInBytes ?? 0,
            };
          });

          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setIsSubmitting(false);
          setActiveRenderJobId(null);
          setErrorMessage("");
          return;
        }

        if (payload.status === "failed") {
          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setIsSubmitting(false);
          setActiveRenderJobId(null);
          setErrorMessage(payload.error || payload.message || "Render failed.");
        }
      } catch (error) {
        if (statusPollerRef.current) {
          clearInterval(statusPollerRef.current);
          statusPollerRef.current = null;
        }

        setIsSubmitting(false);
        setActiveRenderJobId(null);
        setErrorMessage(error instanceof Error ? error.message : "Render failed.");
      }
    };

    void pollStatus();
    statusPollerRef.current = setInterval(pollStatus, 1500);
  }, [activeRenderJobId, isSubmitting]);

  useEffect(() => {
    setDownloadFilename(ensureMp4Filename(result?.filename || "final-video.mp4"));
    setIsPreviewPlaying(false);
    setPreviewCurrentTime(0);
    setPreviewDuration(0);
  }, [result?.jobId, result?.filename]);

  useEffect(() => {
    if (!result?.jobId) {
      return;
    }

    setYoutubeSummary(
      buildYouTubeSummary({
        credits,
        lowerThirdCompany,
        lowerThirdPerson,
        videoSummary: videoSummaryInput,
      }),
    );
    setYoutubeDescription(
      buildYouTubeDescription({
        credits,
        lowerThirdCompany,
        lowerThirdPerson,
        videoSummary: videoSummaryInput,
      }),
    );
  }, [result?.jobId, credits, lowerThirdCompany, lowerThirdPerson, videoSummaryInput]);

    async function handleNativePick(type: "video" | "image" | "audio") {
    if (!isElectron) return null;

    const filters =
      type === "video"
        ? [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] }]
        : type === "image"
        ? [{ name: "Images", extensions: ["svg", "png", "jpg", "jpeg", "webp"] }]
        : [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"] }];

    const dialogResult = await window.electronAPI.showOpenDialog({
      properties: ["openFile"],
      filters,
    });

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return null;

    const filePath = dialogResult.filePaths[0];
    const fileName = filePath.split(/[\\/]/).pop() || "file";

    let mimeType = "application/octet-stream";
    if (type === "video") mimeType = "video/mp4";
    else if (type === "image")
      mimeType = fileName.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
    else if (type === "audio") mimeType = "audio/mpeg";

    if (type === "video" || type === "audio") {
      return { nativePath: filePath, name: fileName, type: mimeType };
    }

    const buffer = await window.electronAPI.readFile(filePath);

    return new File([buffer as any], fileName, { type: mimeType });
  }

  async function handleLogoSelection(file: File | null) {
    if (!file) return;

    if (!isAcceptedLogoFile(file)) {
      setLogoFile(null);
      setErrorMessage("Logo must be .svg, .png, .jpg/.jpeg, or .webp.");
      return;
    }

    let processedFile: File | null = file;
    if (!isSvgLogoFile(file)) {
      try {
        processedFile = await convertRasterLogoToSvg(file);
      } catch {
        setLogoFile(null);
        setErrorMessage("Unable to convert logo image to SVG.");
        return;
      }
    }

    setErrorMessage("");
    setLogoFile(processedFile);
    setVideoFile(null);
    setResult(null);
    setRenderStatus(null);
    setStatusMessage(
      file && !isSvgLogoFile(file)
        ? "Phase 1 ready. Image logo converted to SVG for intro/outro rendering."
        : "Phase 1 ready. Review the preview, then continue to phase 2.",
    );
    setActivePhase(1);
  }

  async function handleVideoSelection(file: File | { nativePath: string; name: string; type?: string } | null) {
    if (file && !isLikelyVideoFile(file)) {
      setVideoFile(null);
      setResult(null);
      setRenderStatus(null);
      setErrorMessage("Video must be a supported format (.mp4, .mov, .m4v, .webm, .mkv, .avi).");
      return;
    }

    setVideoFile(file);
    setResult(null);
    setRenderStatus(null);
    if (file) {
      setErrorMessage("");
      setStatusMessage("Phase 2 ready. Continue to phase 3 for final options and render.");
    }
  }

  async function handleNativeExport() {
    if (!isElectron || !result) return;

    try {
      setStatusMessage("Preparing native export...");
      const response = await fetch(result.downloadUrl);
      if (!response.ok) throw new Error("Unable to fetch video for export.");

      const blob = await response.blob();
      const buffer = new Uint8Array(await blob.arrayBuffer());

      const dialogResult = await window.electronAPI.showSaveDialog({
        defaultPath: downloadFilename,
        filters: [{ name: "Videos", extensions: ["mp4"] }],
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        setStatusMessage("Export canceled.");
        return;
      }

      await window.electronAPI.writeFile(dialogResult.filePath, buffer);
      setStatusMessage(`Video exported to ${dialogResult.filePath}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Export failed.");
    }
  }

  async function handleAutoSummary() {
    setIsAutoSummarizing(true);
    setErrorMessage("");
    setStatusMessage("Updating credits with the current date and time...");

    try {
      setCredits(buildCreditsTemplate(new Date()));
      setStatusMessage("Credits updated with the current date and time.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update credits.");
      setStatusMessage("Credits update failed.");
    } finally {
      setIsAutoSummarizing(false);
    }
  }

  function handleSubtitlesToggle() {
    setSubtitlesEnabled((current) => {
      const next = !current;
      setResult(null);
      setRenderStatus(null);
      setErrorMessage("");
      setStatusMessage(
        next
          ? "Subtitles enabled for the next render."
          : "Subtitles disabled for the next render.",
      );
      return next;
    });
  }

  function refreshYoutubeCopy() {
    setYoutubeSummary(
      buildYouTubeSummary({
        credits,
        lowerThirdCompany,
        lowerThirdPerson,
        videoSummary: videoSummaryInput,
      }),
    );
    setYoutubeDescription(
      buildYouTubeDescription({
        credits,
        lowerThirdCompany,
        lowerThirdPerson,
        videoSummary: videoSummaryInput,
      }),
    );
    setStatusMessage("YouTube summary and description refreshed.");
  }

  async function handleCopyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setErrorMessage("");
      setStatusMessage(`${label} copied to clipboard.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function handlePreviewPlayPause() {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      await video.play();
      setIsPreviewPlaying(true);
      return;
    }

    video.pause();
    setIsPreviewPlaying(false);
  }

  function handlePreviewSeek(nextValue: number) {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = nextValue;
    setPreviewCurrentTime(nextValue);
  }

  function handlePreviewMuteToggle() {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    video.muted = !video.muted;
    setIsPreviewMuted(video.muted);
  }

  async function handleRender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!logoFile) {
      setErrorMessage("Upload a logo in phase 1 first.");
      setActivePhase(1);
      return;
    }

    if (!videoFile) {
      setErrorMessage("Upload a video in phase 2 before producing.");
      setActivePhase(2);
      return;
    }

    if (!subtitleHighlightColor || !logoPalette.includes(subtitleHighlightColor)) {
      setErrorMessage("Choose a subtitle highlight color from your logo palette in phase 1.");
      setActivePhase(1);
      return;
    }

    if (statusPollerRef.current) {
      clearInterval(statusPollerRef.current);
      statusPollerRef.current = null;
    }

    setErrorMessage("");
    setResult(null);
    setIsSubmitting(true);
    setRenderStatus({
      jobId: "",
      status: "queued",
      progress: 0,
      message: "Preparing render job...",
    });
    setStatusMessage("Preparing render job...");

    try {
      const formData = buildRenderFormData({
        videoFile,
        logoFile,
        trailerMusicFile,
        videoFormat,
        credits,
        subtitleHighlightColor,
        subtitlesEnabled,
        lowerThirdCompany,
        lowerThirdPerson,
      });

      setStatusMessage("Starting render job...");

      const response = await fetch("/api/render", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await parseRenderStartError(response));
      }

      const payload = (await response.json()) as RenderStartPayload;
      if (!("jobId" in payload)) {
        throw new Error(payload.error || payload.message || "Unable to start render.");
      }

      setActiveRenderJobId(payload.jobId);
      setRenderStatus({
        jobId: payload.jobId,
        status: payload.status ?? "running",
        progress: payload.progress ?? 0,
        message: payload.message ?? "Render started.",
      });
      setStatusMessage(payload.message ?? "Render started.");
    } catch (error) {
      setIsSubmitting(false);
      setActiveRenderJobId(null);
      setRenderStatus(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to start render.");
      setStatusMessage("Render did not complete.");
    }
  }

  const phase1Complete = Boolean(logoFile) && logoPalette.length > 0 && Boolean(subtitleHighlightColor);
  const phase2Complete = Boolean(videoFile);
  const phase2Unlocked = activePhase >= 2;
  const phase3Unlocked = activePhase >= 3;

  return (
    <main className={`relative min-h-screen overflow-hidden px-6 pb-10 text-[#e6edf1] sm:px-10 ${isMounted && isMac ? "pt-14" : "pt-10"}`}>
      <TitleBar />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-[#7dff35]/18 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-12 h-80 w-80 rounded-full bg-[#9bff2e]/14 blur-3xl" />
      <img
        src="/design.svg"
        alt="Design mark"
        className="pointer-events-none absolute left-7 top-7 h-10 w-auto object-contain sm:left-16 sm:top-7 sm:h-12"
      />
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <form onSubmit={handleRender} className="space-y-6">
          <section className="rounded-3xl border border-[#88ff45]/35 bg-[#152019]/78 p-6 shadow-[0_0_24px_rgba(136,255,69,0.12)]">
            <p className="text-xs uppercase tracking-[0.2em] text-[#a4ff73]">Phase 1</p>
            <h2 className="mt-1 text-xl font-semibold">Intro & Outro Maker</h2>
            <p className="mt-2 text-sm text-[#b8c3cb]">
              Logo fades from transparent to white to full color on background
              <span className="font-semibold text-[#e6edf1]"> {INTRO_OUTRO_BACKGROUND}</span>.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
                <span className="text-sm text-[#d6dde2]">Upload logo (.svg, .png, .jpg, .webp)</span>
                <div className="flex flex-wrap items-center gap-3">
                  {(!isMounted || !isElectron) ? (
                    <input
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp"
                      onChange={(event) => handleLogoSelection(event.target.files?.[0] ?? null)}
                      className="block flex-1 text-sm text-[#e6edf1] file:mr-4 file:rounded-full file:border-0 file:bg-[#9bff2e] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#0d1608] file:shadow-[0_0_14px_rgba(155,255,46,0.45)]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        const file = await handleNativePick("image") as File | null;
                        if (file) handleLogoSelection(file);
                      }}
                      className="inline-flex h-9 items-center justify-center rounded-full border border-[#7dff35]/55 bg-[#9bff2e]/10 px-4 text-xs font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/25"
                    >
                      Pick Native Logo
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
                <p className="text-sm text-[#d6dde2]">Preview (Intro + Outro)</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {["Intro", "Outro"].map((label) => (
                    <div key={label} className="rounded-xl border border-[#3a4752]/55 p-2">
                      <p className="mb-2 text-center text-xs uppercase tracking-[0.12em] text-[#a5d88b]">
                        {label}
                      </p>
                      <div
                        className="flex h-36 items-center justify-center rounded-lg"
                        style={{ backgroundColor: INTRO_OUTRO_BACKGROUND }}
                      >
                        {logoPreviewUrl ? (
                          <div className="relative h-24 w-24 sm:h-28 sm:w-28">
                            <img
                              src={logoPreviewUrl}
                              alt="Brand logo full color"
                              className="preview-color-layer absolute inset-0 h-full w-full object-contain"
                            />
                            <img
                              src={logoPreviewUrl}
                              alt="Brand logo white"
                              className="preview-white-layer absolute inset-0 h-full w-full object-contain"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-[#d7dee3]/80">Upload logo to preview</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <p className="text-sm text-[#d6dde2]">Subtitle highlight color (from logo only)</p>
              {logoPalette.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {logoPalette.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSubtitleHighlightColor(color)}
                      className={`h-10 w-10 rounded-full border-2 transition ${
                        subtitleHighlightColor === color
                          ? "border-[#9bff2e] shadow-[0_0_12px_rgba(155,255,46,0.45)]"
                          : "border-[#7dff35]/45 hover:border-[#a6ff6a]/70"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Pick ${color}`}
                      title={color}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-[#a8b4be]">
                  Upload a logo to extract available brand colors.
                </p>
              )}
              {subtitleHighlightColor ? (
                <p className="mt-2 text-xs text-[#b1bcc5]">
                  Selected subtitle highlight:{" "}
                  <span className="font-semibold text-[#e6edf1]">{subtitleHighlightColor}</span>
                </p>
              ) : null}
              {logoPaletteError ? (
                <p className="mt-2 text-xs text-amber-200">{logoPaletteError}</p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!phase1Complete}
                onClick={() => {
                  if (!phase1Complete) {
                    setErrorMessage(
                      logoPaletteError || "Upload a logo with usable brand colors first.",
                    );
                    return;
                  }
                  setErrorMessage("");
                  setActivePhase(2);
                  setStatusMessage("Phase 2 unlocked. Upload your video.");
                }}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#9bff2e] px-5 text-sm font-semibold text-[#0d1608] shadow-[0_0_18px_rgba(155,255,46,0.4)] transition hover:bg-[#b9ff63] hover:shadow-[0_0_22px_rgba(155,255,46,0.5)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Continue to Phase 2
              </button>
              {!phase1Complete && (
                <button
                  type="button"
                  onClick={() => {
                    setSubtitleHighlightColor("#E6FF00");
                    setActivePhase(2);
                    setErrorMessage("");
                    setStatusMessage("Phase 2 unlocked. Upload your video.");
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-[#dbe2e8] transition hover:bg-white/10"
                >
                  Skip Logo (Default Styling)
                </button>
              )}
            </div>
          </section>

          <section
            className={`rounded-3xl border border-[#88ff45]/35 bg-[#152019]/78 p-6 shadow-[0_0_24px_rgba(136,255,69,0.12)] ${
              phase2Unlocked ? "" : "opacity-55"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#a4ff73]">Phase 2</p>
            <h2 className="mt-1 text-xl font-semibold">Upload Video</h2>

            <div className="mt-4 grid gap-2 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <span className="text-sm text-[#d6dde2]">Main video file (.mp4, .mov, .m4v, .webm, .mkv)</span>
              <div className="flex flex-wrap items-center gap-3">
                {(!isMounted || !isElectron) ? (
                  <input
                    type="file"
                    accept={VIDEO_UPLOAD_ACCEPT_ATTR}
                    disabled={!phase2Unlocked}
                    onChange={(event) => handleVideoSelection(event.target.files?.[0] ?? null)}
                    className="block flex-1 text-sm text-[#e6edf1] file:mr-4 file:rounded-full file:border-0 file:bg-[#9bff2e] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#0d1608] file:shadow-[0_0_14px_rgba(155,255,46,0.45)] disabled:opacity-55"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!phase2Unlocked}
                    onClick={async () => {
                      const file = await handleNativePick("video");
                      if (file) handleVideoSelection(file);
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-[#7dff35]/55 bg-[#9bff2e]/10 px-4 text-xs font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/25 disabled:opacity-55"
                  >
                    Pick Native Video
                  </button>
                )}
              </div>
              {videoFile ? <span className="text-xs text-[#b1bcc5]">Selected: {videoFile.name}</span> : null}
            </div>

            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <p className="text-sm text-[#d6dde2]">Video format</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!phase2Unlocked}
                  onClick={() => setVideoFormat("short")}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    videoFormat === "short"
                      ? "bg-[#9bff2e] text-[#0d1608] shadow-[0_0_16px_rgba(155,255,46,0.4)]"
                      : "border border-[#7dff35]/55 bg-transparent text-[#dbe2e8] hover:bg-[#9bff2e]/15"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  TikTok (9:16)
                </button>
                <button
                  type="button"
                  disabled={!phase2Unlocked}
                  onClick={() => setVideoFormat("wide")}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    videoFormat === "wide"
                      ? "bg-[#9bff2e] text-[#0d1608] shadow-[0_0_16px_rgba(155,255,46,0.4)]"
                      : "border border-[#7dff35]/55 bg-transparent text-[#dbe2e8] hover:bg-[#9bff2e]/15"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  Landscape (16:9)
                </button>
                <button
                  type="button"
                  disabled={!phase2Unlocked}
                  onClick={() => setVideoFormat("50/50")}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    videoFormat === "50/50"
                      ? "bg-[#9bff2e] text-[#0d1608] shadow-[0_0_16px_rgba(155,255,46,0.4)]"
                      : "border border-[#7dff35]/55 bg-transparent text-[#dbe2e8] hover:bg-[#9bff2e]/15"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  50/50 (Split)
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActivePhase(1)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#7dff35]/45 px-5 text-sm font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/15"
              >
                Back to Phase 1
              </button>
              <button
                type="button"
                disabled={!phase2Unlocked || !phase2Complete}
                onClick={() => {
                  if (!videoFile) {
                    setErrorMessage("Upload your video before continuing.");
                    return;
                  }
                  setErrorMessage("");
                  setActivePhase(3);
                  setStatusMessage("Phase 3 unlocked. Configure final options and produce.");
                }}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#9bff2e] px-5 text-sm font-semibold text-[#0d1608] shadow-[0_0_18px_rgba(155,255,46,0.4)] transition hover:bg-[#b9ff63] hover:shadow-[0_0_22px_rgba(155,255,46,0.5)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Continue to Phase 3
              </button>
            </div>
          </section>

          <section
            className={`rounded-3xl border border-[#88ff45]/35 bg-[#152019]/78 p-6 shadow-[0_0_24px_rgba(136,255,69,0.12)] ${
              phase3Unlocked ? "" : "opacity-55"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#a4ff73]">Phase 3</p>
            <h2 className="mt-1 text-xl font-semibold">Finalize & Produce</h2>

            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#d6dde2]">Burn subtitles</p>
                  <p className="mt-1 text-xs text-[#a8b4be]">
                    {subtitlesEnabled
                      ? "On for the next render. Speech will be transcribed and burned into the video."
                      : "Off for the next render. The output video will not include subtitles."}
                  </p>
                </div>
                <label
                  className={`inline-flex items-center gap-3 rounded-full border px-3 py-2 transition ${
                    subtitlesEnabled
                      ? "border-[#9bff2e]/65 bg-[#9bff2e]/12"
                      : "border-[#7dff35]/35 bg-[#152019]/45"
                  } ${!phase3Unlocked || isSubmitting ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
                >
                  <span className="text-sm font-semibold text-[#e6edf1]">
                    {subtitlesEnabled ? "On" : "Off"}
                  </span>
                  <span className="relative inline-flex h-7 w-12 items-center">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={subtitlesEnabled}
                      disabled={!phase3Unlocked || isSubmitting}
                      onChange={handleSubtitlesToggle}
                      className="peer sr-only"
                      aria-label="Toggle subtitles"
                    />
                    <span className="absolute inset-0 rounded-full bg-[#304036] transition peer-checked:bg-[#9bff2e]" />
                    <span className="absolute left-1 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
                  </span>
                </label>
              </div>
              <p className="mt-1 text-xs text-[#a8b4be]">
                Accent color is locked to your logo palette:
                <span className="font-semibold text-[#e6edf1]"> {subtitleHighlightColor || "not selected"}</span>.
              </p>
            </div>



            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <label className="grid gap-2">
                <span className="text-sm text-[#d6dde2]">Intro + Outro audio (optional)</span>
                {(!isMounted || !isElectron) ? (
                  <input
                    type="file"
                    accept={AUDIO_UPLOAD_ACCEPT_ATTR}
                    disabled={!phase3Unlocked || isSubmitting || isAutoSummarizing}
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      if (nextFile && !isAcceptedAudioFile(nextFile)) {
                        setTrailerMusicFile(null);
                        setErrorMessage("Audio must be a supported file (.mp3, .wav, .m4a, .aac, .ogg, .flac, .webm).");
                        return;
                      }
                      setErrorMessage("");
                      setTrailerMusicFile(nextFile);
                    }}
                    className="block text-sm text-[#e6edf1] file:mr-4 file:rounded-full file:border-0 file:bg-[#9bff2e] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#0d1608] file:shadow-[0_0_14px_rgba(155,255,46,0.45)] disabled:opacity-55"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!phase3Unlocked || isSubmitting || isAutoSummarizing}
                    onClick={async () => {
                      const file = await handleNativePick("audio");
                      if (file) setTrailerMusicFile(file);
                    }}
                    className="inline-flex h-9 w-fit items-center justify-center rounded-full border border-[#7dff35]/55 bg-[#9bff2e]/10 px-4 text-xs font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/25 disabled:opacity-55"
                  >
                    Pick Native Audio
                  </button>
                )}
                <span className="text-xs text-[#9eabb6]">
                  {trailerMusicFile
                    ? `Selected: ${trailerMusicFile.name} (used for intro and outro)`
                    : "Uses default soundtrack if omitted."}
                </span>
              </label>
            </div>

            <label className="mt-4 grid gap-2 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#d6dde2]">Credits</span>
                <button
                  type="button"
                  onClick={() => {
                    void handleAutoSummary();
                  }}
                  disabled={!phase3Unlocked || isAutoSummarizing || isSubmitting}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-[#7dff35]/55 px-4 text-xs font-semibold text-[#d8ffbe] transition hover:bg-[#9bff2e]/15 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {isAutoSummarizing ? "Summarizing..." : "Auto Summary"}
                </button>
              </div>
              <textarea
                value={credits}
                onChange={(event) => setCredits(event.target.value)}
                rows={4}
                placeholder="Enter one credit per line"
                className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
              />
              <span className="text-xs text-[#9eabb6]">
                These lines will appear below the logo in the outro. Auto Summary refreshes the current date and time.
              </span>
            </label>

            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <p className="text-sm text-[#d6dde2]">Lower Third</p>
              <p className="mt-1 text-xs text-[#a8b4be]">
                {subtitlesEnabled
                  ? "Uses your selected logo color, appears 3 seconds after intro, and subtitles resume after the lower-third slides in."
                  : "Uses your selected logo color and appears 3 seconds after the intro."}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs text-[#b8c3cb]">Company Name</span>
                  <input
                    type="text"
                    value={lowerThirdCompany}
                    onChange={(event) => setLowerThirdCompany(event.target.value)}
                    placeholder={DEFAULT_LOWER_THIRD_COMPANY}
                    className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-xs text-[#b8c3cb]">Name of Person</span>
                  <input
                    type="text"
                    value={lowerThirdPerson}
                    onChange={(event) => setLowerThirdPerson(event.target.value)}
                    placeholder={DEFAULT_LOWER_THIRD_PERSON}
                    className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <p className="text-sm text-[#d6dde2]">Local-only mode</p>
              <p className="mt-1 text-xs text-[#a8b4be]">
                Cloud upload and YouTube sync are disabled. Rendering stays local on this machine.
              </p>
            </div>

            <label className="mt-4 grid gap-2 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#d6dde2]">Video Summary</span>
                <button
                  type="button"
                  onClick={refreshYoutubeCopy}
                  disabled={!phase3Unlocked || isSubmitting}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-[#7dff35]/55 px-4 text-xs font-semibold text-[#d8ffbe] transition hover:bg-[#9bff2e]/15 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  Refresh Copy
                </button>
              </div>
              <textarea
                value={videoSummaryInput}
                onChange={(event) => setVideoSummaryInput(event.target.value)}
                rows={4}
                placeholder="Write a short summary of what happens in the video."
                className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
              />
              <span className="text-xs text-[#9eabb6]">
                This summary is used to generate the YouTube summary and description after the video finishes rendering.
              </span>
            </label>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActivePhase(2)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#7dff35]/45 px-5 text-sm font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/15"
              >
                Back to Phase 2
              </button>
              <button
                type="submit"
                disabled={
                  !phase3Unlocked ||
                  !logoFile ||
                  !videoFile ||
                  isSubmitting ||
                  isAutoSummarizing
                }
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#9bff2e] px-5 text-sm font-semibold text-[#0d1608] shadow-[0_0_18px_rgba(155,255,46,0.4)] transition hover:bg-[#b9ff63] hover:shadow-[0_0_22px_rgba(155,255,46,0.5)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSubmitting ? "Producing..." : "Produce Video"}
              </button>
            </div>
          </section>
        </form>

        <section className="rounded-3xl border border-[#88ff45]/35 bg-[#152019]/78 p-6 shadow-[0_0_24px_rgba(136,255,69,0.12)]">
          <h3 className="text-lg font-semibold">Render Status</h3>
          <p className="mt-2 text-sm text-[#bcc7cf]">{statusMessage}</p>

          {renderStatus ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
              <div className="flex items-center justify-between text-sm text-[#bcc7cf]">
                <span>{renderStatus.status.toUpperCase()}</span>
                <span>{renderStatus.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#3a5928]/45">
                <div
                  className={`h-full rounded-full transition-all ${
                    renderStatus.status === "failed" ? "bg-red-400" : "bg-[#9bff2e]"
                  }`}
                  style={{ width: `${renderStatus.progress}%` }}
                />
              </div>
              <p className="text-xs text-[#b1bcc5]">{renderStatus.message}</p>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-400/35 bg-red-400/10 p-3 text-sm text-red-100">
              {errorMessage}
            </div>
          ) : null}

          {result ? (
            <div className="mt-5 space-y-4 rounded-2xl border border-[#92ff58]/45 bg-[#9bff2e]/10 p-4">
              <div>
                <p className="text-sm text-[#d5dde3]">Render complete</p>
                <label className="mt-2 grid max-w-xl gap-2">
                  <span className="text-xs uppercase tracking-[0.14em] text-[#b8c3cb]">
                    Output Filename
                  </span>
                  <input
                    type="text"
                    value={downloadFilename}
                    onChange={(event) => setDownloadFilename(event.target.value)}
                    onBlur={() => setDownloadFilename((current) => ensureMp4Filename(current))}
                    className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-base font-semibold text-[#e6edf1]"
                  />
                </label>
                <p className="text-xs text-[#b8c3cb]">Size: {formatBytes(result.sizeInBytes)}</p>
              </div>

              {result.previewUrl ? (
                <div className="space-y-3 overflow-hidden rounded-2xl border border-[#73ff3a]/30 bg-[#203027]/78 p-3">
                  <video
                    key={result.jobId}
                    ref={previewVideoRef}
                    preload="metadata"
                    className="h-auto w-full rounded-xl bg-black"
                    src={result.previewUrl}
                    onLoadedMetadata={(event) => {
                      setPreviewDuration(event.currentTarget.duration || 0);
                      setPreviewCurrentTime(event.currentTarget.currentTime || 0);
                      setIsPreviewMuted(event.currentTarget.muted);
                    }}
                    onTimeUpdate={(event) => {
                      setPreviewCurrentTime(event.currentTarget.currentTime || 0);
                    }}
                    onPlay={() => setIsPreviewPlaying(true)}
                    onPause={() => setIsPreviewPlaying(false)}
                    onEnded={() => setIsPreviewPlaying(false)}
                  />
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#73ff3a]/20 bg-[#152019]/70 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        void handlePreviewPlayPause();
                      }}
                      className="inline-flex h-10 min-w-24 items-center justify-center rounded-full bg-[#9bff2e] px-4 text-sm font-semibold text-[#0d1608] transition hover:bg-[#b9ff63]"
                    >
                      {isPreviewPlaying ? "Pause" : "Play"}
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewMuteToggle}
                      className="inline-flex h-10 min-w-20 items-center justify-center rounded-full border border-[#7dff35]/45 px-4 text-sm font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/15"
                    >
                      {isPreviewMuted ? "Unmute" : "Mute"}
                    </button>
                    <div className="min-w-24 text-sm font-medium text-[#d5dde3]">
                      {formatMediaTime(previewCurrentTime)} / {formatMediaTime(previewDuration)}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={previewDuration || 0}
                      step={0.1}
                      value={Math.min(previewCurrentTime, previewDuration || 0)}
                      onChange={(event) => handlePreviewSeek(Number(event.target.value))}
                      className="h-2 min-w-[220px] flex-1 accent-[#9bff2e]"
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-4">
                <a
                  href={result.downloadUrl}
                  download={ensureMp4Filename(downloadFilename)}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-[#9bff2e] px-5 text-sm font-semibold text-[#0d1608] shadow-[0_0_18px_rgba(155,255,46,0.4)] transition hover:bg-[#b9ff63] hover:shadow-[0_0_22px_rgba(155,255,46,0.5)]"
                >
                  Download Final Video
                </a>
                {isMounted && isElectron && (
                  <button
                    type="button"
                    onClick={handleNativeExport}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-[#7dff35]/55 bg-[#9bff2e]/10 px-5 text-sm font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/25"
                  >
                    Save to Disk...
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-[#73ff3a]/30 bg-[#1b2a21]/75 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-[#d6dde2]">YouTube Copy</p>
                    <p className="mt-1 text-xs text-[#a8b4be]">
                      Editable summary and description generated from your video summary.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshYoutubeCopy}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-[#7dff35]/55 px-4 text-xs font-semibold text-[#d8ffbe] transition hover:bg-[#9bff2e]/15"
                  >
                    Refresh Copy
                  </button>
                </div>

                <label className="mt-4 grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[#d6dde2]">Summary</span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyText(youtubeSummary, "Summary");
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-full border border-[#7dff35]/45 px-3 text-xs font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/15"
                    >
                      Copy Summary
                    </button>
                  </div>
                  <textarea
                    value={youtubeSummary}
                    onChange={(event) => setYoutubeSummary(event.target.value)}
                    rows={3}
                    className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
                  />
                </label>

                <label className="mt-4 grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[#d6dde2]">Description</span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyText(youtubeDescription, "Description");
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-full border border-[#7dff35]/45 px-3 text-xs font-semibold text-[#d5ffc2] transition hover:bg-[#9bff2e]/15"
                    >
                      Copy Description
                    </button>
                  </div>
                  <textarea
                    value={youtubeDescription}
                    onChange={(event) => setYoutubeDescription(event.target.value)}
                    rows={8}
                    className="rounded-xl border border-[#73ff3a]/30 bg-[#203027] px-3 py-2.5 text-[#e6edf1]"
                  />
                </label>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <style jsx>{`
        .preview-color-layer {
          animation: preview-logo-color-in 2.8s cubic-bezier(0.2, 0.78, 0.3, 1) infinite;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }

        .preview-white-layer {
          filter: brightness(0) saturate(100%) invert(100%);
          animation: preview-logo-white-out 2.8s cubic-bezier(0.2, 0.78, 0.3, 1) infinite;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }

        @keyframes preview-logo-color-in {
          0% {
            opacity: 0;
            filter: saturate(86%) brightness(1.07);
          }
          58% {
            opacity: 0;
            filter: saturate(88%) brightness(1.04);
          }
          100% {
            opacity: 1;
            filter: none;
          }
        }

        @keyframes preview-logo-white-out {
          0% {
            opacity: 0;
          }
          34% {
            opacity: 1;
          }
          58% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}
