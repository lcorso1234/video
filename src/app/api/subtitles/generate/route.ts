import { NextResponse } from "next/server";
import {
  createRenderDraftFromStepOne,
  generateSubtitlesFromSourceVideo,
  getSubtitleModelConfigError,
  requiresConfiguredVoskModelForTranscription,
} from "@/lib/video-editor";
import { isLikelyVideoFile } from "@/lib/media-file";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sourceVideo = formData.get("video");

    if (!(sourceVideo instanceof File) || sourceVideo.size === 0) {
      return NextResponse.json(
        { error: "Upload a main source video to generate subtitles." },
        { status: 400 },
      );
    }
    if (!isLikelyVideoFile(sourceVideo)) {
      return NextResponse.json(
        { error: "Video must be a supported format (.mp4, .mov, .m4v, .webm, .mkv, .avi)." },
        { status: 400 },
      );
    }

    const subtitleLanguage =
      typeof formData.get("subtitleLanguage") === "string"
        ? (formData.get("subtitleLanguage") as string)
        : "en";

    if (requiresConfiguredVoskModelForTranscription()) {
      return NextResponse.json(
        { error: getSubtitleModelConfigError(subtitleLanguage) },
        { status: 400 },
      );
    }

    const generated = await generateSubtitlesFromSourceVideo({
      sourceVideo,
      subtitleLanguage,
    });
    const draft = await createRenderDraftFromStepOne({
      sourceVideo,
      subtitleContent: generated.content,
      subtitleFilename: generated.filename,
    });

    return NextResponse.json(
      {
        ...generated,
        draftId: draft.draftId,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate subtitle file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
