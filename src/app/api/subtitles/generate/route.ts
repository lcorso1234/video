import { NextResponse } from "next/server";
import {
  createRenderDraftFromStepOne,
  generateSubtitlesFromSourceVideo,
} from "@/lib/video-editor";

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

    if (!process.env.VOSK_MODEL_PATH?.trim()) {
      return NextResponse.json(
        {
          error:
            "Speech-to-text subtitles require VOSK_MODEL_PATH in the environment. Set it to a local Vosk model folder and restart the server.",
        },
        { status: 400 },
      );
    }

    const subtitleLanguage =
      typeof formData.get("subtitleLanguage") === "string"
        ? (formData.get("subtitleLanguage") as string)
        : "en";

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
