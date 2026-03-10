import { NextResponse } from "next/server";
import { getYouTubeConnectionStatus } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getYouTubeConnectionStatus();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load YouTube status.";
    return NextResponse.json(
      {
        configured: false,
        connected: false,
        message,
      },
      { status: 500 },
    );
  }
}
