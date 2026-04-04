const VIDEO_EXTENSION_TO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

const VIDEO_ALLOWED_EXTENSIONS = Object.keys(VIDEO_EXTENSION_TO_MIME);
const VIDEO_MIME_TO_EXTENSION = Object.fromEntries(
  Object.entries(VIDEO_EXTENSION_TO_MIME).map(([extension, mime]) => [mime, extension]),
) as Record<string, string>;

export const VIDEO_UPLOAD_ACCEPT_ATTR = `video/*,${VIDEO_ALLOWED_EXTENSIONS.join(",")}`;

export function hasSupportedVideoExtension(filename: string) {
  const lower = filename.toLowerCase();
  return VIDEO_ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isLikelyVideoFile(input: { name: string; type?: string | null }) {
  const fileType = String(input.type || "").toLowerCase();
  if (fileType.startsWith("video/")) {
    return true;
  }

  return hasSupportedVideoExtension(input.name || "");
}

export function inferVideoMimeType(input: { name: string; type?: string | null }) {
  const fileType = String(input.type || "").toLowerCase();
  if (fileType.startsWith("video/")) {
    return fileType;
  }

  const lower = (input.name || "").toLowerCase();
  const matchedExtension = VIDEO_ALLOWED_EXTENSIONS.find((extension) =>
    lower.endsWith(extension),
  );

  if (matchedExtension) {
    return VIDEO_EXTENSION_TO_MIME[matchedExtension];
  }

  return "video/mp4";
}

export function inferVideoExtension(
  input: { name?: string | null; type?: string | null },
  fallback = ".mp4",
) {
  const lowerName = String(input.name || "").toLowerCase();
  const namedExtension = VIDEO_ALLOWED_EXTENSIONS.find((extension) => lowerName.endsWith(extension));
  if (namedExtension) {
    return namedExtension;
  }

  const lowerType = String(input.type || "").toLowerCase();
  if (VIDEO_MIME_TO_EXTENSION[lowerType]) {
    return VIDEO_MIME_TO_EXTENSION[lowerType];
  }
  if (lowerType.includes("webm")) {
    return ".webm";
  }
  if (lowerType.includes("quicktime")) {
    return ".mov";
  }
  if (lowerType.includes("matroska")) {
    return ".mkv";
  }

  return fallback;
}
