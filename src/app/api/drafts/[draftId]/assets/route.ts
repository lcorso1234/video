import { NextResponse } from "next/server";
import {
  getRenderDraft,
  updateRenderDraftAssets,
} from "@/lib/video-editor";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await context.params;
    const draft = await getRenderDraft(draftId);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    const formData = await request.formData();
    const subtitleEntry = formData.get("subtitleFile");
    const logoEntry = formData.get("logo");
    const subtitleFile =
      subtitleEntry instanceof File && subtitleEntry.size > 0
        ? subtitleEntry
        : null;
    const logoFile =
      logoEntry instanceof File && logoEntry.size > 0
        ? logoEntry
        : null;

    const updated = await updateRenderDraftAssets(draftId, {
      subtitleFile,
      logoFile,
    });

    return NextResponse.json(
      {
        draftId: updated.draftId,
        subtitleFilename: updated.subtitleFilename,
        logoFilename: updated.logoFilename,
        updatedAt: updated.updatedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save draft assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
