This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3004](http://localhost:3004) with your browser to see the result.

## Fast Backend Branding Test

Run the server in one terminal:

```bash
npm run dev
```

Run a branding-only backend render test in another terminal:

```bash
npm run test:brand -- ./path/to/logo.svg
```

This script:
1. Creates a tiny source clip automatically.
2. Queues a backend render against `/api/render`.
3. Polls `/api/render/:jobId` until complete.
4. Downloads the output as `brand-test-<jobId>.mp4` in the project root.

Optional flags:

```bash
npm run test:brand -- ./path/to/logo.svg --host http://127.0.0.1:3004 --out /tmp/brand-test.mp4 --format short
```

`--format` accepts `wide` (1920x1080) or `short` (1080x1920).

## Auto-Subtitles E2E Test (No SRT Upload)

Run a full end-to-end test for the no-SRT flow:

```bash
npm run test:auto-subtitles -- ./path/to/logo.svg
```

This script:
1. Uses macOS `say` to generate spoken audio.
2. Builds a temporary source video with that speech.
3. Queues `/api/render` without uploading a subtitle file.
4. Waits for completion, then downloads both `.mp4` and `.srt`.

Optional flags:

```bash
npm run test:auto-subtitles -- ./path/to/logo.svg --host http://127.0.0.1:3004 --out /tmp/auto-e2e.mp4 --out-srt /tmp/auto-e2e.srt --format short --text "Custom spoken sentence for subtitle validation"
```

`--format` accepts `wide` (1920x1080) or `short` (1080x1920).

## YouTube Auto-Post Integration

The app can connect to your YouTube account and auto-post each completed render.

1. Create OAuth credentials in Google Cloud Console for YouTube Data API v3.
2. Add the callback URL to the OAuth client:

```text
http://127.0.0.1:3004/api/youtube/callback
```

3. Set these in `.env.local`:

```bash
YOUTUBE_CLIENT_ID=your_google_oauth_client_id
YOUTUBE_CLIENT_SECRET=your_google_oauth_client_secret
YOUTUBE_REDIRECT_URI=http://127.0.0.1:3004/api/youtube/callback
```

4. Restart `npm run dev`.
5. In Phase 3, connect YouTube, enable auto-post, then render.

Routes used by the integration:
- `GET /api/youtube/status`
- `GET /api/youtube/auth-url`
- `GET /api/youtube/callback`
- `POST /api/youtube/disconnect`

## Speech To Text Subtitles

Rendering now includes a speech-to-text pipeline:

1. Extract audio from the rendered timeline.
2. Run speech recognition with a local Vosk engine.
3. Generate an `.srt` subtitle file.
4. Keep subtitles as a separate downloadable file.

If you upload an `.srt` file in the UI, that file is used instead of auto-transcription.

Setup:

```bash
python3 -m pip install --user vosk
```

Download a Vosk model (for example from `alphacephei.com/vosk/models`) and set this in `.env.local`:

```bash
VOSK_MODEL_PATH=/absolute/path/to/vosk-model-small-en-us
```

If you upload an `.srt` file in the UI, transcription is skipped and `VOSK_MODEL_PATH` is not required for that render.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
