import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { google } from "googleapis";

export type YouTubePrivacyStatus = "private" | "unlisted" | "public";

export type YouTubeConnectionStatus = {
  configured: boolean;
  connected: boolean;
  channelId?: string;
  channelTitle?: string;
  message?: string;
};

export type YouTubePublishPhase = "queued" | "uploading" | "completed" | "failed";

export type YouTubePublishStatus = {
  status: YouTubePublishPhase;
  message: string;
  updatedAt: string;
  title?: string;
  privacyStatus?: YouTubePrivacyStatus;
  videoId?: string;
  videoUrl?: string;
  error?: string;
};

type StoredOAuthState = {
  state: string;
  createdAt: string;
};

type StoredOAuthTokens = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
};

export type YouTubeUploadInput = {
  jobId: string;
  videoPath: string;
  title: string;
  description: string;
  privacyStatus: YouTubePrivacyStatus;
  tags?: string[];
};

const youtubeRoot = path.join(process.cwd(), ".video-editor-youtube");
const oauthTokenPath = path.join(youtubeRoot, "oauth-token.json");
const oauthStatePath = path.join(youtubeRoot, "oauth-state.json");
const oauthStateMaxAgeMs = 10 * 60 * 1000;

const youtubeScopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function normalizeTokenValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeExpiryValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStoredTokens(tokens: unknown): StoredOAuthTokens {
  if (!tokens || typeof tokens !== "object") {
    return {};
  }

  const raw = tokens as Record<string, unknown>;
  return {
    access_token: normalizeTokenValue(raw.access_token),
    refresh_token: normalizeTokenValue(raw.refresh_token),
    scope: normalizeTokenValue(raw.scope),
    token_type: normalizeTokenValue(raw.token_type),
    expiry_date: normalizeExpiryValue(raw.expiry_date),
  };
}

function getYouTubeConfig() {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim() || "";
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI?.trim() || "http://127.0.0.1:3004/api/youtube/callback";

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

function getOAuthClient() {
  const config = getYouTubeConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.");
  }

  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

async function ensureYouTubeRoot() {
  await mkdir(youtubeRoot, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureYouTubeRoot();
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function loadOAuthTokens() {
  const tokens = await readJsonFile<StoredOAuthTokens>(oauthTokenPath);
  return normalizeStoredTokens(tokens);
}

async function saveOAuthTokens(tokens: StoredOAuthTokens) {
  await writeJsonFile(oauthTokenPath, tokens);
}

async function consumeOAuthState(expectedState: string) {
  const saved = await readJsonFile<StoredOAuthState>(oauthStatePath);
  await rm(oauthStatePath, { force: true });

  if (!saved || !saved.state || !saved.createdAt) {
    throw new Error("OAuth state was not found. Start connection again.");
  }

  const createdAtMs = Date.parse(saved.createdAt);
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > oauthStateMaxAgeMs) {
    throw new Error("OAuth state has expired. Start connection again.");
  }

  if (saved.state !== expectedState) {
    throw new Error("OAuth state mismatch. Start connection again.");
  }
}

async function getAuthorizedClient() {
  const oauthClient = getOAuthClient();
  const stored = await loadOAuthTokens();
  if (!stored.refresh_token && !stored.access_token) {
    throw new Error("No YouTube account connected. Connect your account first.");
  }

  oauthClient.setCredentials(stored);
  try {
    await oauthClient.getAccessToken();
  } catch {
    throw new Error("YouTube access token refresh failed. Reconnect your account.");
  }

  const merged = normalizeStoredTokens({
    ...stored,
    ...oauthClient.credentials,
    refresh_token: oauthClient.credentials.refresh_token || stored.refresh_token || undefined,
  });
  await saveOAuthTokens(merged);

  oauthClient.setCredentials(merged);
  return oauthClient;
}

export function isYouTubeConfigured() {
  const config = getYouTubeConfig();
  return Boolean(config.clientId && config.clientSecret);
}

export async function createYouTubeAuthUrl() {
  const oauthClient = getOAuthClient();
  const state = randomUUID();

  await writeJsonFile(oauthStatePath, {
    state,
    createdAt: new Date().toISOString(),
  } satisfies StoredOAuthState);

  const url = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: youtubeScopes,
    state,
  });

  return { url };
}

export async function handleYouTubeOAuthCallback(code: string, state: string) {
  if (!code.trim()) {
    throw new Error("OAuth callback did not include a code.");
  }
  if (!state.trim()) {
    throw new Error("OAuth callback did not include state.");
  }

  await consumeOAuthState(state);

  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  const existing = await loadOAuthTokens();

  const merged = normalizeStoredTokens({
    ...existing,
    ...tokens,
    refresh_token: tokens.refresh_token || existing.refresh_token || undefined,
  });

  if (!merged.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke app access and reconnect with consent.",
    );
  }

  await saveOAuthTokens(merged);
}

export async function disconnectYouTube() {
  await rm(oauthTokenPath, { force: true });
  await rm(oauthStatePath, { force: true });
}

export async function getYouTubeConnectionStatus(): Promise<YouTubeConnectionStatus> {
  if (!isYouTubeConfigured()) {
    return {
      configured: false,
      connected: false,
      message: "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to enable YouTube sync.",
    };
  }

  const tokens = await loadOAuthTokens();
  if (!tokens.refresh_token && !tokens.access_token) {
    return {
      configured: true,
      connected: false,
      message: "YouTube account not connected.",
    };
  }

  try {
    const auth = await getAuthorizedClient();
    const youtube = google.youtube({ version: "v3", auth });
    const response = await youtube.channels.list({
      part: ["snippet"],
      mine: true,
      maxResults: 1,
    });

    const channel = response.data.items?.[0];
    return {
      configured: true,
      connected: true,
      channelId: channel?.id || undefined,
      channelTitle: channel?.snippet?.title || undefined,
      message: channel?.snippet?.title
        ? `Connected to ${channel.snippet.title}.`
        : "Connected to YouTube account.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to validate YouTube connection.";
    return {
      configured: true,
      connected: false,
      message: `YouTube connection expired: ${message}`,
    };
  }
}

function buildYouTubePublishStatusPath(jobId: string) {
  return path.join(process.cwd(), ".video-editor-jobs", jobId, "youtube-status.json");
}

export async function readYouTubePublishStatus(jobId: string) {
  const filePath = buildYouTubePublishStatusPath(jobId);
  return await readJsonFile<YouTubePublishStatus>(filePath);
}

export async function writeYouTubePublishStatus(
  jobId: string,
  payload: Omit<YouTubePublishStatus, "updatedAt">,
) {
  const status: YouTubePublishStatus = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  const jobDirectory = path.dirname(buildYouTubePublishStatusPath(jobId));
  await mkdir(jobDirectory, { recursive: true });
  await writeFile(buildYouTubePublishStatusPath(jobId), `${JSON.stringify(status)}\n`, "utf8");
  return status;
}

function normalizeTags(input: string[] | undefined) {
  if (!input?.length) {
    return undefined;
  }

  const tags = input
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);

  return tags.length ? tags : undefined;
}

export async function uploadVideoToYouTube(input: YouTubeUploadInput) {
  await writeYouTubePublishStatus(input.jobId, {
    status: "uploading",
    message: "Uploading video to YouTube...",
    title: input.title,
    privacyStatus: input.privacyStatus,
  });

  try {
    const auth = await getAuthorizedClient();
    const youtube = google.youtube({ version: "v3", auth });
    const uploadResponse = await youtube.videos.insert({
      part: ["snippet", "status"],
      notifySubscribers: input.privacyStatus === "public",
      requestBody: {
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: normalizeTags(input.tags),
        },
        status: {
          privacyStatus: input.privacyStatus,
        },
      },
      media: {
        body: createReadStream(input.videoPath),
      },
    });

    const videoId = uploadResponse.data.id?.trim();
    if (!videoId) {
      throw new Error("YouTube upload completed but no video ID was returned.");
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await writeYouTubePublishStatus(input.jobId, {
      status: "completed",
      message: "Uploaded to YouTube successfully.",
      title: input.title,
      privacyStatus: input.privacyStatus,
      videoId,
      videoUrl,
    });

    return {
      videoId,
      videoUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube upload failed.";
    await writeYouTubePublishStatus(input.jobId, {
      status: "failed",
      message: "YouTube upload failed.",
      error: message,
      title: input.title,
      privacyStatus: input.privacyStatus,
    });
    throw new Error(message);
  }
}
