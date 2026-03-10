import { NextResponse } from "next/server";
import { disconnectYouTube } from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST() {
  try {
    await disconnectYouTube();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to disconnect YouTube.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
