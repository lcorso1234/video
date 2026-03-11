export type BrowserRenderInput = {
  sourceVideoFile: File;
  logoFile: File;
  videoFormat: "short" | "wide";
  credits: string;
  backgroundColor: string;
  lowerThirdTitle?: string;
  lowerThirdSubtitle?: string;
  lowerThirdStart?: number;
  lowerThirdDuration?: number;
  subtitleFile?: File | null;
  subtitleHighlightColor?: string;
  subtitleTextColor?: string;
  introDurationSeconds?: number;
  outroDurationSeconds?: number;
  fps?: number;
  onProgress?: (progress: number, message: string) => void;
};

export type BrowserRenderOutput = {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  durationSeconds: number;
};

const DEFAULT_FPS = 30;
const DEFAULT_INTRO_SECONDS = 2.8;
const DEFAULT_OUTRO_SECONDS = 3.2;

function getTargetSize(videoFormat: "short" | "wide") {
  if (videoFormat === "short") {
    return { width: 720, height: 1280 };
  }
  return { width: 1280, height: 720 };
}

function getOutputMimeType() {
  const options = [
    "video/mp4;codecs=hvc1.1.6.L120.B0,mp4a.40.2",
    "video/mp4;codecs=avc1.64001f,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  for (const mimeType of options) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to load video metadata."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode logo image."));
    };
    image.src = objectUrl;
  });
}

function drawCoverVideo(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceAspect > targetAspect) {
    drawHeight = height;
    drawWidth = Math.round(height * sourceAspect);
    offsetX = Math.round((width - drawWidth) / 2);
  } else {
    drawWidth = width;
    drawHeight = Math.round(width / sourceAspect);
    offsetY = Math.round((height - drawHeight) / 2);
  }

  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const ratio = Math.min(maxWidth / safeSourceWidth, maxHeight / safeSourceHeight);
  return {
    width: Math.max(1, Math.round(safeSourceWidth * ratio)),
    height: Math.max(1, Math.round(safeSourceHeight * ratio)),
  };
}

function makeWhiteLogoMask(logo: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, logo.naturalWidth || logo.width || 1);
  canvas.height = Math.max(1, logo.naturalHeight || logo.height || 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(logo, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

function drawIntro(
  context: CanvasRenderingContext2D,
  args: {
    width: number;
    height: number;
    logo: HTMLImageElement;
    whiteLogoMask: HTMLCanvasElement;
    elapsed: number;
    duration: number;
    backgroundColor: string;
  },
) {
  const { width, height, logo, whiteLogoMask, elapsed, duration, backgroundColor } = args;
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(duration, 0.001)));
  const eased = 1 - Math.pow(1 - progress, 2.2);
  const logoScale = 0.88 + eased * 0.12;
  const maxLogoWidth = Math.round(width * 0.34 * logoScale);
  const maxLogoHeight = Math.round(height * 0.28 * logoScale);
  const logoSize = fitContain(
    logo.naturalWidth || logo.width || maxLogoWidth,
    logo.naturalHeight || logo.height || maxLogoHeight,
    maxLogoWidth,
    maxLogoHeight,
  );
  const logoWidth = logoSize.width;
  const logoHeight = logoSize.height;
  const logoX = Math.round((width - logoWidth) / 2);
  const logoY = Math.round((height - logoHeight) / 2 - height * 0.03);

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = eased;
  context.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  context.globalAlpha = 1 - eased;
  context.drawImage(whiteLogoMask, logoX, logoY, logoWidth, logoHeight);
  context.globalAlpha = 1;
}

function drawOutro(
  context: CanvasRenderingContext2D,
  args: {
    width: number;
    height: number;
    logo: HTMLImageElement;
    elapsed: number;
    duration: number;
    credits: string;
    backgroundColor: string;
  },
) {
  const { width, height, logo, elapsed, duration, credits, backgroundColor } = args;
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(duration, 0.001)));
  const eased = 1 - Math.pow(1 - progress, 2.2);
  const maxLogoWidth = Math.round(width * 0.28);
  const maxLogoHeight = Math.round(height * 0.22);
  const logoSize = fitContain(
    logo.naturalWidth || logo.width || maxLogoWidth,
    logo.naturalHeight || logo.height || maxLogoHeight,
    maxLogoWidth,
    maxLogoHeight,
  );
  const logoWidth = logoSize.width;
  const logoHeight = logoSize.height;
  const logoX = Math.round((width - logoWidth) / 2);
  const logoY = Math.round(height * 0.16);

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.35 + eased * 0.65;
  context.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  context.globalAlpha = 1;

  const creditLines = credits
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  context.fillStyle = "rgba(255,255,255,0.9)";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `600 ${Math.max(18, Math.round(width * 0.022))}px Poppins, sans-serif`;
  const textStartY = Math.round(height * 0.5);
  const lineHeight = Math.round(Math.max(24, width * 0.032));

  if (!creditLines.length) {
    context.fillText("Thanks for watching", Math.round(width / 2), textStartY);
    return;
  }

  for (let index = 0; index < creditLines.length; index += 1) {
    context.fillText(creditLines[index], Math.round(width / 2), textStartY + index * lineHeight);
  }
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawLowerThird(
  context: CanvasRenderingContext2D,
  args: {
    width: number;
    height: number;
    title: string;
    subtitle: string;
    progress: number;
  },
) {
  const title = args.title.trim();
  const subtitle = args.subtitle.trim();
  if (!title && !subtitle) {
    return;
  }

  const eased = Math.max(0, Math.min(1, args.progress));
  const translateY = Math.round((1 - eased) * 22);
  const alpha = 0.2 + eased * 0.8;
  const boxWidth = Math.round(Math.min(args.width * 0.86, 860));
  const boxHeight = Math.round(Math.max(88, args.height * 0.15));
  const x = Math.round((args.width - boxWidth) / 2);
  const y = Math.round(args.height - boxHeight - args.height * 0.07 + translateY);

  context.save();
  context.globalAlpha = alpha;
  drawRoundedRect(context, x, y, boxWidth, boxHeight, 16);
  context.fillStyle = "rgba(10,15,19,0.72)";
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.lineWidth = 2;
  context.stroke();

  context.fillStyle = "rgba(255,255,255,0.96)";
  context.textAlign = "left";
  context.textBaseline = "top";

  const contentX = x + 24;
  let contentY = y + 18;
  if (title) {
    context.font = `700 ${Math.max(20, Math.round(args.width * 0.026))}px Poppins, sans-serif`;
    context.fillText(title, contentX, contentY);
    contentY += Math.round(Math.max(28, args.height * 0.045));
  }

  if (subtitle) {
    context.fillStyle = "rgba(225,234,240,0.95)";
    context.font = `500 ${Math.max(16, Math.round(args.width * 0.018))}px Poppins, sans-serif`;
    context.fillText(subtitle, contentX, contentY);
  }

  context.restore();
}

type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

function parseSrtTimestamp(value: string) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(milliseconds)
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function parseSrt(text: string): SubtitleCue[] {
  const blocks = text
    .replace(/\r/g, "")
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timeLine = lines.find((line) => line.includes("-->"));
    if (!timeLine) {
      continue;
    }
    const [startText, endText] = timeLine.split("-->").map((value) => value.trim());
    const start = parseSrtTimestamp(startText);
    const end = parseSrtTimestamp(endText);
    if (start === null || end === null || end <= start) {
      continue;
    }
    const textLines = lines
      .slice(lines.indexOf(timeLine) + 1)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!textLines.length) {
      continue;
    }
    cues.push({
      start,
      end,
      text: textLines.join("\n"),
    });
  }

  return cues;
}

function getCueAtTime(cues: SubtitleCue[], timeInSeconds: number) {
  return cues.find((cue) => timeInSeconds >= cue.start && timeInSeconds <= cue.end) || null;
}

function getReadableTextColor(backgroundColor: string) {
  const cleaned = backgroundColor.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return "#101418";
  }
  const red = parseInt(cleaned.slice(0, 2), 16);
  const green = parseInt(cleaned.slice(2, 4), 16);
  const blue = parseInt(cleaned.slice(4, 6), 16);
  const luma = (red * 299 + green * 587 + blue * 114) / 1000;
  return luma >= 150 ? "#101418" : "#f8fbff";
}

function drawSubtitles(
  context: CanvasRenderingContext2D,
  args: {
    width: number;
    height: number;
    cue: SubtitleCue;
    highlightColor: string;
    textColor: string;
    lowerThirdVisible: boolean;
  },
) {
  const lines = args.cue.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!lines.length) {
    return;
  }

  const boxWidth = Math.round(Math.min(args.width * 0.9, 980));
  const lineHeight = Math.round(Math.max(30, args.width * 0.03));
  const boxHeight = lines.length * lineHeight + 26;
  const x = Math.round((args.width - boxWidth) / 2);
  const yBase = args.lowerThirdVisible
    ? Math.round(args.height * 0.56)
    : Math.round(args.height * 0.74);
  const y = Math.round(yBase - boxHeight / 2);

  context.save();
  drawRoundedRect(context, x, y, boxWidth, boxHeight, 14);
  context.fillStyle = args.highlightColor;
  context.globalAlpha = 0.93;
  context.fill();
  context.globalAlpha = 1;

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = args.textColor;
  context.font = `700 ${Math.max(22, Math.round(args.width * 0.027))}px Poppins, sans-serif`;

  for (let index = 0; index < lines.length; index += 1) {
    const lineY = y + 14 + lineHeight * index + lineHeight / 2;
    context.fillText(lines[index], Math.round(args.width / 2), Math.round(lineY));
  }
  context.restore();
}

function waitForRecorderStop(recorder: MediaRecorder) {
  return new Promise<void>((resolve, reject) => {
    const onStop = () => {
      cleanup();
      resolve();
    };
    const onError = (event: Event) => {
      cleanup();
      const error = (event as unknown as { error?: Error }).error;
      reject(error || new Error("MediaRecorder failed."));
    };
    const cleanup = () => {
      recorder.removeEventListener("stop", onStop);
      recorder.removeEventListener("error", onError);
    };
    recorder.addEventListener("stop", onStop);
    recorder.addEventListener("error", onError);
  });
}

export async function renderVideoInBrowser(input: BrowserRenderInput): Promise<BrowserRenderOutput> {
  if (typeof window === "undefined") {
    throw new Error("Browser renderer can only run in the browser.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support MediaRecorder.");
  }

  const fps = Math.max(20, Math.min(60, Math.round(input.fps || DEFAULT_FPS)));
  const introDuration = Math.max(0, input.introDurationSeconds ?? DEFAULT_INTRO_SECONDS);
  const outroDuration = Math.max(0, input.outroDurationSeconds ?? DEFAULT_OUTRO_SECONDS);
  const { width, height } = getTargetSize(input.videoFormat);

  input.onProgress?.(0.02, "Preparing local renderer...");
  const logoImage = await loadImageFromFile(input.logoFile);
  const whiteLogoMask = makeWhiteLogoMask(logoImage);

  const videoUrl = URL.createObjectURL(input.sourceVideoFile);
  const sourceVideo = document.createElement("video");
  sourceVideo.src = videoUrl;
  sourceVideo.preload = "auto";
  sourceVideo.muted = false;
  sourceVideo.volume = 0;
  sourceVideo.playsInline = true;
  await waitForVideoMetadata(sourceVideo);

  const sourceDuration = Number.isFinite(sourceVideo.duration) ? sourceVideo.duration : 0;
  if (sourceDuration <= 0) {
    URL.revokeObjectURL(videoUrl);
    throw new Error("Unable to read video duration.");
  }

  const totalDuration = introDuration + sourceDuration + outroDuration;
  const lowerThirdTitle = (input.lowerThirdTitle || "").trim();
  const lowerThirdSubtitle = (input.lowerThirdSubtitle || "").trim();
  const lowerThirdStart = Math.max(0, input.lowerThirdStart ?? 4);
  const lowerThirdDuration = Math.max(0, input.lowerThirdDuration ?? 6);
  const subtitleHighlightColor = (input.subtitleHighlightColor || "#E6FF00").trim() || "#E6FF00";
  const subtitleTextColor =
    (input.subtitleTextColor || getReadableTextColor(subtitleHighlightColor)).trim() ||
    getReadableTextColor(subtitleHighlightColor);
  const subtitles = input.subtitleFile ? parseSrt(await input.subtitleFile.text()) : [];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    URL.revokeObjectURL(videoUrl);
    throw new Error("Unable to initialize canvas renderer.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const videoStream = canvas.captureStream(fps);
  const mixedStream = new MediaStream(videoStream.getVideoTracks());
  let audioContext: AudioContext | null = null;
  let sourceAudioStream: MediaStream | null = null;
  let animationFrameId = 0;
  let recorderStarted = false;
  let bufferSource: AudioBufferSourceNode | null = null;
  let sourceAudioTrackAttached = false;

  const attachSourceAudioTrack = () => {
    if (sourceAudioTrackAttached || !sourceAudioStream) {
      return false;
    }
    const audioTrack = sourceAudioStream.getAudioTracks()[0];
    if (!audioTrack) {
      return false;
    }
    mixedStream.addTrack(audioTrack);
    sourceAudioTrackAttached = true;
    return true;
  };

  try {
    const withCapture = sourceVideo as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    if (typeof withCapture.captureStream === "function") {
      sourceAudioStream = withCapture.captureStream();
    } else if (typeof withCapture.mozCaptureStream === "function") {
      sourceAudioStream = withCapture.mozCaptureStream();
    }
    attachSourceAudioTrack();
  } catch {
    sourceAudioStream = null;
  }

  if (!sourceAudioTrackAttached) {
    try {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      await audioContext.resume();

      const audioBytes = await input.sourceVideoFile.arrayBuffer();
      const decodedAudio = await audioContext.decodeAudioData(audioBytes.slice(0));
      bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = decodedAudio;
      bufferSource.connect(destination);
      bufferSource.start(
        audioContext.currentTime + introDuration,
        0,
        Math.min(decodedAudio.duration, sourceDuration),
      );

      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        mixedStream.addTrack(audioTrack);
      }
    } catch {
      void 0;
    }
  }

  const mimeType = getOutputMimeType();
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(mixedStream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopPromise = waitForRecorderStop(recorder);
  recorder.start(300);
  recorderStarted = true;
  input.onProgress?.(0.05, "Rendering locally in browser...");

  let videoStarted = false;
  let renderDone = false;
  const startedAt = performance.now();

  await new Promise<void>((resolve, reject) => {
    const step = () => {
      if (renderDone) {
        return;
      }

      const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
      const clamped = Math.min(elapsed, totalDuration);

      if (clamped < introDuration) {
        drawIntro(context, {
          width,
          height,
          logo: logoImage,
          whiteLogoMask,
          elapsed: clamped,
          duration: introDuration,
          backgroundColor: input.backgroundColor,
        });
      } else if (clamped < introDuration + sourceDuration) {
        const sourceElapsed = clamped - introDuration;
        if (!videoStarted) {
          videoStarted = true;
          void sourceVideo.play().catch(() => {
            void 0;
          });
        }
        attachSourceAudioTrack();
        if (sourceVideo.currentTime + 0.25 < sourceElapsed) {
          sourceVideo.currentTime = sourceElapsed;
        }
        drawCoverVideo(context, sourceVideo, width, height);
        let lowerThirdVisible = false;
        if (lowerThirdDuration > 0 && (lowerThirdTitle || lowerThirdSubtitle)) {
          const lowerThirdEnd = lowerThirdStart + lowerThirdDuration;
          if (sourceElapsed >= lowerThirdStart && sourceElapsed <= lowerThirdEnd) {
            lowerThirdVisible = true;
            const fadeWindow = Math.min(0.35, lowerThirdDuration / 2);
            const fadeInProgress = Math.max(
              0,
              Math.min(1, (sourceElapsed - lowerThirdStart) / Math.max(fadeWindow, 0.001)),
            );
            const fadeOutProgress = Math.max(
              0,
              Math.min(1, (lowerThirdEnd - sourceElapsed) / Math.max(fadeWindow, 0.001)),
            );
            drawLowerThird(context, {
              width,
              height,
              title: lowerThirdTitle,
              subtitle: lowerThirdSubtitle,
              progress: Math.min(fadeInProgress, fadeOutProgress),
            });
          }
        }
        if (subtitles.length) {
          const cue = getCueAtTime(subtitles, sourceElapsed);
          if (cue) {
            drawSubtitles(context, {
              width,
              height,
              cue,
              highlightColor: subtitleHighlightColor,
              textColor: subtitleTextColor,
              lowerThirdVisible,
            });
          }
        }
      } else {
        sourceVideo.pause();
        drawOutro(context, {
          width,
          height,
          logo: logoImage,
          elapsed: clamped - introDuration - sourceDuration,
          duration: outroDuration,
          credits: input.credits,
          backgroundColor: input.backgroundColor,
        });
      }

      const progress = Math.max(0.05, Math.min(0.99, clamped / totalDuration));
      input.onProgress?.(progress, "Rendering locally in browser...");

      if (clamped >= totalDuration) {
        renderDone = true;
        sourceVideo.pause();
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        resolve();
        return;
      }

      animationFrameId = window.requestAnimationFrame(step);
    };

    animationFrameId = window.requestAnimationFrame(step);
    sourceVideo.addEventListener(
      "error",
      () => {
        renderDone = true;
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        reject(new Error("Video decode failed during browser render."));
      },
      { once: true },
    );
  });

  await stopPromise;
  input.onProgress?.(1, "Finalizing local file...");

  if (!chunks.length) {
    throw new Error("No video output was produced by the browser renderer.");
  }

  const outputBlob = new Blob(chunks, { type: mimeType || "video/webm" });
  const baseName = input.sourceVideoFile.name.replace(/\.[^/.]+$/, "") || "rendered-video";
  const extension = outputBlob.type.includes("mp4") ? "mp4" : "webm";
  const filename = `${baseName}-local-render.${extension}`;

  window.cancelAnimationFrame(animationFrameId);
  URL.revokeObjectURL(videoUrl);
  sourceVideo.removeAttribute("src");
  sourceVideo.load();
  try {
    bufferSource?.stop();
  } catch {
    void 0;
  }
  await audioContext?.close().catch(() => void 0);
  sourceAudioStream?.getTracks().forEach((track) => track.stop());
  if (recorderStarted && recorder.state !== "inactive") {
    recorder.stop();
  }

  return {
    blob: outputBlob,
    filename,
    width,
    height,
    durationSeconds: totalDuration,
  };
}
