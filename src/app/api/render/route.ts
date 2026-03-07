import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { renderVideo } from "@/lib/video-editor";

export const runtime = "nodejs";
const DEFAULT_SUBTITLE_FONT_SIZE = 48;
const DEFAULT_SUBTITLE_HIGHLIGHT_COLOR = "#E6FF00";

type PipelineJobInput = {
  sourceVideo: File;
  subtitleFile: File | null;
  logoFile: File | null;
  introMusicFile: File | null;
  outroMusicFile: File | null;
  videoFormat: "short" | "wide";
  renderSpeedMode: "turbo" | "balanced" | "quality";
  language: string;
  subtitleFontChoice: string;
  subtitleFontSize: number;
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

function validateLogoSvgFile(file: File | null) {
  if (!file) {
    return null;
  }

  const name = file.name.toLowerCase();
  const isSvgType = file.type === "image/svg+xml";
  const isSvgExt = name.endsWith(".svg");
  if (!isSvgType && !isSvgExt) {
    throw new Error("Logo must be an SVG file (.svg) for crisp output.");
  }

  return file;
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

async function runPipelineJob(jobId: string, input: PipelineJobInput) {
  try {
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
        backgroundColor: input.backgroundColor,
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
        subtitleHighlightColor: input.subtitleHighlightColor,
        subtitlesEnabled: true,
        subtitleLanguage: input.language,
      },
      { jobId },
    );
  } catch {
    void 0;
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video = formData.get("video");
    if (!(video instanceof File) || video.size === 0) {
      return NextResponse.json({ error: "Video upload is required." }, { status: 400 });
    }

    const rawSubtitle = getOptionalFile(formData.get("subtitleFile"));
    if (!rawSubtitle && !process.env.VOSK_MODEL_PATH?.trim()) {
      return NextResponse.json(
        {
          error:
            "Speech-to-text subtitles require VOSK_MODEL_PATH in the environment. Set it to a local Vosk model folder and restart the server.",
        },
        { status: 400 },
      );
    }

    const clonedVideo = new File([await video.arrayBuffer()], video.name || "source.mp4", {
      type: video.type || "video/mp4",
    });
    const rawLogo = validateLogoSvgFile(getOptionalFile(formData.get("logo")));
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

    const jobId = randomUUID();
    const input: PipelineJobInput = {
      sourceVideo: clonedVideo,
      subtitleFile: clonedSubtitle,
      logoFile: clonedLogo,
      introMusicFile: clonedIntroMusic,
      outroMusicFile: clonedOutroMusic,
      videoFormat: getVideoFormat(formData.get("videoFormat")),
      renderSpeedMode: getRenderSpeedMode(formData.get("renderSpeedMode")),
      language: getText(formData.get("subtitleLanguage"), "en"),
      subtitleFontChoice: getText(formData.get("subtitleFontChoice"), "Poppins"),
      subtitleFontSize: getNumber(formData.get("subtitleFontSize"), DEFAULT_SUBTITLE_FONT_SIZE),
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
