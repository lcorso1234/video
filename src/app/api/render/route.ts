import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { renderVideo, resolveRenderInputFromDraft } from "@/lib/video-editor";
import {
  getYouTubeConnectionStatus,
  isYouTubeConfigured,
  uploadVideoToYouTube,
  writeYouTubePublishStatus,
  type YouTubePrivacyStatus,
} from "@/lib/youtube";

export const runtime = "nodejs";
const DEFAULT_SUBTITLE_FONT_SIZE = 48;
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
  sourceVideo: File;
  subtitleFile: File | null;
  logoFile: File | null;
  introMusicFile: File | null;
  outroMusicFile: File | null;
  videoFormat: "short" | "wide";
  renderSpeedMode: "turbo" | "balanced" | "quality";
  lightningMode: boolean;
  language: string;
  subtitleFontChoice: string;
  subtitleFontSize: number;
  subtitleTextColor: string;
  subtitleHighlightColor: string;
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
  youtubeAutoPublish: boolean;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubePrivacyStatus: YouTubePrivacyStatus;
  youtubeTags: string[];
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

function getVideoFormat(value: FormDataEntryValue | null): "short" | "wide" {
  if (value === "short" || value === "wide") {
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

function getYouTubePrivacyStatus(value: FormDataEntryValue | null): YouTubePrivacyStatus {
  if (value === "public" || value === "unlisted" || value === "private") {
    return value;
  }
  return "private";
}

function getYouTubeTags(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
}

async function runPipelineJob(jobId: string, input: PipelineJobInput) {
  try {
    const isLightning = input.lightningMode;
    const renderResult = await renderVideo(
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
        subtitlesEnabled: true,
        burnSubtitles: true,
        enableRetroLook: !isLightning,
        subtitleLanguage: input.language,
      },
      { jobId },
    );

    if (input.youtubeAutoPublish) {
      await uploadVideoToYouTube({
        jobId,
        videoPath: renderResult.outputPath,
        title: input.youtubeTitle,
        description: input.youtubeDescription,
        privacyStatus: input.youtubePrivacyStatus,
        tags: input.youtubeTags,
      });
    }
  } catch {
    void 0;
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const renderSpeedMode = getRenderSpeedMode(formData.get("renderSpeedMode"));
    const draftId = getText(formData.get("draftId")).trim();
    const draftInput = draftId ? await resolveRenderInputFromDraft(draftId) : null;
    const video = formData.get("video");
    const requestVideo = video instanceof File && video.size > 0 ? video : null;
    const sourceVideo = requestVideo || draftInput?.sourceVideo || null;
    if (!sourceVideo) {
      return NextResponse.json({ error: "Video upload is required." }, { status: 400 });
    }

    const rawSubtitle = getOptionalFile(formData.get("subtitleFile")) || draftInput?.subtitleFile || null;
    if (!rawSubtitle && !process.env.VOSK_MODEL_PATH?.trim()) {
      return NextResponse.json(
        {
          error:
            "Speech-to-text subtitles require VOSK_MODEL_PATH in the environment. Set it to a local Vosk model folder and restart the server.",
        },
        { status: 400 },
      );
    }

    const clonedVideo = new File([await sourceVideo.arrayBuffer()], sourceVideo.name || "source.mp4", {
      type: sourceVideo.type || "video/mp4",
    });
    const rawLogo = await normalizeLogoFile(
      getOptionalFile(formData.get("logo")) || draftInput?.logoFile || null,
    );
    const rawIntroMusic = getOptionalFile(formData.get("introMusic"));
    const rawOutroMusic = getOptionalFile(formData.get("outroMusic"));
    const clonedSubtitle = rawSubtitle
      ? new File([await rawSubtitle.arrayBuffer()], rawSubtitle.name || "subtitles.srt", {
          type: rawSubtitle.type || "application/x-subrip",
        })
      : null;
    const clonedLogo = rawLogo
      ? new File([await rawLogo.arrayBuffer()], rawLogo.name || "logo.svg", {
          type: rawLogo.type || "image/svg+xml",
        })
      : null;
    const clonedIntroMusic = rawIntroMusic
      ? new File([await rawIntroMusic.arrayBuffer()], rawIntroMusic.name || "intro-music.mp3", {
          type: rawIntroMusic.type || "audio/mpeg",
        })
      : null;
    const clonedOutroMusic = rawOutroMusic
      ? new File([await rawOutroMusic.arrayBuffer()], rawOutroMusic.name || "outro-music.mp3", {
          type: rawOutroMusic.type || "audio/mpeg",
        })
      : null;
    const youtubeAutoPublish = getBoolean(formData.get("youtubeAutoPublish"), false);
    const fallbackYouTubeTitle = (sourceVideo.name || "Produced Video")
      .replace(/\.[^/.]+$/, "")
      .trim();
    const youtubeTitle =
      getText(formData.get("youtubeTitle"), fallbackYouTubeTitle || "Produced Video")
        .trim()
        .slice(0, 100) || fallbackYouTubeTitle || "Produced Video";
    const youtubeDescription = getText(formData.get("youtubeDescription"), "")
      .trim()
      .slice(0, 5000);
    const youtubePrivacyStatus = getYouTubePrivacyStatus(formData.get("youtubePrivacyStatus"));
    const youtubeTags = getYouTubeTags(formData.get("youtubeTags"));

    if (youtubeAutoPublish) {
      if (!isYouTubeConfigured()) {
        return NextResponse.json(
          {
            error:
              "YouTube sync is not configured on the server. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first.",
          },
          { status: 400 },
        );
      }

      const youtubeStatus = await getYouTubeConnectionStatus();
      if (!youtubeStatus.connected) {
        return NextResponse.json(
          {
            error:
              youtubeStatus.message ||
              "YouTube account is not connected. Connect your account in phase 3 first.",
          },
          { status: 400 },
        );
      }
    }

    const jobId = randomUUID();
    if (youtubeAutoPublish) {
      await writeYouTubePublishStatus(jobId, {
        status: "queued",
        message: "YouTube upload queued. Upload starts after render completes.",
        title: youtubeTitle,
        privacyStatus: youtubePrivacyStatus,
      });
    }

    const input: PipelineJobInput = {
      sourceVideo: clonedVideo,
      subtitleFile: clonedSubtitle,
      logoFile: clonedLogo,
      introMusicFile: clonedIntroMusic,
      outroMusicFile: clonedOutroMusic,
      videoFormat: getVideoFormat(formData.get("videoFormat")),
      renderSpeedMode,
      lightningMode: renderSpeedMode === "turbo",
      language: getText(formData.get("subtitleLanguage"), "en"),
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
      lowerThirdStart: getNumber(formData.get("lowerThirdStart"), 4),
      lowerThirdDuration: getNumber(formData.get("lowerThirdDuration"), 6),
      youtubeAutoPublish,
      youtubeTitle,
      youtubeDescription,
      youtubePrivacyStatus,
      youtubeTags,
    };

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
    const message = error instanceof Error ? error.message : "Unable to queue render job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
