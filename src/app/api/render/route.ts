import { NextResponse } from "next/server";
import { renderVideo } from "@/lib/video-editor";

export const runtime = "nodejs";

function getOptionalVideo(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  return value;
}

function getNumberValue(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getTextValue(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getBooleanValue(value: FormDataEntryValue | null, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value === "true" || value === "1" || value === "on";
}

function getQualityProfile(
  value: FormDataEntryValue | null,
): "fast" | "balanced" | "high" {
  if (value === "fast" || value === "balanced" || value === "high") {
    return value;
  }

  return "high";
}

function getSoundtrackChoice(
  value: FormDataEntryValue | null,
): "startup-chime" | "spirited-blues" {
  if (value === "startup-chime" || value === "spirited-blues") {
    return value;
  }

  return "spirited-blues";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sourceVideo = formData.get("video");

    if (!(sourceVideo instanceof File) || sourceVideo.size === 0) {
      return NextResponse.json(
        { error: "Upload a main source video to render the export." },
        { status: 400 },
      );
    }

    const result = await renderVideo({
      sourceVideo,
      introVideo: getOptionalVideo(formData.get("intro")),
      outroVideo: getOptionalVideo(formData.get("outro")),
      brandLogo: getOptionalVideo(formData.get("logo")),
      generateTrailerIntroOutro: getBooleanValue(
        formData.get("generateTrailerIntroOutro"),
        true,
      ),
      trailerTitle: getTextValue(formData.get("trailerTitle"), "COMING UP NEXT"),
      trailerSubtitle: getTextValue(
        formData.get("trailerSubtitle"),
        "A cinematic AI-finished trailer",
      ),
      trailerOutroTitle: getTextValue(
        formData.get("trailerOutroTitle"),
        "THANK YOU FOR WATCHING",
      ),
      trailerOutroSubtitle: getTextValue(
        formData.get("trailerOutroSubtitle"),
        "Stay tuned for the next release",
      ),
      trailerDuration: getNumberValue(formData.get("trailerDuration"), 3.5),
      backgroundColor: getTextValue(formData.get("backgroundColor"), "#050816"),
      textColor: getTextValue(formData.get("textColor"), "#f8fafc"),
      accentColor: getTextValue(formData.get("accentColor"), "#4f80ff"),
      fontChoice: getTextValue(formData.get("fontChoice"), "Poppins"),
      qualityProfile: getQualityProfile(formData.get("qualityProfile")),
      soundtrackChoice: getSoundtrackChoice(formData.get("soundtrackChoice")),
      lowerThirdTitle: getTextValue(formData.get("lowerThirdTitle")),
      lowerThirdSubtitle: getTextValue(formData.get("lowerThirdSubtitle")),
      lowerThirdStart: getNumberValue(formData.get("lowerThirdStart"), 4),
      lowerThirdDuration: getNumberValue(formData.get("lowerThirdDuration"), 6),
    });

    return NextResponse.json({
      jobId: result.jobId,
      filename: result.filename,
      downloadUrl: `/api/download/${result.jobId}`,
      sizeInBytes: result.sizeInBytes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video rendering failed unexpectedly.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
