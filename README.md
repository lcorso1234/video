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
