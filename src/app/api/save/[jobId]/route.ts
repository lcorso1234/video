import { NextResponse } from "next/server";
import { saveRenderArtifactsToSafeFolder } from "@/lib/video-editor";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const saved = await saveRenderArtifactsToSafeFolder(jobId);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "Rendered files for that job were not found." },
        { status: 404 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unable to save render files to Mac safe folder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
