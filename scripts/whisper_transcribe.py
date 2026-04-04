#!/usr/bin/env python3

import argparse
import json
import os


def load_whisper_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "Whisper transcription requires the Python package 'faster-whisper'. "
            "Install it with: python3 -m pip install faster-whisper"
        ) from error

    return WhisperModel


def format_srt_timestamp(seconds_value: float) -> str:
    total_ms = max(0, int(seconds_value * 1000))
    hours = total_ms // 3_600_000
    minutes = (total_ms % 3_600_000) // 60_000
    seconds = (total_ms % 60_000) // 1000
    millis = total_ms % 1000
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


def clean_text(value: str) -> str:
    return " ".join((value or "").replace("\r", " ").replace("\n", " ").split()).strip()


def safe_float(value, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed:
        return fallback
    return parsed


def normalize_token(value: str) -> str:
    token = clean_text(value).strip(".,!?;:\"'()[]{}")
    return token


def normalize_language_hint(value: str):
    normalized = clean_text(value).lower().replace("_", "-")
    if not normalized or normalized == "auto":
        return None
    return normalized.split("-")[0] or None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to audio input")
    parser.add_argument("--output", required=True, help="Path to write SRT subtitles")
    parser.add_argument(
        "--words-output",
        required=False,
        default="",
        help="Optional path to write word-level timings as JSON",
    )
    parser.add_argument("--model", required=True, help="Whisper model name or local model path")
    parser.add_argument("--language", default="", help="Language hint, such as 'en' or 'en-us'")
    parser.add_argument("--device", default="auto", help="Whisper device hint")
    parser.add_argument("--compute-type", default="int8", help="Whisper compute type")
    args = parser.parse_args()

    WhisperModel = load_whisper_model()
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    language_hint = normalize_language_hint(args.language)

    segments_iterable, _info = model.transcribe(
        args.input,
        language=language_hint,
        beam_size=5,
        best_of=5,
        vad_filter=True,
        word_timestamps=True,
    )

    segments = []
    timed_words = []

    for segment in segments_iterable:
        start = safe_float(getattr(segment, "start", 0.0), 0.0)
        end = safe_float(getattr(segment, "end", start + 0.2), max(start + 0.2, start))
        text = clean_text(getattr(segment, "text", ""))
        if text:
            segments.append((start, max(end, start + 0.2), text))

        for word in getattr(segment, "words", []) or []:
            token = normalize_token(getattr(word, "word", ""))
            if not token:
                continue
            word_start = safe_float(getattr(word, "start", start), start)
            word_end = safe_float(
                getattr(word, "end", max(word_start + 0.05, start)),
                max(word_start + 0.05, start),
            )
            probability = safe_float(getattr(word, "probability", 1.0), 1.0)
            timed_words.append(
                {
                    "word": token,
                    "start": round(max(0.0, word_start), 3),
                    "end": round(max(word_end, word_start + 0.05), 3),
                    "conf": round(max(0.0, min(1.0, probability)), 3),
                }
            )

    if len(segments) == 0:
        raise RuntimeError("No subtitle segments were produced by Whisper.")

    output_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        for index, (start, end, text) in enumerate(segments, start=1):
            handle.write(f"{index}\n")
            handle.write(
                f"{format_srt_timestamp(start)} --> {format_srt_timestamp(max(end, start + 0.2))}\n"
            )
            handle.write(f"{text}\n\n")

    if args.words_output:
        words_output_dir = os.path.dirname(os.path.abspath(args.words_output))
        os.makedirs(words_output_dir, exist_ok=True)
        with open(args.words_output, "w", encoding="utf-8") as words_handle:
            json.dump({"words": timed_words}, words_handle, ensure_ascii=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
