import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const UPLOAD_PATH_PREFIX = "video-maker/";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const payload = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PATH_PREFIX)) {
          throw new Error("Invalid upload path.");
        }

        return {
          allowedContentTypes: ["video/*"],
          maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        void 0;
      },
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to authorize upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
