"use client";

import { type FormEvent, useState } from "react";

type RenderResponse = {
  jobId: string;
  filename: string;
  downloadUrl: string;
  sizeInBytes: number;
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

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [fontChoice, setFontChoice] = useState<(typeof googleFonts)[number]>("Poppins");
  const [qualityProfile, setQualityProfile] = useState<"fast" | "balanced" | "high">(
    "high",
  );
  const [soundtrackChoice, setSoundtrackChoice] = useState<
    "startup-chime" | "spirited-blues"
  >("spirited-blues");
  const [backgroundColor, setBackgroundColor] = useState("#050816");
  const [textColor, setTextColor] = useState("#f8fafc");
  const [accentColor, setAccentColor] = useState("#4f80ff");

  const [trailerTitle, setTrailerTitle] = useState("COMING UP NEXT");
  const [trailerSubtitle, setTrailerSubtitle] = useState("Hey Siri, come in here.");
  const [trailerOutroTitle, setTrailerOutroTitle] = useState("THANK YOU FOR WATCHING");
  const [trailerOutroSubtitle, setTrailerOutroSubtitle] = useState(
    "Stay tuned for the next release",
  );
  const [trailerDuration, setTrailerDuration] = useState("3.5");

  const [lowerThirdTitle, setLowerThirdTitle] = useState("Tamillow Institute");
  const [lowerThirdSubtitle, setLowerThirdSubtitle] = useState("Maureen Tamillow, LCPC");
  const [lowerThirdStart, setLowerThirdStart] = useState("4");
  const [lowerThirdDuration, setLowerThirdDuration] = useState("6");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Upload a video and logo, pick your colors and font, then render.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<RenderResponse | null>(null);

  async function handleRender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!videoFile) {
      setErrorMessage("Please upload a main video file.");
      return;
    }

    setErrorMessage("");
    setResult(null);
    setIsSubmitting(true);
    setStatusMessage("Rendering trailer intro/outro, lower thirds, and final export...");

    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      if (logoFile) {
        formData.append("logo", logoFile);
      }

      formData.append("generateTrailerIntroOutro", "true");
      formData.append("fontChoice", fontChoice);
      formData.append("qualityProfile", qualityProfile);
      formData.append("soundtrackChoice", soundtrackChoice);
      formData.append("backgroundColor", backgroundColor);
      formData.append("textColor", textColor);
      formData.append("accentColor", accentColor);
      formData.append("trailerTitle", trailerTitle);
      formData.append("trailerSubtitle", trailerSubtitle);
      formData.append("trailerOutroTitle", trailerOutroTitle);
      formData.append("trailerOutroSubtitle", trailerOutroSubtitle);
      formData.append("trailerDuration", trailerDuration);
      formData.append("lowerThirdTitle", lowerThirdTitle);
      formData.append("lowerThirdSubtitle", lowerThirdSubtitle);
      formData.append("lowerThirdStart", lowerThirdStart);
      formData.append("lowerThirdDuration", lowerThirdDuration);

      const response = await fetch("/api/render", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as RenderResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Render failed.");
      }

      setResult(payload);
      setStatusMessage("Render complete. Download is ready.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Render failed.");
      setStatusMessage("Render did not complete.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10 text-white sm:px-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6">
        <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">Pipeline</p>

          <form onSubmit={handleRender} className="mt-5 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                <span className="text-sm text-white/80">Main video upload</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                  className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
                />
              </label>

              <label className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
                <span className="text-sm text-white/80">Logo upload (single logo)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                  className="block text-sm text-white file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-black"
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
                <span className="text-sm text-white/80">Song choice</span>
                <select
                  value={soundtrackChoice}
                  onChange={(event) =>
                    setSoundtrackChoice(
                      event.target.value as "startup-chime" | "spirited-blues",
                    )
                  }
                  className="h-11 rounded-xl border border-white/15 bg-[#111827] px-3 text-white"
                >
                  <option value="spirited-blues">Spirited Blues</option>
                  <option value="startup-chime">Startup Chime</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-white/80">Intro title</span>
                <input
                  value={trailerTitle}
                  onChange={(event) => setTrailerTitle(event.target.value)}
                  className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/80">Intro subtitle</span>
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
                <span className="text-sm text-white/80">Outro subtitle</span>
                <input
                  value={trailerOutroSubtitle}
                  onChange={(event) => setTrailerOutroSubtitle(event.target.value)}
                  className="rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-white"
                />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm text-white/80">Intro/Outro duration (seconds)</span>
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
              Audio note: both choices are original synthesized tracks. No proprietary or
              copyrighted Apple audio is used.
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-full bg-orange-500 px-6 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Rendering..." : "Render Trailer Video"}
            </button>
          </form>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-black/25 p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-white/45">Export</p>

          <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-sm leading-7 text-white/75">
            {statusMessage}
          </div>

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
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
