const path = require("node:path");
const { access, readFile, writeFile } = require("node:fs/promises");
const {
  runCommand,
  ffmpegPath,
  escapeSubtitlesPath,
  getSubtitleStyle,
  hexToAssBgr,
} = require("../utils/ffmpeg");

function formatAssTime(seconds) {
  const totalCentiseconds = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centis = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    centis,
  ).padStart(2, "0")}`;
}

function escapeAssText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function normalizeWords(payload) {
  if (!payload || !Array.isArray(payload.words)) {
    return [];
  }

  return payload.words
    .filter((word) => word && typeof word === "object")
    .map((word) => {
      const token = String(word.word || "").trim();
      const start = Number(word.start);
      const end = Number(word.end);
      return {
        word: token,
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : start + 0.08,
      };
    })
    .filter((word) => word.word.length > 0)
    .sort((a, b) => a.start - b.start)
    .map((word) => ({
      word: word.word,
      start: Math.max(0, word.start),
      end: Math.max(word.start + 0.05, word.end),
    }));
}

function groupWordsIntoSubtitleLines(words) {
  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length === 0) {
      current.push(word);
      continue;
    }

    const previous = current[current.length - 1];
    const gap = Math.max(0, word.start - previous.end);
    const elapsed = word.end - current[0].start;
    const punctuationBreak = /[.!?]$/.test(previous.word);
    const maxWords = current.length >= 8;
    const maxDuration = elapsed > 4.5;
    const hardGap = gap > 0.8;

    if (punctuationBreak || maxWords || maxDuration || hardGap) {
      flush();
    }

    current.push(word);
  }

  flush();
  return groups;
}

function buildAssKaraokeText(lineWords, activeIndex, highlightBgr) {
  return lineWords
    .map((word, index) => {
      const token = escapeAssText(word.word);
      if (index !== activeIndex) {
        return token;
      }

      return `{\\1c&H00${highlightBgr}&\\bord4\\3c&H000000&}${token}{\\rDefault}`;
    })
    .join(" ");
}

function buildAssFromWords({
  words,
  fontFamily,
  fontSize,
  highlightColor,
  subtitleStartDelaySeconds = 0,
  subtitleHideRanges = [],
}) {
  const delay = Math.max(0, Number(subtitleStartDelaySeconds) || 0);
  const ranges = Array.isArray(subtitleHideRanges)
    ? subtitleHideRanges
        .map((range) => ({
          start: Math.max(0, Number(range?.start) || 0),
          end: Math.max(0, Number(range?.end) || 0),
        }))
        .filter((range) => range.end > range.start)
    : [];

  const isHiddenAt = (start, end) => {
    for (const range of ranges) {
      if (start < range.end && end > range.start) {
        return true;
      }
    }
    return false;
  };

  const delayedWords = words
    .filter((word) => word.end >= delay)
    .map((word) => ({
      ...word,
      start: Math.max(word.start, delay),
      end: Math.max(word.end, Math.max(word.start, delay) + 0.05),
    }))
    .filter((word) => !isHiddenAt(word.start, word.end));

  const grouped = groupWordsIntoSubtitleLines(delayedWords);
  if (grouped.length === 0) {
    return "";
  }

  const safeFontSize = Math.max(12, Math.min(120, Number(fontSize) || 48));
  const highlightBgr = hexToAssBgr(highlightColor);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${fontFamily},${safeFontSize},&H00FFFFFF,&H00${highlightBgr},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2.2,0,2,32,32,34,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const events = [];
  for (const group of grouped) {
    for (let i = 0; i < group.words.length; i += 1) {
      const current = group.words[i];
      const next = group.words[i + 1];
      const start = current.start;
      const end = Math.max(
        start + 0.06,
        Math.min(group.end, next ? next.start : current.end),
      );

      const text = buildAssKaraokeText(group.words, i, highlightBgr);
      events.push(
        `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`,
      );
    }
  }

  return `${header.join("\n")}\n${events.join("\n")}\n`;
}

async function extractAudio({ inputVideoPath, outputAudioPath }) {
  await runCommand(ffmpegPath, [
    "-y",
    "-i",
    inputVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    outputAudioPath,
  ]);
}

async function burnSubtitles({
  inputVideoPath,
  srtPath,
  wordsPath,
  outputVideoPath,
  fontSize = 48,
  highlightColor = "#19b5fe",
  fontFamily = "Arial",
  speedMode = "turbo",
  subtitleStartDelaySeconds = 0,
  subtitleHideRanges = [],
}) {
  let subtitleFilter;
  if (wordsPath) {
    try {
      await access(wordsPath);
      const wordsRaw = await readFile(wordsPath, "utf8");
      const parsed = JSON.parse(wordsRaw);
      const words = normalizeWords(parsed);
      const assText = buildAssFromWords({
        words,
        fontFamily,
        fontSize,
        highlightColor,
        subtitleStartDelaySeconds,
        subtitleHideRanges,
      });

      if (assText.trim().length > 0) {
        const assPath = path.join(
          path.dirname(srtPath),
          `${path.basename(srtPath, path.extname(srtPath))}.ass`,
        );
        await writeFile(assPath, assText, "utf8");
        subtitleFilter = `subtitles=${escapeSubtitlesPath(assPath)}`;
      }
    } catch {
      subtitleFilter = undefined;
    }
  }

  if (!subtitleFilter) {
    const style = getSubtitleStyle({ fontSize, highlightColor, fontFamily });
    const escapedSrtPath = escapeSubtitlesPath(srtPath);
    subtitleFilter = `subtitles=${escapedSrtPath}:force_style='${style}'`;
  }

  const sharedArgs = [
    "-y",
    "-i",
    inputVideoPath,
    "-vf",
    subtitleFilter,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputVideoPath,
  ];

  const x264ArgsByMode = {
    turbo: ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "27"],
    balanced: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
    quality: ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
  };

  if (speedMode === "turbo") {
    try {
      await runCommand(ffmpegPath, [
        "-y",
        "-i",
        inputVideoPath,
        "-vf",
        subtitleFilter,
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "6500k",
        "-maxrate",
        "8500k",
        "-bufsize",
        "13000k",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        outputVideoPath,
      ]);
      return;
    } catch {
      await runCommand(ffmpegPath, [...sharedArgs.slice(0, 6), ...x264ArgsByMode.turbo, ...sharedArgs.slice(6)]);
      return;
    }
  }

  const modeArgs = speedMode === "quality" ? x264ArgsByMode.quality : x264ArgsByMode.balanced;
  await runCommand(ffmpegPath, [...sharedArgs.slice(0, 6), ...modeArgs, ...sharedArgs.slice(6)]);
}

module.exports = {
  extractAudio,
  burnSubtitles,
};
