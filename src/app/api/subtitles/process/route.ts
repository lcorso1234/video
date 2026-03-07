import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { NextResponse } from "next/server";
import { renderVideo } from "@/lib/video-editor";

export const runtime = "nodejs";

type JobPhase = "queued" | "running" | "completed" | "failed";

type JobStatus = {
  jobId: string;
  status: JobPhase;
  progress: number;
  message: string;
  filename?: string;
  sizeInBytes?: number;
  error?: string;
  updatedAt: string;
};

type PipelineServices = {
  extractAudio: (input: { inputVideoPath: string; outputAudioPath: string }) => Promise<void>;
  burnSubtitles: (input: {
    inputVideoPath: string;
    srtPath: string;
    wordsPath?: string;
    outputVideoPath: string;
    fontSize?: number;
    highlightColor?: string;
    fontFamily?: string;
    speedMode?: "turbo" | "balanced" | "quality";
  }) => Promise<void>;
  transcribeAudio: (input: {
    audioPath: string;
    srtPath: string;
    wordsPath?: string;
    language?: string;
    modelPath?: string;
  }) => Promise<void>;
  assertBinaries: () => void;
};

type PipelineJobInput = {
  sourceVideo: File;
  logoFile: File | null;
  renderSpeedMode: "turbo" | "balanced" | "quality";
  language: string;
  fontChoice: string;
  fontSize: number;
  highlightColor: string;
  generateTrailerIntroOutro: boolean;
  trailerTitle: string;
  trailerSubtitle: string;
  trailerOutroTitle: string;
  trailerOutroSubtitle: string;
  trailerDuration: number;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontChoiceTheme: string;
  soundtrackChoice: "startup-chime" | "spirited-blues";
  lowerThirdTitle: string;
  lowerThirdSubtitle: string;
  lowerThirdStart: number;
  lowerThirdDuration: number;
};

const require = createRequire(import.meta.url);

function getJobDirectory(jobId: string) {
  return path.join(process.cwd(), ".video-editor-jobs", jobId);
}

function getPipelineStatusPath(jobId: string) {
  return path.join(getJobDirectory(jobId), "pipeline-status.json");
}

async function writeJobStatus(
  jobId: string,
  payload: Omit<JobStatus, "jobId" | "updatedAt">,
) {
  const status: JobStatus = {
    jobId,
    status: payload.status,
    progress: Math.max(0, Math.min(100, Math.round(payload.progress))),
    message: payload.message,
    filename: payload.filename,
    sizeInBytes: payload.sizeInBytes,
    error: payload.error,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(getJobDirectory(jobId), { recursive: true });
  await writeFile(getPipelineStatusPath(jobId), `${JSON.stringify(status)}\n`, "utf8");
}

function loadPipelineServices(): PipelineServices {
  const videoService = require("../../../../../services/videoService.js") as Record<
    string,
    unknown
  >;
  const subtitleService = require("../../../../../services/subtitleService.js") as Record<
    string,
    unknown
  >;
  const ffmpegUtils = require("../../../../../utils/ffmpeg.js") as Record<string, unknown>;

  return {
    extractAudio: videoService.extractAudio as PipelineServices["extractAudio"],
    burnSubtitles: videoService.burnSubtitles as PipelineServices["burnSubtitles"],
    transcribeAudio: subtitleService.transcribeAudio as PipelineServices["transcribeAudio"],
    assertBinaries: ffmpegUtils.assertBinaries as PipelineServices["assertBinaries"],
  };
}

const googleFontFallbacks: Record<string, string> = {
  Poppins: "Arial",
  Montserrat: "Arial",
  Roboto: "Arial",
  "Open Sans": "Arial",
  Lato: "Arial",
  Oswald: "Arial",
  Raleway: "Arial",
  Nunito: "Arial",
  "Work Sans": "Arial",
  "Source Sans 3": "Arial",
  Inter: "Arial",
  Ubuntu: "Arial",
  "PT Sans": "Arial",
  "Josefin Sans": "Arial",
  "Bebas Neue": "Helvetica",
  "Playfair Display": "Times New Roman",
  Merriweather: "Times New Roman",
  Lora: "Times New Roman",
  "Noto Serif": "Times New Roman",
  "Libre Baskerville": "Times New Roman",
  "Cormorant Garamond": "Times New Roman",
  Arvo: "Times New Roman",
  "DM Serif Display": "Times New Roman",
  "Abril Fatface": "Helvetica",
  "Space Grotesk": "Arial",
  "Titillium Web": "Arial",
  "Barlow Condensed": "Helvetica",
  Anton: "Helvetica",
  "Fira Sans": "Arial",
  Inconsolata: "Courier New",
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

function getSoundtrackChoice(
  value: FormDataEntryValue | null,
): "startup-chime" | "spirited-blues" {
  if (value === "startup-chime" || value === "spirited-blues") {
    return value;
  }

  return "spirited-blues";
}

function getRenderSpeedMode(
  value: FormDataEntryValue | null,
): "turbo" | "balanced" | "quality" {
  if (value === "turbo" || value === "balanced" || value === "quality") {
    return value;
  }

  return "turbo";
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
    const { extractAudio, burnSubtitles, transcribeAudio, assertBinaries } =
      loadPipelineServices();
    assertBinaries();

    await writeJobStatus(jobId, {
      status: "running",
      progress: 8,
      message: "Building intro/outro timeline.",
    });

    const jobDirectory = getJobDirectory(jobId);
    const audioPath = path.join(jobDirectory, "subtitle-source.wav");
    const srtPath = path.join(jobDirectory, `${jobId}.srt`);
    const wordsPath = path.join(jobDirectory, `${jobId}.words.json`);
    const burnTempPath = path.join(jobDirectory, "burned-with-subtitles.mp4");
    const fontFamily = googleFontFallbacks[input.fontChoice] || "Arial";

    const timelineRender = await renderVideo(
      {
        sourceVideo: input.sourceVideo,
        brandLogo: input.logoFile,
        generateTrailerIntroOutro: input.generateTrailerIntroOutro,
        trailerTitle: input.trailerTitle,
        trailerSubtitle: input.trailerSubtitle,
        trailerOutroTitle: input.trailerOutroTitle,
        trailerOutroSubtitle: input.trailerOutroSubtitle,
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
        subtitlesEnabled: false,
      },
      { jobId },
    );

    const timelineVideoPath = timelineRender.outputPath;

    await writeJobStatus(jobId, {
      status: "running",
      progress: 62,
      message: "Extracting audio and transcribing speech.",
    });

    await extractAudio({
      inputVideoPath: timelineVideoPath,
      outputAudioPath: audioPath,
    });

    await transcribeAudio({
      audioPath,
      srtPath,
      wordsPath,
      language: input.language,
      modelPath: process.env.VOSK_MODEL_PATH,
    });

    await writeJobStatus(jobId, {
      status: "running",
      progress: 84,
      message: "Burning karaoke subtitles.",
    });

    await burnSubtitles({
      inputVideoPath: timelineVideoPath,
      srtPath,
      wordsPath,
      outputVideoPath: burnTempPath,
      fontSize: input.fontSize,
      highlightColor: input.highlightColor,
      fontFamily,
      speedMode: input.renderSpeedMode,
    });

    try {
      await unlink(timelineVideoPath);
    } catch {
      void 0;
    }
    await rename(burnTempPath, timelineVideoPath);

    const outputStat = await stat(timelineVideoPath);
    await writeJobStatus(jobId, {
      status: "completed",
      progress: 100,
      message:
        input.renderSpeedMode === "turbo"
          ? "Subtitle pipeline complete (Turbo)."
          : "Subtitle pipeline complete.",
      filename: `${jobId}.mp4`,
      sizeInBytes: outputStat.size,
    });
  } catch (error) {
    await writeJobStatus(jobId, {
      status: "failed",
      progress: 0,
      message: "Subtitle pipeline failed.",
      error: error instanceof Error ? error.message : "Subtitle pipeline failed.",
    });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video = formData.get("video");
    if (!(video instanceof File) || video.size === 0) {
      return NextResponse.json({ error: "Video upload is required." }, { status: 400 });
    }

    if (!process.env.VOSK_MODEL_PATH?.trim()) {
      return NextResponse.json(
        {
          error:
            "Speech-to-text subtitles require VOSK_MODEL_PATH in the environment. Set it to a local Vosk model folder and restart the server.",
        },
        { status: 400 },
      );
    }

    const jobId = randomUUID();
    const clonedSourceVideo = new File(
      [await video.arrayBuffer()],
      video.name || "source.mp4",
      { type: video.type || "video/mp4" },
    );
    const rawLogo = getOptionalFile(formData.get("logo"));
    const clonedLogoFile = rawLogo
      ? new File([await rawLogo.arrayBuffer()], rawLogo.name || "logo.png", {
          type: rawLogo.type || "image/png",
        })
      : null;
    const input: PipelineJobInput = {
      sourceVideo: clonedSourceVideo,
      logoFile: clonedLogoFile,
      renderSpeedMode: getRenderSpeedMode(formData.get("renderSpeedMode")),
      language: getText(formData.get("subtitleLanguage"), "en"),
      fontChoice: getText(formData.get("subtitleFontChoice"), "Poppins"),
      fontSize: getNumber(formData.get("subtitleFontSize"), 48),
      highlightColor: getText(formData.get("subtitleHighlightColor"), "#19b5fe"),
      generateTrailerIntroOutro: getBoolean(formData.get("generateTrailerIntroOutro"), true),
      trailerTitle: getText(formData.get("trailerTitle"), "COMING UP NEXT"),
      trailerSubtitle: getText(formData.get("trailerSubtitle"), "A cinematic trailer"),
      trailerOutroTitle: getText(formData.get("trailerOutroTitle"), "THANK YOU FOR WATCHING"),
      trailerOutroSubtitle: getText(
        formData.get("trailerOutroSubtitle"),
        "Stay tuned for the next release",
      ),
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

    await writeJobStatus(jobId, {
      status: "queued",
      progress: 2,
      message: "Job queued.",
    });

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
    const message =
      error instanceof Error ? error.message : "Subtitle pipeline queueing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
