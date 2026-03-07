import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  getDownloadFilename,
  getDownloadStat,
  getDownloadStream,
} from "@/lib/video-editor";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const fileStat = await getDownloadStat(jobId);
    const stream = getDownloadStream(jobId);

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": fileStat.size.toString(),
        "Content-Disposition": `inline; filename="${getDownloadFilename(jobId)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "That rendered export could not be found." },
      { status: 404 },
    );
  }
}
