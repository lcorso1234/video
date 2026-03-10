import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const UPLOAD_PATH_PREFIX = "video-maker/";

function sanitizeToken(value: string | undefined) {
  if (!value) {
    return "";
  }
  return value.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

function resolveBlobReadWriteToken() {
  const preferredKeys = [
    "BLOB_READ_WRITE_TOKEN",
    "VIDEO_BLOB_READ_WRITE_TOKEN",
    "VERCEL_BLOB_READ_WRITE_TOKEN",
  ];

  for (const key of preferredKeys) {
    const token = sanitizeToken(process.env[key]);
    if (token) {
      return token;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.endsWith("_READ_WRITE_TOKEN")) {
      continue;
    }
    if (!key.includes("BLOB")) {
      continue;
    }
    const token = sanitizeToken(value);
    if (token) {
      return token;
    }
  }

  return "";
}

export async function POST(request: Request) {
  try {
    const token = resolveBlobReadWriteToken();
    if (!token) {
      throw new Error(
        "Missing Blob token. Set BLOB_READ_WRITE_TOKEN (or *_BLOB_READ_WRITE_TOKEN) in this Vercel environment and redeploy.",
      );
    }

    const body = (await request.json()) as HandleUploadBody;
    const payload = await handleUpload({
      token,
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
    console.error("[/api/uploads] token generation failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
