import { NextResponse } from "next/server";
import { createYouTubeAuthUrl, isYouTubeConfigured } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!isYouTubeConfigured()) {
      return NextResponse.json(
        {
          error:
            "YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.",
        },
        { status: 400 },
      );
    }

    const { url } = await createYouTubeAuthUrl();
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create YouTube auth URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
