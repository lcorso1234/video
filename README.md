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

## Electron Desktop App

Run the app in Electron (this starts Next.js and Electron together):

```bash
npm run electron:dev
```

If you already have the Next server running on `http://localhost:3004`, you can open only the Electron shell:

```bash
npm run electron
```

## Supported Source Video Uploads

Main source uploads accept common video formats including:

- `.mp4`
- `.mov`
- `.m4v`
- `.webm`
- `.mkv`
- `.avi`

Output renders are generated as `.mp4`.

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

## Speech To Text Subtitles

Rendering now includes a speech-to-text pipeline:

1. Extract audio from the rendered timeline.
2. Run speech recognition with Whisper when available, or fall back to a local Vosk engine.
3. Generate an `.srt` subtitle file.
4. Keep subtitles as a separate downloadable file.

Subtitles can also be disabled entirely in the Phase 3 UI. If you upload an `.srt` file in the UI, that file is used instead of auto-transcription.

Setup:

```bash
python3 -m pip install --user vosk
python3 -m pip install faster-whisper
```

Recommended `.env.local` settings:

```bash
TRANSCRIPTION_BACKEND=auto
WHISPER_MODEL=small
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=int8
VOSK_MODEL_PATH=/absolute/path/to/vosk-model-small-en-us
```

`auto` prefers Whisper for better accuracy and falls back to Vosk if Whisper is unavailable. If you want to force one backend, set `TRANSCRIPTION_BACKEND=whisper` or `TRANSCRIPTION_BACKEND=vosk`.

If you upload an `.srt` file in the UI, transcription is skipped and `VOSK_MODEL_PATH` is not required for that render. `VOSK_MODEL_PATH` is also not required when subtitles are turned off, or when you are using Whisper without Vosk fallback.

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
