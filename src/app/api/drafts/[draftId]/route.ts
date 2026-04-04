import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getRenderDraft } from "@/lib/video-editor";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await context.params;
    const draft = await getRenderDraft(draftId);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    let subtitleContent: string | undefined;
    if (draft.subtitleStoredPath) {
      try {
        subtitleContent = await readFile(draft.subtitleStoredPath, "utf8");
      } catch {
        subtitleContent = undefined;
      }
    }

    return NextResponse.json(
      {
        draftId: draft.draftId,
        sourceFilename: draft.sourceFilename,
        subtitleFilename: draft.subtitleFilename,
        logoFilename: draft.logoFilename,
        subtitleContent,
        updatedAt: draft.updatedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
