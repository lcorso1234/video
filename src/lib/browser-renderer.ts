export type BrowserRenderInput = {
  sourceVideoFile: File;
  logoFile: File;
  videoFormat: "short" | "wide";
  credits: string;
  backgroundColor: string;
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
  const logoScale = 0.9 + eased * 0.1;
  const baseSize = Math.round(Math.min(width, height) * 0.28);
  const logoWidth = Math.round(baseSize * logoScale);
  const logoHeight = Math.round(baseSize * logoScale);
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
  const baseSize = Math.round(Math.min(width, height) * 0.24);
  const logoWidth = baseSize;
  const logoHeight = baseSize;
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
  sourceVideo.playsInline = true;
  await waitForVideoMetadata(sourceVideo);

  const sourceDuration = Number.isFinite(sourceVideo.duration) ? sourceVideo.duration : 0;
  if (sourceDuration <= 0) {
    URL.revokeObjectURL(videoUrl);
    throw new Error("Unable to read video duration.");
  }

  const totalDuration = introDuration + sourceDuration + outroDuration;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    URL.revokeObjectURL(videoUrl);
    throw new Error("Unable to initialize canvas renderer.");
  }

  const videoStream = canvas.captureStream(fps);
  const mixedStream = new MediaStream(videoStream.getVideoTracks());
  let audioContext: AudioContext | null = null;
  let animationFrameId = 0;
  let recorderStarted = false;

  try {
    audioContext = new AudioContext();
    const mediaSource = audioContext.createMediaElementSource(sourceVideo);
    const destination = audioContext.createMediaStreamDestination();
    mediaSource.connect(destination);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) {
      mixedStream.addTrack(audioTrack);
    }
  } catch {
    void 0;
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
        if (!videoStarted) {
          videoStarted = true;
          void sourceVideo.play().catch(() => {
            void 0;
          });
        }
        drawCoverVideo(context, sourceVideo, width, height);
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
  await audioContext?.close().catch(() => void 0);
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
