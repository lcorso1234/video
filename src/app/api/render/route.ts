import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  getSubtitleModelConfigError,
  requiresConfiguredVoskModelForTranscription,
  renderVideo,
  resolveRenderInputFromDraft,
  type RenderMediaSource,
} from "@/lib/video-editor";
import { isLikelyVideoFile } from "@/lib/media-file";

export const runtime = "nodejs";
const DEFAULT_SUBTITLE_FONT_SIZE = 76;
const DEFAULT_SUBTITLE_HIGHLIGHT_COLOR = "#E6FF00";
const DEFAULT_SUBTITLE_TEXT_COLOR = "#ffffff";
const LOGO_ALLOWED_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const LOGO_ALLOWED_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];

type PipelineJobInput = {
  sourceVideo: RenderMediaSource;
  subtitleFile: File | null;
  logoFile: File | null;
  introMusicFile: File | null;
  outroMusicFile: File | null;
  videoFormat: "short" | "wide" | "50/50";
  renderSpeedMode: "turbo" | "balanced" | "quality";
  lightningMode: boolean;
  language: string;
  subtitleFontChoice: string;
  subtitleFontSize: number;
  subtitleTextColor: string;
  subtitleHighlightColor: string;
  subtitlesEnabled: boolean;
  generateTrailerIntroOutro: boolean;
  trailerTitle: string;
  trailerSubtitle: string;
  trailerOutroTitle: string;
  trailerOutroSubtitle: string;
  outroCredits: string;
  trailerDuration: number;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontChoiceTheme: string;
  soundtrackChoice:
    | "startup-chime"
    | "spirited-blues"
    | "theater-chime"
    | "trailer-braam"
    | "piano-lift";
  lowerThirdTitle: string;
  lowerThirdSubtitle: string;
  lowerThirdStart: number;
  lowerThirdDuration: number;
  cleanupDirectories: string[];
};

function getText(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getBoolean(value: FormDataEntryValue | null, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value === "true" || value === "1" || value === "on";
}

function getNumber(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOptionalFile(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  return value;
}

function hasLogoExtension(filename: string) {
  const lower = filename.toLowerCase();
  return LOGO_ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function inferLogoMime(file: File) {
  if (LOGO_ALLOWED_MIME_TYPES.has(file.type)) {
    return file.type;
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "";
}

async function normalizeLogoFile(file: File | null) {
  if (!file) {
    return null;
  }

  const mimeType = inferLogoMime(file);
  if (!mimeType && !hasLogoExtension(file.name)) {
    throw new Error("Logo must be .svg, .png, .jpg/.jpeg, or .webp.");
  }

  if (mimeType === "image/svg+xml") {
    return file;
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <image href="${dataUrl}" width="1000" height="1000" preserveAspectRatio="xMidYMid meet" />
</svg>`;

  const baseName = (file.name || "logo").replace(/\.[^/.]+$/, "") || "logo";
  return new File([svgMarkup], `${baseName}.svg`, { type: "image/svg+xml" });
}

async function cleanupDirectories(paths: string[]) {
  await Promise.allSettled(
    paths.map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

function getSoundtrackChoice(
  value: FormDataEntryValue | null,
):
  | "startup-chime"
  | "spirited-blues"
  | "theater-chime"
  | "trailer-braam"
  | "piano-lift" {
  if (
    value === "startup-chime" ||
    value === "spirited-blues" ||
    value === "theater-chime" ||
    value === "trailer-braam" ||
    value === "piano-lift"
  ) {
    return value;
  }

  return "theater-chime";
}

function getRenderSpeedMode(
  value: FormDataEntryValue | null,
): "turbo" | "balanced" | "quality" {
  if (value === "turbo" || value === "balanced" || value === "quality") {
    return value;
  }

  return "turbo";
}

function getVideoFormat(value: FormDataEntryValue | null): "short" | "wide" | "50/50" {
  if (value === "short" || value === "wide" || value === "50/50") {
    return value;
  }
  return "wide";
}

function getTimelineQualityForSpeedMode(
  speedMode: "turbo" | "balanced" | "quality",
): "fast" | "balanced" | "high" {
  if (speedMode === "quality") {
    return "high";
  }
  if (speedMode === "balanced") {
    return "balanced";
  }
  return "fast";
}

async function runPipelineJob(jobId: string, input: PipelineJobInput) {
  try {
    const isLightning = input.lightningMode;
    await renderVideo(
      {
        sourceVideo: input.sourceVideo,
        subtitleFile: input.subtitleFile,
        brandLogo: input.logoFile,
        introMusicFile: input.introMusicFile,
        outroMusicFile: input.outroMusicFile,
        videoFormat: input.videoFormat,
        generateTrailerIntroOutro: input.generateTrailerIntroOutro,
        trailerTitle: input.trailerTitle,
        trailerSubtitle: input.trailerSubtitle,
        trailerOutroTitle: input.trailerOutroTitle,
        trailerOutroSubtitle: input.trailerOutroSubtitle,
        outroCredits: input.outroCredits,
        trailerDuration: input.trailerDuration,
        backgroundColor: "#2A3439",
        textColor: input.textColor,
        accentColor: input.accentColor,
        fontChoice: input.fontChoiceTheme,
        qualityProfile: getTimelineQualityForSpeedMode(input.renderSpeedMode),
        soundtrackChoice: input.soundtrackChoice,
        lowerThirdTitle: input.lowerThirdTitle,
        lowerThirdSubtitle: input.lowerThirdSubtitle,
        lowerThirdStart: input.lowerThirdStart,
        lowerThirdDuration: input.lowerThirdDuration,
        subtitleFontChoice: input.subtitleFontChoice,
        subtitleFontSize: input.subtitleFontSize,
        subtitleTextColor: input.subtitleTextColor,
        subtitleHighlightColor: input.subtitleHighlightColor,
        subtitlesEnabled: input.subtitlesEnabled,
        burnSubtitles: input.subtitlesEnabled,
        enableRetroLook: !isLightning,
        subtitleLanguage: input.language,

      },
      { jobId },
    );
  } catch {
    void 0;
  } finally {
    await cleanupDirectories(input.cleanupDirectories);
  }
}

export async function POST(request: Request) {
  const temporaryDirectories: string[] = [];
  let handoffCleanupToBackgroundJob = false;

  const errorResponse = async (message: string, status = 400) => {
    if (!handoffCleanupToBackgroundJob) {
      await cleanupDirectories(temporaryDirectories);
    }
    return NextResponse.json({ error: message }, { status });
  };

  try {
    const formData = await request.formData();
    const renderSpeedMode = getRenderSpeedMode(formData.get("renderSpeedMode"));
    const draftId = getText(formData.get("draftId")).trim();
    const draftInput = draftId ? await resolveRenderInputFromDraft(draftId) : null;

    const video = formData.get("video");
    const videoPath = getText(formData.get("videoPath"));
    const requestVideo = video instanceof File && video.size > 0 ? video : null;
    let sourceVideo: RenderMediaSource | null = requestVideo || draftInput?.sourceVideo || null;

    if (!sourceVideo && videoPath) {
      try {
        const { stat } = await import("node:fs/promises");
        const { basename } = await import("node:path");
        const stats = await stat(videoPath);
        sourceVideo = {
          path: videoPath,
          name: basename(videoPath),
          size: stats.size,
          lastModified: stats.mtimeMs,
        };
      } catch (err) {
        console.error("Failed to stat videoPath:", err);
      }
    }

    if (!sourceVideo) {
      return errorResponse("Video upload or valid local path is required.");
    }
    if (!isLikelyVideoFile(sourceVideo)) {
      return errorResponse("Video must be a supported format (.mp4, .mov, .m4v, .webm, .mkv, .avi).");
    }

    const subtitlesEnabled = getBoolean(formData.get("subtitlesEnabled"), true);
    const subtitleLanguage = getText(formData.get("subtitleLanguage"), "en");
    const rawSubtitle = getOptionalFile(formData.get("subtitleFile")) || draftInput?.subtitleFile || null;
    if (
      subtitlesEnabled &&
      !rawSubtitle &&
      requiresConfiguredVoskModelForTranscription()
    ) {
      return errorResponse(getSubtitleModelConfigError(subtitleLanguage));
    }

    const normalizedLogo = await normalizeLogoFile(
      getOptionalFile(formData.get("logo")) || draftInput?.logoFile || null,
    );

    let introMusicFile: File | null = getOptionalFile(formData.get("introMusic"));
    let outroMusicFile: File | null = getOptionalFile(formData.get("outroMusic"));

    const introMusicPath = getText(formData.get("introMusicPath"));
    const outroMusicPath = getText(formData.get("outroMusicPath"));

    try {
      const { readFile } = await import("node:fs/promises");
      const { basename } = await import("node:path");

      if (!introMusicFile && introMusicPath) {
        const buffer = await readFile(introMusicPath);
        introMusicFile = new File([buffer], basename(introMusicPath), { type: "audio/mpeg" });
      }

      if (!outroMusicFile && outroMusicPath) {
        const buffer = await readFile(outroMusicPath);
        outroMusicFile = new File([buffer], basename(outroMusicPath), { type: "audio/mpeg" });
      }
    } catch (err) {
      console.error("Failed to read music path:", err);
    }

    const jobId = randomUUID();

    const input: PipelineJobInput = {
      sourceVideo,
      subtitleFile: rawSubtitle,
      logoFile: normalizedLogo,
      introMusicFile,
      outroMusicFile,
      videoFormat: getVideoFormat(formData.get("videoFormat")),

      renderSpeedMode,
      lightningMode: renderSpeedMode === "turbo",
      language: subtitleLanguage,
      subtitleFontChoice: getText(formData.get("subtitleFontChoice"), "Poppins"),
      subtitleFontSize: getNumber(formData.get("subtitleFontSize"), DEFAULT_SUBTITLE_FONT_SIZE),
      subtitleTextColor: getText(
        formData.get("subtitleTextColor"),
        DEFAULT_SUBTITLE_TEXT_COLOR,
      ),
      subtitleHighlightColor: getText(
        formData.get("subtitleHighlightColor"),
        DEFAULT_SUBTITLE_HIGHLIGHT_COLOR,
      ),
      subtitlesEnabled,
      generateTrailerIntroOutro: getBoolean(formData.get("generateTrailerIntroOutro"), true),
      trailerTitle: getText(formData.get("trailerTitle"), "COMING UP NEXT"),
      trailerSubtitle: getText(formData.get("trailerSubtitle"), "A cinematic trailer"),
      trailerOutroTitle: getText(formData.get("trailerOutroTitle"), "THANK YOU FOR WATCHING"),
      trailerOutroSubtitle: getText(
        formData.get("trailerOutroSubtitle"),
        "Stay tuned for the next release",
      ),
      outroCredits: getText(formData.get("outroCredits")),
      trailerDuration: getNumber(formData.get("trailerDuration"), 3.5),
      backgroundColor: getText(formData.get("backgroundColor"), "#050816"),
      textColor: getText(formData.get("textColor"), "#f8fafc"),
      accentColor: getText(formData.get("accentColor"), "#4f80ff"),
      fontChoiceTheme: getText(formData.get("fontChoice"), "Poppins"),
      soundtrackChoice: getSoundtrackChoice(formData.get("soundtrackChoice")),
      lowerThirdTitle: getText(formData.get("lowerThirdTitle")),
      lowerThirdSubtitle: getText(formData.get("lowerThirdSubtitle")),
      lowerThirdStart: getNumber(formData.get("lowerThirdStart"), 3),
      lowerThirdDuration: getNumber(formData.get("lowerThirdDuration"), 6),

      cleanupDirectories: temporaryDirectories,
    };

    handoffCleanupToBackgroundJob = true;
    void runPipelineJob(jobId, input);

    return NextResponse.json(
      {
        jobId,
        filename: `${jobId}.mp4`,
        downloadUrl: `/api/download/${jobId}`,
        previewUrl: `/api/preview/${jobId}`,
        sizeInBytes: 0,
        status: "running",
        progress: 5,
        message: "Render job started.",
      },
      { status: 202 },
    );
  } catch (error) {
    if (!handoffCleanupToBackgroundJob) {
      await cleanupDirectories(temporaryDirectories);
    }
    const message = error instanceof Error ? error.message : "Unable to queue render job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
