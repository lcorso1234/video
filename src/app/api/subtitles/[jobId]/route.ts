import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  getSubtitleFilename,
  getSubtitleStat,
  getSubtitleStream,
} from "@/lib/video-editor";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const fileStat = await getSubtitleStat(jobId);
    const stream = getSubtitleStream(jobId);

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Length": fileStat.size.toString(),
        "Content-Disposition": `attachment; filename="${getSubtitleFilename(jobId)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "That subtitle file could not be found." },
      { status: 404 },
    );
  }
}
