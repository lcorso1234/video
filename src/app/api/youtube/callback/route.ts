import { NextResponse } from "next/server";
import { handleYouTubeOAuthCallback } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code") || "";
  const state = requestUrl.searchParams.get("state") || "";
  const oauthError = requestUrl.searchParams.get("error") || "";
  const redirectBase = new URL("/", request.url);

  if (oauthError) {
    redirectBase.searchParams.set("youtube", "error");
    redirectBase.searchParams.set("message", oauthError);
    return NextResponse.redirect(redirectBase);
  }

  try {
    await handleYouTubeOAuthCallback(code, state);
    redirectBase.searchParams.set("youtube", "connected");
    return NextResponse.redirect(redirectBase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube connection failed.";
    redirectBase.searchParams.set("youtube", "error");
    redirectBase.searchParams.set("message", message);
    return NextResponse.redirect(redirectBase);
  }
}
