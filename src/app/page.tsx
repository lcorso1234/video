"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

type RenderResponse = {
  jobId: string;
  filename: string;
  downloadUrl: string;
  previewUrl?: string;
  sizeInBytes: number;
};

type SaveToMacResponse = {
  destinationFolder: string;
  videoPath: string;
  videoFilename: string;
  subtitlePath?: string;
  subtitleFilename?: string;
};

type Step1SubtitleResponse = {
  filename: string;
  content: string;
  language: string;
  draftId: string;
};

type DraftStateResponse = {
  draftId: string;
  sourceFilename: string;
  subtitleFilename?: string;
  logoFilename?: string;
  subtitleContent?: string;
  updatedAt?: string;
  error?: string;
};

type RenderJobPhase = "queued" | "running" | "completed" | "failed";
type WizardStep = 1 | 2 | 3 | 4;

type RenderStatusResponse = {
  jobId: string;
  status: RenderJobPhase;
  progress: number;
  message: string;
  filename?: string;
  subtitleFilename?: string;
  sizeInBytes?: number;
  error?: string;
  updatedAt?: string;
};

const googleFonts = [
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Lato",
  "Oswald",
  "Raleway",
  "Nunito",
  "Work Sans",
  "Source Sans 3",
  "Inter",
  "Ubuntu",
  "PT Sans",
  "Josefin Sans",
  "Bebas Neue",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "Noto Serif",
  "Libre Baskerville",
  "Cormorant Garamond",
  "Arvo",
  "DM Serif Display",
  "Abril Fatface",
  "Space Grotesk",
  "Titillium Web",
  "Barlow Condensed",
  "Anton",
  "Fira Sans",
  "Inconsolata",
] as const;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const draftStorageKey = "video_editor_wizard_draft_id";

export default function Home() {
  const appleSubtitleFontSize = 48;
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [introMusicFile, setIntroMusicFile] = useState<File | null>(null);
  const [outroMusicFile, setOutroMusicFile] = useState<File | null>(null);
  const [videoFormat, setVideoFormat] = useState<"short" | "wide">("wide");

  const [fontChoice, setFontChoice] = useState<(typeof googleFonts)[number]>("Poppins");
  const [qualityProfile, setQualityProfile] = useState<"fast" | "balanced" | "high">(
    "fast",
  );
  const [soundtrackChoice, setSoundtrackChoice] = useState<
    "startup-chime" | "spirited-blues" | "theater-chime" | "trailer-braam" | "piano-lift"
  >("theater-chime");
  const [generateTrailerIntroOutro, setGenerateTrailerIntroOutro] = useState(true);
  const [backgroundColor, setBackgroundColor] = useState("#050816");
  const [textColor, setTextColor] = useState("#f8fafc");
  const [accentColor, setAccentColor] = useState("#4f80ff");
  const [subtitleFontChoice, setSubtitleFontChoice] =
    useState<(typeof googleFonts)[number]>("Poppins");
  const [subtitleHighlightColor, setSubtitleHighlightColor] = useState("#E6FF00");
  const [renderSpeedMode, setRenderSpeedMode] = useState<"turbo" | "balanced" | "quality">(
    "turbo",
  );

  const [trailerTitle, setTrailerTitle] = useState("COMING UP NEXT");
  const [trailerSubtitle, setTrailerSubtitle] = useState("Hey Siri, come in here.");
  const [trailerOutroTitle, setTrailerOutroTitle] = useState("THANK YOU FOR WATCHING");
  const [trailerOutroSubtitle, setTrailerOutroSubtitle] = useState(
    "Stay tuned for the next release",
  );
  const [outroCredits, setOutroCredits] = useState(
    "Executive Producer - Name\nDirector - Name\nEditor - Name\nPresented by - Organization",
  );
  const [trailerDuration, setTrailerDuration] = useState("3.5");

  const [lowerThirdTitle, setLowerThirdTitle] = useState("Tamillow Institute");
  const [lowerThirdSubtitle, setLowerThirdSubtitle] = useState("Maureen Tamillow, LCPC");
  const [lowerThirdStart, setLowerThirdStart] = useState("4");
  const [lowerThirdDuration, setLowerThirdDuration] = useState("6");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Step 1: upload source video. Step 2: configure branding/subtitles. Step 3: render. Step 4: preview and download.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<RenderResponse | null>(null);
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatusResponse | null>(null);
  const [isSavingToMac, setIsSavingToMac] = useState(false);
  const [savedToMacPath, setSavedToMacPath] = useState("");
  const [saveToMacError, setSaveToMacError] = useState("");
  const [isGeneratingSrt, setIsGeneratingSrt] = useState(false);
  const [step1SrtMessage, setStep1SrtMessage] = useState("");
  const [draftId, setDraftId] = useState("");
  const [step2SaveMessage, setStep2SaveMessage] = useState("");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const statusPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (statusPollerRef.current) {
        clearInterval(statusPollerRef.current);
        statusPollerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!subtitleInputRef.current) {
      return;
    }

    if (!subtitleFile) {
      subtitleInputRef.current.value = "";
      return;
    }

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(subtitleFile);
      subtitleInputRef.current.files = dataTransfer.files;
    } catch {
      void 0;
    }
  }, [subtitleFile]);

  useEffect(() => {
    if (!draftId) {
      localStorage.removeItem(draftStorageKey);
      return;
    }

    localStorage.setItem(draftStorageKey, draftId);
  }, [draftId]);

  useEffect(() => {
    const restoreDraftId = localStorage.getItem(draftStorageKey);
    if (!restoreDraftId) {
      return;
    }

    const restoreDraft = async () => {
      try {
        const response = await fetch(`/api/drafts/${restoreDraftId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DraftStateResponse;
        if (!response.ok) {
          localStorage.removeItem(draftStorageKey);
          return;
        }

        setDraftId(payload.draftId);
        if (payload.subtitleContent) {
          const restoredSubtitleFile = new File(
            [payload.subtitleContent],
            payload.subtitleFilename || "subtitles.srt",
            { type: "application/x-subrip; charset=utf-8" },
          );
          setSubtitleFile(restoredSubtitleFile);
        }
        setStep2SaveMessage(
          `Restored backend draft${payload.subtitleFilename ? ` | Subtitle: ${payload.subtitleFilename}` : ""}${payload.logoFilename ? ` | Logo: ${payload.logoFilename}` : ""}`,
        );
        setStatusMessage("Restored saved pipeline draft from backend.");
      } catch {
        localStorage.removeItem(draftStorageKey);
      }
    };

    void restoreDraft();
  }, []);

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

        const payload = (await response.json()) as RenderStatusResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to get render status.");
        }

        setRenderStatus(payload);
        setStatusMessage(payload.message);

        if (payload.status === "completed") {
          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setActiveRenderJobId(null);
          setIsSubmitting(false);
          setResult({
            jobId: payload.jobId,
            filename: payload.filename || `${payload.jobId}.mp4`,
            downloadUrl: `/api/download/${payload.jobId}`,
            previewUrl: `/api/preview/${payload.jobId}`,
            sizeInBytes: payload.sizeInBytes ?? 0,
          });
          setWizardStep(4);
          setErrorMessage("");
          return;
        }

        if (payload.status === "failed") {
          if (statusPollerRef.current) {
            clearInterval(statusPollerRef.current);
            statusPollerRef.current = null;
          }

          setActiveRenderJobId(null);
          setIsSubmitting(false);
          setErrorMessage(payload.error || payload.message || "Render failed.");
        }
      } catch (error) {
        if (statusPollerRef.current) {
          clearInterval(statusPollerRef.current);
          statusPollerRef.current = null;
        }

        setActiveRenderJobId(null);
        setIsSubmitting(false);
        setErrorMessage(error instanceof Error ? error.message : "Unable to get render status.");
      }
    };

    void pollStatus();
    statusPollerRef.current = setInterval(pollStatus, 1500);
  }, [activeRenderJobId, isSubmitting]);

  async function handleRender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!videoFile) {
      setErrorMessage("Please upload a main video file.");
      return;
    }

    if (statusPollerRef.current) {
      clearInterval(statusPollerRef.current);
      statusPollerRef.current = null;
    }

    setErrorMessage("");
    setSaveToMacError("");
    setSavedToMacPath("");
    setResult(null);
    setRenderStatus({
      jobId: "",
      status: "queued",
      progress: 0,
      message: "Preparing render job...",
    });
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      if (videoFile) {
        formData.append("video", videoFile);
      }
      if (draftId) {
        formData.append("draftId", draftId);
      }
      if (logoFile) {
        formData.append("logo", logoFile);
      }
      if (subtitleFile) {
        formData.append("subtitleFile", subtitleFile);
      }
      if (generateTrailerIntroOutro && introMusicFile) {
        formData.append("introMusic", introMusicFile);
      }
      if (generateTrailerIntroOutro && outroMusicFile) {
        formData.append("outroMusic", outroMusicFile);
      }

      formData.append(
        "generateTrailerIntroOutro",
        generateTrailerIntroOutro ? "true" : "false",
      );
      formData.append("videoFormat", videoFormat);
      formData.append("fontChoice", fontChoice);
      formData.append("soundtrackChoice", soundtrackChoice);
      formData.append("backgroundColor", backgroundColor);
      formData.append("textColor", textColor);
      formData.append("accentColor", accentColor);
      if (generateTrailerIntroOutro) {
        formData.append("trailerTitle", trailerTitle);
        formData.append("trailerSubtitle", trailerSubtitle);
        formData.append("trailerOutroTitle", trailerOutroTitle);
        formData.append("trailerOutroSubtitle", trailerOutroSubtitle);
        formData.append("outroCredits", outroCredits);
        formData.append("trailerDuration", trailerDuration);
      }
      formData.append("lowerThirdTitle", lowerThirdTitle);
      formData.append("lowerThirdSubtitle", lowerThirdSubtitle);
      formData.append("lowerThirdStart", lowerThirdStart);
      formData.append("lowerThirdDuration", lowerThirdDuration);
      formData.append("subtitleFontChoice", subtitleFontChoice);
      formData.append("subtitleHighlightColor", subtitleHighlightColor);
      formData.append("renderSpeedMode", renderSpeedMode);
      formData.append("subtitleLanguage", "en");

      const response = await fetch("/api/render", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as RenderResponse &
        RenderStatusResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Render failed.");
      }

      setActiveRenderJobId(payload.jobId);
      setRenderStatus({
        jobId: payload.jobId,
        status: payload.status ?? "running",
        progress: payload.progress ?? 0,
        message: payload.message ?? "Render started.",
      });
      setStatusMessage(payload.message ?? "Render started.");
      setSaveToMacError("");
      setSavedToMacPath("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Render failed.");
      setStatusMessage("Render did not complete.");
      setIsSubmitting(false);
      setActiveRenderJobId(null);
      setRenderStatus(null);
    }
  }

  async function handleSaveToMac() {
    if (!result || isSavingToMac) {
      return;
    }

    setIsSavingToMac(true);
    setSaveToMacError("");
    setSavedToMacPath("");

    try {
      const response = await fetch(`/api/save/${result.jobId}`, {
        method: "POST",
      });
      const payload = (await response.json()) as SaveToMacResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save files to Mac safe folder.");
      }

      setSavedToMacPath(payload.destinationFolder);
    } catch (error) {
      setSaveToMacError(
        error instanceof Error ? error.message : "Unable to save files to Mac safe folder.",
      );
    } finally {
      setIsSavingToMac(false);
    }
  }

  async function persistDraftAssets(input: {
    subtitleFile?: File | null;
    logoFile?: File | null;
  }) {
    if (!draftId) {
      return;
    }

    const formData = new FormData();
    if (input.subtitleFile) {
      formData.append("subtitleFile", input.subtitleFile);
    }
    if (input.logoFile) {
      formData.append("logo", input.logoFile);
    }
    if (![...formData.keys()].length) {
      return;
    }

    try {
      const response = await fetch(`/api/drafts/${draftId}/assets`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        subtitleFilename?: string;
        logoFilename?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save step 2 assets.");
      }

      setStep2SaveMessage(
        `Saved to backend${payload.subtitleFilename ? ` | Subtitle: ${payload.subtitleFilename}` : ""}${payload.logoFilename ? ` | Logo: ${payload.logoFilename}` : ""}`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save step 2 assets.",
      );
    }
  }

  async function handleGenerateSubtitlesFromStep1() {
    if (!videoFile || isGeneratingSrt) {
      return;
    }

    setIsGeneratingSrt(true);
    setErrorMessage("");
    setStep1SrtMessage("");

    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("subtitleLanguage", "en");

      const response = await fetch("/api/subtitles/generate", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as Step1SubtitleResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to generate subtitle file.");
      }

      const generatedSubtitle = new File(
        [payload.content],
        payload.filename || "subtitles.srt",
        { type: "application/x-subrip; charset=utf-8" },
      );
      setSubtitleFile(generatedSubtitle);
      setDraftId(payload.draftId || "");
      setStep2SaveMessage("Step 1 subtitle and source video saved to backend.");
      setStep1SrtMessage(`Generated subtitle file: ${generatedSubtitle.name}`);
      setWizardStep(2);
      setStatusMessage("Step 1 complete. Subtitle file has been loaded into Step 2.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to generate subtitle file.",
      );
    } finally {
      setIsGeneratingSrt(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10 text-white sm:px-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6">
        <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">Pipeline</p>

          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setWizardStep(1)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                wizardStep === 1
                  ? "border-orange-300/70 bg-orange-400/15 text-white"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-black/30"
              }`}
            >
              Step 1: Source Video
            </button>
            <button
              type="button"
              onClick={() => {
                if (videoFile || draftId) {
                  setWizardStep(2);
                }
              }}
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                wizardStep === 2
                  ? "border-orange-300/70 bg-orange-400/15 text-white"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-black/30"
              } ${videoFile || draftId ? "" : "cursor-not-allowed opacity-60"}`}
            >
              Step 2: Subtitles + Branding
            </button>
            <button
              type="button"
              onClick={() => {
                if (videoFile || draftId) {
                  setWizardStep(3);
                }
              }}
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                wizardStep === 3
                  ? "border-orange-300/70 bg-orange-400/15 text-white"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-black/30"
              } ${videoFile || draftId ? "" : "cursor-not-allowed opacity-60"}`}
            >
              Step 3: Render + Export
            </button>
            <button
              type="button"
              onClick={() => {
                if (result) {
                  setWizardStep(4);
                }
              }}
              className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                wizardStep === 4
                  ? "border-orange-300/70 bg-orange-400/15 text-white"
                  : "border-white/10 bg-black/20 text-white/70 hover:bg-black/30"
              } ${result ? "" : "cursor-not-allowed opacity-60"}`}
            >
              Step 4: Preview + Download
            </button>
          </div>

          <form onSubmit={handleRender} className="mt-5 grid gap-4">
            {wizardStep === 1 ? (
              <>
                <div className="grid gap-4">
                  <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <span className="text-sm text-white/80">Main video upload</span>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => {
                        setVideoFile(event.target.files?.[0] ?? null);
                        setSubtitleFile(null);
                        setDraftId("");
                        setStep2SaveMessage("");
                        setStep1SrtMessage("");
                      }}
                      className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                    />
                  </label>
                  <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <span className="text-sm text-white/80">Output format</span>
                    <select
                      value={videoFormat}
                      onChange={(event) =>
                        setVideoFormat(event.target.value as "short" | "wide")
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      <option value="short">Short (9:16, TikTok/Reels)</option>
                      <option value="wide">Wide (16:9, YouTube landscape)</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleGenerateSubtitlesFromStep1}
                    disabled={!videoFile || isGeneratingSrt}
                    className="inline-flex h-12 items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-400/15 px-6 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isGeneratingSrt ? "Generating .srt..." : "Run speech-to-text (.srt)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    disabled={!videoFile && !draftId}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-orange-500 px-6 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Continue to Step 2
                  </button>
                </div>
                {step1SrtMessage ? (
                  <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                    {step1SrtMessage}
                  </div>
                ) : null}
              </>
            ) : null}

            {wizardStep === 2 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <span className="text-sm text-white/80">Logo upload (.svg only for crisp quality)</span>
                    <input
                      type="file"
                      accept="image/svg+xml,.svg"
                      onChange={(event) => {
                        const nextLogo = event.target.files?.[0] ?? null;
                        setLogoFile(nextLogo);
                        void persistDraftAssets({ logoFile: nextLogo });
                      }}
                      className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                    />
                  </label>

                  <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <span className="text-sm text-white/80">Subtitle file upload (.srt)</span>
                    <input
                      ref={subtitleInputRef}
                      type="file"
                      accept=".srt,text/plain"
                      onChange={(event) => {
                        const nextSubtitle = event.target.files?.[0] ?? null;
                        setSubtitleFile(nextSubtitle);
                        void persistDraftAssets({ subtitleFile: nextSubtitle });
                      }}
                      className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-emerald-300 file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                    />
                  </label>
                </div>

                {subtitleFile ? (
                  <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-xs text-emerald-100">
                    Active subtitle file: {subtitleFile.name}
                  </div>
                ) : null}
                {draftId ? (
                  <div className="rounded-2xl border border-white/15 bg-black/20 p-3 text-xs text-white/75">
                    Backend draft: {draftId}
                  </div>
                ) : null}
                {step2SaveMessage ? (
                  <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-xs text-emerald-100">
                    {step2SaveMessage}
                  </div>
                ) : null}

                <div className="grid gap-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm text-emerald-100">Subtitle font (30 options)</span>
                    <select
                      value={subtitleFontChoice}
                      onChange={(event) =>
                        setSubtitleFontChoice(
                          event.target.value as (typeof googleFonts)[number],
                        )
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      {googleFonts.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-emerald-100">Subtitle highlighter color</span>
                    <input
                      type="color"
                      value={subtitleHighlightColor}
                      onChange={(event) => setSubtitleHighlightColor(event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/15 bg-transparent"
                    />
                  </label>
                </div>

                <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-6">
                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Background color</span>
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(event) => setBackgroundColor(event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/15 bg-transparent"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Text color</span>
                    <input
                      type="color"
                      value={textColor}
                      onChange={(event) => setTextColor(event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/15 bg-transparent"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Accent color</span>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                      className="h-11 w-full rounded-xl border border-white/15 bg-transparent"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Google font (30)</span>
                    <select
                      value={fontChoice}
                      onChange={(event) =>
                        setFontChoice(event.target.value as (typeof googleFonts)[number])
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      {googleFonts.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Render quality</span>
                    <select
                      value={qualityProfile}
                      onChange={(event) =>
                        setQualityProfile(event.target.value as "fast" | "balanced" | "high")
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High (crispest)</option>
                    </select>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Intro/outro song</span>
                    <select
                      value={soundtrackChoice}
                      onChange={(event) =>
                        setSoundtrackChoice(
                          event.target.value as
                            | "startup-chime"
                            | "spirited-blues"
                            | "theater-chime"
                            | "trailer-braam"
                            | "piano-lift",
                        )
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      <option value="theater-chime">Theater Chime (cinema)</option>
                      <option value="trailer-braam">Trailer Braam (epic)</option>
                      <option value="piano-lift">Piano Lift (emotional)</option>
                      <option value="spirited-blues">Spirited Blues</option>
                      <option value="startup-chime">Startup Chime</option>
                    </select>
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                  Subtitle pipeline mode: Step 3 extracts audio, transcribes speech, generates
                  `.srt`, and burns subtitles directly into the video.
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-transparent px-6 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-orange-500 px-6 text-sm font-semibold text-black transition hover:bg-orange-400"
                  >
                    Continue to Step 3
                  </button>
                </div>
              </>
            ) : null}

            {wizardStep === 3 ? (
              <>
                <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-2">
                  <label className="inline-flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={generateTrailerIntroOutro}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setGenerateTrailerIntroOutro(enabled);
                        if (!enabled) {
                          setIntroMusicFile(null);
                          setOutroMusicFile(null);
                        }
                      }}
                      className="mt-1 h-4 w-4 rounded border-white/30 bg-transparent accent-orange-500"
                    />
                    <span className="text-sm text-white/90">
                      Generate cinematic intro and outro clips (turn off to reduce render time)
                    </span>
                  </label>
                  {generateTrailerIntroOutro ? (
                    <>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">Intro title</span>
                        <input
                          value={trailerTitle}
                          onChange={(event) => setTrailerTitle(event.target.value)}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">Intro line 2</span>
                        <input
                          value={trailerSubtitle}
                          onChange={(event) => setTrailerSubtitle(event.target.value)}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">Outro title</span>
                        <input
                          value={trailerOutroTitle}
                          onChange={(event) => setTrailerOutroTitle(event.target.value)}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">Outro line 2</span>
                        <input
                          value={trailerOutroSubtitle}
                          onChange={(event) => setTrailerOutroSubtitle(event.target.value)}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2 md:col-span-2">
                        <span className="text-sm text-white/80">
                          Outro credits (one name per line)
                        </span>
                        <textarea
                          value={outroCredits}
                          onChange={(event) => setOutroCredits(event.target.value)}
                          rows={4}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2 md:col-span-2">
                        <span className="text-sm text-white/80">
                          Intro/Outro duration (seconds)
                        </span>
                        <input
                          type="number"
                          min="1.2"
                          max="12"
                          step="0.1"
                          value={trailerDuration}
                          onChange={(event) => setTrailerDuration(event.target.value)}
                          className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">
                          Intro music upload (optional, overrides song list)
                        </span>
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(event) => setIntroMusicFile(event.target.files?.[0] ?? null)}
                          className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-white/80">
                          Outro music upload (optional, overrides song list)
                        </span>
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(event) => setOutroMusicFile(event.target.files?.[0] ?? null)}
                          className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                        />
                      </label>
                    </>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/70 md:col-span-2">
                      Intro/outro clip customization is hidden while cinematic intro/outro is off.
                    </div>
                  )}
                </div>

                <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Lower third (bottom-right): line 1</span>
                    <input
                      value={lowerThirdTitle}
                      onChange={(event) => setLowerThirdTitle(event.target.value)}
                      className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Lower third (bottom-right): line 2</span>
                    <input
                      value={lowerThirdSubtitle}
                      onChange={(event) => setLowerThirdSubtitle(event.target.value)}
                      className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Lower third start (sec)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={lowerThirdStart}
                      onChange={(event) => setLowerThirdStart(event.target.value)}
                      className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/80">Lower third duration (sec)</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.1"
                      value={lowerThirdDuration}
                      onChange={(event) => setLowerThirdDuration(event.target.value)}
                      className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                  Step 3 runs the render and then lets you download or save output files to your
                  Mac safe folder.
                </div>
                <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                  Subtitle burn style: {subtitleFontChoice}, Apple-style size{" "}
                  {appleSubtitleFontSize}px, highlight {subtitleHighlightColor}.
                </div>
                <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-emerald-100">
                      Render speed mode
                    </span>
                    <select
                      value={renderSpeedMode}
                      onChange={(event) =>
                        setRenderSpeedMode(
                          event.target.value as "turbo" | "balanced" | "quality",
                        )
                      }
                      className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                    >
                      <option value="turbo">Turbo (fastest, hardware encode)</option>
                      <option value="balanced">Balanced</option>
                      <option value="quality">Quality</option>
                    </select>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-transparent px-6 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-orange-500 px-6 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Rendering..." : "Render Trailer Video"}
                  </button>
                </div>
                {result ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep(4)}
                    className="inline-flex h-12 w-fit items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-400/15 px-6 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/25"
                  >
                    Open Step 4 Preview
                  </button>
                ) : null}
              </>
            ) : null}

            {wizardStep === 4 ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm text-white/85">
                    Preview the rendered video before downloading. If changes are needed, go back
                    to Step 2 or Step 3.
                  </p>
                </div>

                {result?.previewUrl ? (
                  <div className="overflow-hidden rounded-2xl border border-white/15 bg-black/40">
                    <video
                      key={result.jobId}
                      controls
                      preload="metadata"
                      className="h-auto w-full"
                      src={result.previewUrl}
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-sm text-white/70">
                    Render a video in Step 3 first, then preview it here.
                  </div>
                )}

                {result ? (
                  <div className="grid gap-3 sm:grid-cols-1">
                    <a
                      className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-orange-100"
                      href={result.downloadUrl}
                    >
                      Download video
                    </a>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 bg-transparent px-5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Back to Step 2
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 bg-transparent px-5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Back to Step 3
                  </button>
                </div>
              </>
            ) : null}
          </form>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-black/25 p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">Export</p>

          {renderStatus ? (
            <div className="mt-5 space-y-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between text-sm uppercase tracking-[0.12em] text-white/70">
                <span>Render {renderStatus.status}</span>
                <span>{renderStatus.progress}%</span>
              </div>
              <p className="text-sm text-white/85">{renderStatus.message}</p>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className={`h-full rounded-full transition-all ${
                    renderStatus.status === "failed"
                      ? "bg-red-400"
                      : "bg-gradient-to-r from-orange-400 to-emerald-300"
                  }`}
                  style={{ width: `${renderStatus.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-sm leading-7 text-white/75">
              {statusMessage}
            </div>
          )}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/12 p-4 text-sm leading-7 text-red-100">
              {errorMessage}
            </div>
          ) : null}

          {result ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                <p className="text-sm text-emerald-100">Render ready</p>
                <p className="mt-2 text-xl font-semibold text-white">{result.filename}</p>
                <p className="mt-2 text-sm text-white/70">
                  Output size: {formatBytes(result.sizeInBytes)}
                </p>
              </div>
              <a
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-orange-100"
                href={result.downloadUrl}
              >
                Download final video
              </a>
              <button
                type="button"
                onClick={handleSaveToMac}
                disabled={isSavingToMac}
                className="inline-flex w-full items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-400/15 px-6 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingToMac
                  ? "Saving to Mac safe folder..."
                  : "Step 3: Save files to Mac safe folder"}
              </button>
              {savedToMacPath ? (
                <p className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-xs leading-6 text-emerald-100">
                  Saved to: {savedToMacPath}
                </p>
              ) : null}
              {saveToMacError ? (
                <p className="rounded-2xl border border-red-400/30 bg-red-400/12 p-3 text-xs leading-6 text-red-100">
                  {saveToMacError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
