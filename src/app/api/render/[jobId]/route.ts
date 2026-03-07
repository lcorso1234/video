import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getRenderJobStatus } from "@/lib/video-editor";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const pipelineStatusPath = path.join(
      process.cwd(),
      ".video-editor-jobs",
      jobId,
      "pipeline-status.json",
    );
    try {
      const pipelineContent = await readFile(pipelineStatusPath, "utf8");
      return NextResponse.json(JSON.parse(pipelineContent), {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch {
      void 0;
    }

    const status = await getRenderJobStatus(jobId);

    if (!status) {
      return NextResponse.json({ error: "Render job not found." }, { status: 404 });
    }

    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Render job not found." }, { status: 404 });
  }
}
