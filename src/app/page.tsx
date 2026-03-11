"use client";

/* eslint-disable @next/next/no-img-element */

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { renderVideoInBrowser } from "@/lib/browser-renderer";

type RenderJobPhase = "queued" | "running" | "completed" | "failed";
type YouTubePublishPhase = "queued" | "uploading" | "completed" | "failed";
type YouTubePrivacyStatus = "private" | "unlisted" | "public";

type YouTubeConnectionStatus = {
  configured: boolean;
  connected: boolean;
  channelId?: string;
  channelTitle?: string;
  message?: string;
};

type YouTubePublishStatus = {
  status: YouTubePublishPhase;
  message: string;
  updatedAt: string;
  title?: string;
  privacyStatus?: YouTubePrivacyStatus;
  videoId?: string;
  videoUrl?: string;
  error?: string;
};

type RenderStatusResponse = {
  jobId: string;
  status: RenderJobPhase;
  progress: number;
  message: string;
  filename?: string;
  sizeInBytes?: number;
  error?: string;
  youtube?: YouTubePublishStatus | null;
};

type RenderResponse = {
  jobId: string;
  filename: string;
  downloadUrl: string;
  previewUrl?: string;
  sizeInBytes: number;
};

type AppPhase = 1 | 2 | 3;

const INTRO_OUTRO_BACKGROUND = "#6f7b86";
const ACCEPTED_LOGO_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ACCEPTED_LOGO_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp"];

function hasAcceptedLogoExtension(filename: string) {
  const lower = filename.toLowerCase();
  return ACCEPTED_LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isSvgLogoFile(file: File) {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function isAcceptedLogoFile(file: File) {
  return ACCEPTED_LOGO_TYPES.has(file.type) || hasAcceptedLogoExtension(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode image."));
    };
    image.src = objectUrl;
  });
}

async function extractRasterPalette(file: File) {
  const image = await loadImageElement(file);
  const sampleWidth = Math.max(1, Math.min(96, image.naturalWidth || image.width || 96));
  const sampleHeight = Math.max(1, Math.min(96, image.naturalHeight || image.height || 96));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const counts = new Map<string, number>();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 24) {
      continue;
    }

    const red = Math.round(data[index] / 16) * 16;
    const green = Math.round(data[index + 1] / 16) * 16;
    const blue = Math.round(data[index + 2] / 16) * 16;
    const hex = rgbToHex(red, green, blue);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([hex]) => hex)
    .slice(0, 8);
}

async function convertRasterLogoToSvg(file: File) {
  const image = await loadImageElement(file);
  const width = Math.max(1, image.naturalWidth || image.width || 512);
  const height = Math.max(1, image.naturalHeight || image.height || 512);
  const rasterPalette = await extractRasterPalette(file);
  const paletteNote =
    rasterPalette.length > 0 ? `\n  <desc>palette:${rasterPalette.join(",")}</desc>` : "";
  const dataUrl = await readFileAsDataUrl(file);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paletteNote}
  <image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
</svg>`;
  const baseName = stripFileExtension(file.name || "logo");
  return new File([svgMarkup], `${baseName || "logo"}.svg`, { type: "image/svg+xml" });
}

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed.slice(0, 6).toLowerCase()}`;
  }
  return null;
}

function parseRgbChannel(value: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function extractSvgPalette(svgText: string) {
  const collected = new Set<string>();
  const addColor = (color: string | null) => {
    if (!color) {
      return;
    }
    collected.add(color);
  };

  const hexMatches = svgText.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) || [];
  for (const match of hexMatches) {
    addColor(normalizeHexColor(match));
  }

  const rgbRegex = /rgba?\(([^)]+)\)/gi;
  let rgbMatch = rgbRegex.exec(svgText);
  while (rgbMatch) {
    const channels = rgbMatch[1].split(",").slice(0, 3);
    if (channels.length === 3) {
      const red = parseRgbChannel(channels[0]);
      const green = parseRgbChannel(channels[1]);
      const blue = parseRgbChannel(channels[2]);
      if (red !== null && green !== null && blue !== null) {
        addColor(rgbToHex(red, green, blue));
      }
    }
    rgbMatch = rgbRegex.exec(svgText);
  }

  return Array.from(collected).slice(0, 8);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [activePhase, setActivePhase] = useState<AppPhase>(1);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [logoPalette, setLogoPalette] = useState<string[]>([]);
  const [subtitleHighlightColor, setSubtitleHighlightColor] = useState("");
  const [logoPaletteError, setLogoPaletteError] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFormat, setVideoFormat] = useState<"short" | "wide">("wide");
  const [credits, setCredits] = useState(
    "Executive Producer - Name\nDirector - Name\nEditor - Name\nPresented by - Organization",
  );
  const [youtubeConnection, setYouTubeConnection] = useState<YouTubeConnectionStatus | null>(null);
  const [youtubeBusy, setYouTubeBusy] = useState(false);
  const [youtubeAutoPublish, setYouTubeAutoPublish] = useState(false);
  const [youtubeTitle, setYouTubeTitle] = useState("Produced Video");
  const [youtubeDescription, setYouTubeDescription] = useState("");
  const [youtubePrivacyStatus, setYouTubePrivacyStatus] = useState<YouTubePrivacyStatus>("private");
  const [youtubeTags, setYouTubeTags] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Phase 1: upload a logo image and confirm preview.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatusResponse | null>(null);
  const [result, setResult] = useState<RenderResponse | null>(null);
  const statusPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localResultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (statusPollerRef.current) {
        clearInterval(statusPollerRef.current);
        statusPollerRef.current = null;
      }
      if (localResultUrlRef.current) {
        URL.revokeObjectURL(localResultUrlRef.current);
        localResultUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  useEffect(() => {
    let cancelled = false;

    async function loadPalette() {
      if (!logoFile) {
        setLogoPalette([]);
        setSubtitleHighlightColor("");
        setLogoPaletteError("");
        return;
      }

      try {
        const content = await logoFile.text();
        if (cancelled) {
          return;
        }
        const palette = extractSvgPalette(content);
        setLogoPalette(palette);
        setSubtitleHighlightColor((current) =>
          current && palette.includes(current) ? current : (palette[0] || ""),
        );
        setLogoPaletteError(
          palette.length
            ? ""
            : "No usable brand colors were found in this logo. Try a higher-contrast image or SVG.",
        );
      } catch {
        if (cancelled) {
          return;
        }
        setLogoPalette([]);
        setSubtitleHighlightColor("");
        setLogoPaletteError("Unable to read logo colors.");
      }
    }

    void loadPalette();
    return () => {
      cancelled = true;
    };
  }, [logoFile]);

  useEffect(() => {
    if (!videoFile) {
      return;
    }

    setYouTubeTitle((current) => {
      if (!current.trim() || current === "Produced Video") {
        const cleaned = stripFileExtension(videoFile.name).trim();
        return cleaned || "Produced Video";
      }
      return current;
    });
  }, [videoFile]);

  const refreshYouTubeConnection = useCallback(async () => {
    try {
      const response = await fetch("/api/youtube/status", { cache: "no-store" });
      const payload = (await response.json()) as YouTubeConnectionStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Unable to load YouTube status.");
      }
      setYouTubeConnection(payload);
    } catch (error) {
      setYouTubeConnection({
        configured: false,
        connected: false,
        message: error instanceof Error ? error.message : "Unable to load YouTube status.",
      });
    }
  }, []);

  useEffect(() => {
    void refreshYouTubeConnection();
  }, [refreshYouTubeConnection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const youtubeState = params.get("youtube");
    const youtubeMessage = params.get("message");
    if (!youtubeState) {
      return;
    }

    void refreshYouTubeConnection();
    if (youtubeState === "connected") {
      setStatusMessage("YouTube account connected.");
      setErrorMessage("");
    } else if (youtubeState === "error") {
      setErrorMessage(youtubeMessage || "YouTube connection failed.");
    }

    params.delete("youtube");
    params.delete("message");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [refreshYouTubeConnection]);

  useEffect(() => {
    if (!activeRenderJobId || !isSubmitting) {
      if (statusPollerRef.current) {
        clearInterval(statusPollerRef.current);
        statusPollerRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/render/${activeRenderJobId}`, {
          cache: "no-store",
        });

        if (response.status === 404) {
          return;
        }

        const payload = (await response.json()) as RenderStatusResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to fetch render status.");
        }

        setRenderStatus(payload);
        const youtubeState = payload.youtube?.status;
        const youtubeInFlight =
          payload.status === "completed" && (youtubeState === "uploading" || youtubeState === "queued");
        if (youtubeInFlight) {
          setStatusMessage(payload.youtube?.message || payload.message || "Uploading to YouTube...");
        } else {
          setStatusMessage(payload.message || "Rendering...");
        }

        if (payload.status === "completed") {
          setResult((current) => {
            if (current?.jobId === payload.jobId) {
              return current;
            }
            return {
              jobId: payload.jobId,
              filename: payload.filename || `${payload.jobId}.mp4`,
              downloadUrl: `/api/download/${payload.jobId}`,
              previewUrl: `/api/preview/${payload.jobId}`,
              sizeInBytes: payload.sizeInBytes ?? 0,
            };
          });

          if (youtubeInFlight) {
            return;
          }

          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setIsSubmitting(false);
          setActiveRenderJobId(null);
          setErrorMessage("");
          return;
        }

        if (payload.status === "failed") {
          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setIsSubmitting(false);
          setActiveRenderJobId(null);
          setErrorMessage(payload.error || payload.message || "Render failed.");
        }
      } catch (error) {
        if (statusPollerRef.current) {
          clearInterval(statusPollerRef.current);
          statusPollerRef.current = null;
        }

        setIsSubmitting(false);
        setActiveRenderJobId(null);
        setErrorMessage(error instanceof Error ? error.message : "Render failed.");
      }
    };

    void pollStatus();
    statusPollerRef.current = setInterval(pollStatus, 1500);
  }, [activeRenderJobId, isSubmitting]);

  async function handleYouTubeConnect() {
    setYouTubeBusy(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/youtube/auth-url", { cache: "no-store" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Unable to start YouTube connection.");
      }

      window.location.href = payload.url;
    } catch (error) {
      setYouTubeBusy(false);
      setErrorMessage(error instanceof Error ? error.message : "Unable to start YouTube connection.");
    }
  }

  async function handleYouTubeDisconnect() {
    setYouTubeBusy(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/youtube/disconnect", {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to disconnect YouTube.");
      }

      setYouTubeAutoPublish(false);
      await refreshYouTubeConnection();
      setStatusMessage("YouTube account disconnected.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to disconnect YouTube.");
    } finally {
      setYouTubeBusy(false);
    }
  }

  async function handleRender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!logoFile) {
      setErrorMessage("Upload a logo in phase 1 first.");
      setActivePhase(1);
      return;
    }

    if (!videoFile) {
      setErrorMessage("Upload a video in phase 2 before producing.");
      setActivePhase(2);
      return;
    }

    if (!subtitleHighlightColor || !logoPalette.includes(subtitleHighlightColor)) {
      setErrorMessage("Choose a subtitle highlight color from your logo palette in phase 1.");
      setActivePhase(1);
      return;
    }

    if (youtubeAutoPublish) {
      setErrorMessage(
        "YouTube auto-post is server-only. Disable it for browser-only local rendering.",
      );
      setActivePhase(3);
      return;
    }

    if (statusPollerRef.current) {
      clearInterval(statusPollerRef.current);
      statusPollerRef.current = null;
    }

    setErrorMessage("");
    if (localResultUrlRef.current) {
      URL.revokeObjectURL(localResultUrlRef.current);
      localResultUrlRef.current = null;
    }
    setResult(null);
    setIsSubmitting(true);
    setRenderStatus({
      jobId: "",
      status: "queued",
      progress: 0,
      message: "Preparing render job...",
    });
    setStatusMessage("Preparing render job...");

    try {
      const localJobId = `local-${Date.now()}`;
      const output = await renderVideoInBrowser({
        sourceVideoFile: videoFile,
        logoFile,
        videoFormat,
        credits,
        backgroundColor: INTRO_OUTRO_BACKGROUND,
        onProgress: (progress, message) => {
          const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
          setRenderStatus({
            jobId: localJobId,
            status: percent >= 100 ? "completed" : "running",
            progress: percent,
            message,
          });
          setStatusMessage(message);
        },
      });

      if (localResultUrlRef.current) {
        URL.revokeObjectURL(localResultUrlRef.current);
      }
      const localResultUrl = URL.createObjectURL(output.blob);
      localResultUrlRef.current = localResultUrl;

      setResult({
        jobId: localJobId,
        filename: output.filename,
        downloadUrl: localResultUrl,
        previewUrl: localResultUrl,
        sizeInBytes: output.blob.size,
      });
      setRenderStatus({
        jobId: localJobId,
        status: "completed",
        progress: 100,
        message: "Local browser render complete.",
      });
      setStatusMessage("Local browser render complete.");
      setIsSubmitting(false);
      setActiveRenderJobId(null);
      setErrorMessage("");
    } catch (error) {
      setIsSubmitting(false);
      setActiveRenderJobId(null);
      setRenderStatus(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to start render.");
      setStatusMessage("Render did not complete.");
    }
  }

  const phase1Complete = Boolean(logoFile) && logoPalette.length > 0 && Boolean(subtitleHighlightColor);
  const phase2Complete = Boolean(videoFile);
  const phase2Unlocked = activePhase >= 2;
  const phase3Unlocked = activePhase >= 3;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 text-[#e6edf1] sm:px-10">
      <img
        src="/design.svg"
        alt="Design mark"
        className="pointer-events-none absolute left-7 top-7 h-10 w-auto object-contain sm:left-16 sm:top-7 sm:h-12"
      />
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <form onSubmit={handleRender} className="space-y-6">
          <section className="rounded-3xl border border-[#667684]/35 bg-[#1e272f]/72 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-[#94a1ac]">Phase 1</p>
            <h2 className="mt-1 text-xl font-semibold">Intro & Outro Maker</h2>
            <p className="mt-2 text-sm text-[#b8c3cb]">
              Logo fades from white to full color on background
              <span className="font-semibold text-[#e6edf1]"> {INTRO_OUTRO_BACKGROUND}</span>.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
                <span className="text-sm text-[#d6dde2]">Upload logo (.svg, .png, .jpg, .webp)</span>
                <input
                  type="file"
                  accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp"
                  onChange={async (event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    if (nextFile) {
                      if (!isAcceptedLogoFile(nextFile)) {
                        setLogoFile(null);
                        setErrorMessage("Logo must be .svg, .png, .jpg/.jpeg, or .webp.");
                        return;
                      }
                    }

                    let processedFile: File | null = nextFile;
                    if (nextFile && !isSvgLogoFile(nextFile)) {
                      try {
                        processedFile = await convertRasterLogoToSvg(nextFile);
                      } catch {
                        setLogoFile(null);
                        setErrorMessage("Unable to convert logo image to SVG.");
                        return;
                      }
                    }

                    setErrorMessage("");
                    setLogoFile(processedFile);
                    setVideoFile(null);
                    if (localResultUrlRef.current) {
                      URL.revokeObjectURL(localResultUrlRef.current);
                      localResultUrlRef.current = null;
                    }
                    setResult(null);
                    setRenderStatus(null);
                    setStatusMessage(
                      nextFile && !isSvgLogoFile(nextFile)
                        ? "Phase 1 ready. Image logo converted to SVG for intro/outro rendering."
                        : "Phase 1 ready. Review the preview, then continue to phase 2.",
                    );
                    setActivePhase(1);
                  }}
                  className="block text-sm text-[#e6edf1] file:mr-4 file:rounded-full file:border-0 file:bg-[#aab6bf] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[#161d22]"
                />
              </label>

              <div className="rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
                <p className="text-sm text-[#d6dde2]">Preview (Intro + Outro)</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {["Intro", "Outro"].map((label) => (
                    <div key={label} className="rounded-xl border border-[#3a4752]/55 p-2">
                      <p className="mb-2 text-center text-xs uppercase tracking-[0.12em] text-[#95a3ae]">
                        {label}
                      </p>
                      <div
                        className="flex h-36 items-center justify-center rounded-lg"
                        style={{ backgroundColor: INTRO_OUTRO_BACKGROUND }}
                      >
                        {logoPreviewUrl ? (
                          <div className="relative h-24 w-24 sm:h-28 sm:w-28">
                            <img
                              src={logoPreviewUrl}
                              alt="Brand logo full color"
                              className="preview-color-layer absolute inset-0 h-full w-full object-contain"
                            />
                            <img
                              src={logoPreviewUrl}
                              alt="Brand logo white"
                              className="preview-white-layer absolute inset-0 h-full w-full object-contain"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-[#d7dee3]/80">Upload logo to preview</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <p className="text-sm text-[#d6dde2]">Subtitle highlight color (from logo only)</p>
              {logoPalette.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {logoPalette.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSubtitleHighlightColor(color)}
                      className={`h-10 w-10 rounded-full border-2 transition ${
                        subtitleHighlightColor === color
                          ? "border-[#d2d9de]"
                          : "border-[#7a8a97]/55 hover:border-[#c4ced5]/70"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Pick ${color}`}
                      title={color}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-[#a8b4be]">
                  Upload a logo to extract available brand colors.
                </p>
              )}
              {subtitleHighlightColor ? (
                <p className="mt-2 text-xs text-[#b1bcc5]">
                  Selected subtitle highlight:{" "}
                  <span className="font-semibold text-[#e6edf1]">{subtitleHighlightColor}</span>
                </p>
              ) : null}
              {logoPaletteError ? (
                <p className="mt-2 text-xs text-amber-200">{logoPaletteError}</p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!phase1Complete}
                onClick={() => {
                  if (!phase1Complete) {
                    setErrorMessage(
                      logoPaletteError || "Upload a logo with usable brand colors first.",
                    );
                    return;
                  }
                  setErrorMessage("");
                  setActivePhase(2);
                  setStatusMessage("Phase 2 unlocked. Upload your video.");
                }}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#aab6bf] px-5 text-sm font-semibold text-[#161d22] transition hover:bg-[#bec8cf] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Continue to Phase 2
              </button>
            </div>
          </section>

          <section
            className={`rounded-3xl border border-[#667684]/35 bg-[#1e272f]/72 p-6 ${
              phase2Unlocked ? "" : "opacity-55"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#94a1ac]">Phase 2</p>
            <h2 className="mt-1 text-xl font-semibold">Upload Video</h2>

            <label className="mt-4 grid gap-2 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <span className="text-sm text-[#d6dde2]">Main video file</span>
              <input
                type="file"
                accept="video/*"
                disabled={!phase2Unlocked}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setVideoFile(nextFile);
                  if (localResultUrlRef.current) {
                    URL.revokeObjectURL(localResultUrlRef.current);
                    localResultUrlRef.current = null;
                  }
                  setResult(null);
                  setRenderStatus(null);
                  if (nextFile) {
                    setErrorMessage("");
                    setStatusMessage("Phase 2 ready. Continue to phase 3 for subtitles and render.");
                  }
                }}
                className="block text-sm text-[#e6edf1] file:mr-4 file:rounded-full file:border-0 file:bg-[#aab6bf] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[#161d22] disabled:opacity-55"
              />
              {videoFile ? <span className="text-xs text-[#b1bcc5]">Selected: {videoFile.name}</span> : null}
            </label>

            <div className="mt-4 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <p className="text-sm text-[#d6dde2]">Video format</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!phase2Unlocked}
                  onClick={() => setVideoFormat("short")}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    videoFormat === "short"
                      ? "bg-[#aab6bf] text-[#161d22]"
                      : "border border-[#7a8a97]/55 bg-transparent text-[#dbe2e8] hover:bg-[#9ba9b3]/15"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  TikTok (9:16)
                </button>
                <button
                  type="button"
                  disabled={!phase2Unlocked}
                  onClick={() => setVideoFormat("wide")}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    videoFormat === "wide"
                      ? "bg-[#aab6bf] text-[#161d22]"
                      : "border border-[#7a8a97]/55 bg-transparent text-[#dbe2e8] hover:bg-[#9ba9b3]/15"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  Landscape (16:9)
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActivePhase(1)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#7a8a97]/45 px-5 text-sm font-semibold text-[#dde4e9] transition hover:bg-[#9ba9b3]/15"
              >
                Back to Phase 1
              </button>
              <button
                type="button"
                disabled={!phase2Unlocked || !phase2Complete}
                onClick={() => {
                  if (!videoFile) {
                    setErrorMessage("Upload your video before continuing.");
                    return;
                  }
                  setErrorMessage("");
                  setActivePhase(3);
                  setStatusMessage("Phase 3 unlocked. Add subtitles and produce.");
                }}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#aab6bf] px-5 text-sm font-semibold text-[#161d22] transition hover:bg-[#bec8cf] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Continue to Phase 3
              </button>
            </div>
          </section>

          <section
            className={`rounded-3xl border border-[#667684]/35 bg-[#1e272f]/72 p-6 ${
              phase3Unlocked ? "" : "opacity-55"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#94a1ac]">Phase 3</p>
            <h2 className="mt-1 text-xl font-semibold">Add Subtitles & Produce</h2>

            <div className="mt-4 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <p className="text-sm text-[#d6dde2]">
                Browser-only mode prioritizes fast local rendering. Auto subtitle generation is disabled.
              </p>
              <p className="mt-1 text-xs text-[#a8b4be]">
                Highlight color is locked to your logo palette:
                <span className="font-semibold text-[#e6edf1]"> {subtitleHighlightColor || "not selected"}</span>.
              </p>
            </div>

            <label className="mt-4 grid gap-2 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <span className="text-sm text-[#d6dde2]">Credits</span>
              <textarea
                value={credits}
                onChange={(event) => setCredits(event.target.value)}
                rows={4}
                placeholder="Enter one credit per line"
                className="rounded-xl border border-[#667684]/35 bg-[#2b3640] px-3 py-2.5 text-[#e6edf1]"
              />
              <span className="text-xs text-[#9eabb6]">
                These lines will appear below the logo in the outro.
              </span>
            </label>

            <div className="mt-4 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <p className="text-sm text-[#d6dde2]">YouTube Sync</p>

              {!youtubeConnection?.configured ? (
                <p className="mt-2 text-xs text-amber-200">
                  Set <span className="font-semibold text-[#e6edf1]">YOUTUBE_CLIENT_ID</span> and{" "}
                  <span className="font-semibold text-[#e6edf1]">YOUTUBE_CLIENT_SECRET</span> on the
                  server to enable YouTube posting.
                </p>
              ) : null}

              {youtubeConnection?.configured && !youtubeConnection.connected ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={youtubeBusy}
                    onClick={handleYouTubeConnect}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-[#aab6bf] px-4 text-sm font-semibold text-[#161d22] transition hover:bg-[#bec8cf] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {youtubeBusy ? "Connecting..." : "Connect YouTube"}
                  </button>
                  <span className="text-xs text-[#b1bcc5]">
                    {youtubeConnection.message || "Connect your account to enable auto-post."}
                  </span>
                </div>
              ) : null}

              {youtubeConnection?.configured && youtubeConnection.connected ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[#bcc7cf]">
                    <span>
                      Connected:
                      <span className="font-semibold text-[#e6edf1]">
                        {" "}
                        {youtubeConnection.channelTitle || youtubeConnection.channelId || "YouTube account"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={youtubeBusy}
                      onClick={handleYouTubeDisconnect}
                      className="inline-flex h-9 items-center justify-center rounded-full border border-[#7a8a97]/45 px-3 text-xs font-semibold text-[#dde4e9] transition hover:bg-[#9ba9b3]/15 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      Disconnect
                    </button>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#d0d8de]">
                    <input
                      type="checkbox"
                      checked={youtubeAutoPublish}
                      onChange={(event) => setYouTubeAutoPublish(event.target.checked)}
                      className="h-4 w-4 rounded border-[#7a8a97]/55 bg-transparent"
                    />
                    Auto-post this render to YouTube
                  </label>

                  {youtubeAutoPublish ? (
                    <div className="grid gap-3">
                      <label className="grid gap-1.5 text-xs text-[#b8c3cb]">
                        <span>YouTube title</span>
                        <input
                          type="text"
                          maxLength={100}
                          value={youtubeTitle}
                          onChange={(event) => setYouTubeTitle(event.target.value)}
                          className="rounded-xl border border-[#667684]/35 bg-[#2b3640] px-3 py-2.5 text-sm text-[#e6edf1]"
                        />
                      </label>
                      <label className="grid gap-1.5 text-xs text-[#b8c3cb]">
                        <span>Description</span>
                        <textarea
                          rows={3}
                          maxLength={5000}
                          value={youtubeDescription}
                          onChange={(event) => setYouTubeDescription(event.target.value)}
                          className="rounded-xl border border-[#667684]/35 bg-[#2b3640] px-3 py-2.5 text-sm text-[#e6edf1]"
                        />
                      </label>
                      <div className="grid gap-1.5 text-xs text-[#b8c3cb]">
                        <span>Privacy</span>
                        <div className="flex flex-wrap gap-2">
                          {(["private", "unlisted", "public"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setYouTubePrivacyStatus(value)}
                              className={`inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-semibold transition ${
                                youtubePrivacyStatus === value
                                  ? "bg-[#aab6bf] text-[#161d22]"
                                  : "border border-[#7a8a97]/55 text-[#e6edf1] hover:bg-[#9ba9b3]/15"
                              }`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="grid gap-1.5 text-xs text-[#b8c3cb]">
                        <span>Tags (comma separated, optional)</span>
                        <input
                          type="text"
                          value={youtubeTags}
                          onChange={(event) => setYouTubeTags(event.target.value)}
                          className="rounded-xl border border-[#667684]/35 bg-[#2b3640] px-3 py-2.5 text-sm text-[#e6edf1]"
                          placeholder="brand, interview, wellness"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setActivePhase(2)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#7a8a97]/45 px-5 text-sm font-semibold text-[#dde4e9] transition hover:bg-[#9ba9b3]/15"
              >
                Back to Phase 2
              </button>
              <button
                type="submit"
                disabled={
                  !phase3Unlocked ||
                  !logoFile ||
                  !videoFile ||
                  isSubmitting ||
                  (youtubeAutoPublish && !youtubeConnection?.connected)
                }
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#aab6bf] px-5 text-sm font-semibold text-[#161d22] transition hover:bg-[#bec8cf] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSubmitting ? "Producing..." : "Produce Video"}
              </button>
            </div>
          </section>
        </form>

        <section className="rounded-3xl border border-[#667684]/35 bg-[#1e272f]/72 p-6">
          <h3 className="text-lg font-semibold">Render Status</h3>
          <p className="mt-2 text-sm text-[#bcc7cf]">{statusMessage}</p>

          {renderStatus ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-[#667684]/35 bg-[#242f38]/70 p-4">
              <div className="flex items-center justify-between text-sm text-[#bcc7cf]">
                <span>{renderStatus.status.toUpperCase()}</span>
                <span>{renderStatus.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#83919c]/35">
                <div
                  className={`h-full rounded-full transition-all ${
                    renderStatus.status === "failed" ? "bg-red-400" : "bg-[#aab6bf]"
                  }`}
                  style={{ width: `${renderStatus.progress}%` }}
                />
              </div>
              <p className="text-xs text-[#b1bcc5]">{renderStatus.message}</p>
              {renderStatus.youtube ? (
                <div className="rounded-xl border border-[#5f6e7b]/40 bg-[#2b3640]/70 p-3">
                  <p className="text-xs text-[#b1bcc5]">
                    YouTube:{" "}
                    <span className="font-semibold text-[#e6edf1]">
                      {renderStatus.youtube.status.toUpperCase()}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[#b8c3cb]">{renderStatus.youtube.message}</p>
                  {renderStatus.youtube.videoUrl ? (
                    <a
                      href={renderStatus.youtube.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-xs font-semibold text-[#ccd6dd] underline-offset-2 hover:underline"
                    >
                      Open on YouTube
                    </a>
                  ) : null}
                  {renderStatus.youtube.error ? (
                    <p className="mt-1 text-xs text-red-200">{renderStatus.youtube.error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-400/35 bg-red-400/10 p-3 text-sm text-red-100">
              {errorMessage}
            </div>
          ) : null}

          {result ? (
            <div className="mt-5 space-y-4 rounded-2xl border border-[#90a0ad]/45 bg-[#aab6bf]/10 p-4">
              <div>
                <p className="text-sm text-[#d5dde3]">Render complete</p>
                <p className="text-lg font-semibold text-[#e6edf1]">{result.filename}</p>
                <p className="text-xs text-[#b8c3cb]">Size: {formatBytes(result.sizeInBytes)}</p>
              </div>

              {result.previewUrl ? (
                <div className="overflow-hidden rounded-2xl border border-[#667684]/35 bg-[#2b3640]/78">
                  <video
                    key={result.jobId}
                    controls
                    preload="metadata"
                    className="h-auto w-full"
                    src={result.previewUrl}
                  />
                </div>
              ) : null}

              <a
                href={result.downloadUrl}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#aab6bf] px-5 text-sm font-semibold text-[#161d22] transition hover:bg-[#bec8cf]"
              >
                Download Final Video
              </a>

              {renderStatus?.youtube?.videoUrl ? (
                <a
                  href={renderStatus.youtube.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[#90a0ad]/50 px-5 text-sm font-semibold text-[#d5dde3] transition hover:bg-[#8f9ca7]/15"
                >
                  Open on YouTube
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <style jsx>{`
        .preview-color-layer {
          animation: preview-logo-color-in 2.8s cubic-bezier(0.2, 0.78, 0.3, 1) infinite;
          transform-origin: center;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }

        .preview-white-layer {
          filter: brightness(0) saturate(100%) invert(100%);
          animation: preview-logo-white-out 2.8s cubic-bezier(0.2, 0.78, 0.3, 1) infinite;
          transform-origin: center;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }

        @keyframes preview-logo-color-in {
          0% {
            opacity: 0.14;
            transform: scale(0.92);
            filter: saturate(82%) brightness(1.1);
          }
          35% {
            opacity: 0.42;
            transform: scale(0.95);
            filter: saturate(88%) brightness(1.07);
          }
          68% {
            opacity: 1;
            transform: scale(1);
            filter: none;
          }
          100% {
            opacity: 1;
            transform: scale(1);
            filter: none;
          }
        }

        @keyframes preview-logo-white-out {
          0% {
            opacity: 1;
            transform: scale(0.92);
          }
          35% {
            opacity: 0.78;
            transform: scale(0.95);
          }
          68% {
            opacity: 0;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(1);
          }
        }
      `}</style>
    </main>
  );
}
