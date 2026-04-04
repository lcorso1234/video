import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getPipelineStatusPath(jobId: string) {
  return path.join(process.cwd(), ".video-editor-jobs", jobId, "pipeline-status.json");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const content = await readFile(getPipelineStatusPath(jobId), "utf8");
    const status = JSON.parse(content) as Record<string, unknown>;
    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Render job not found." }, { status: 404 });
  }
}
