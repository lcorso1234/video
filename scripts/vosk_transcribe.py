#!/usr/bin/env python3

import argparse
import json
import os
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel


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
    if token in {"[unk]", "<unk>"}:
        return ""
    return token


def append_estimated_word_timings(
    text: str,
    start: float,
    end: float,
    timed_words: list[dict[str, float | str]],
) -> None:
    clean = clean_text(text)
    if not clean:
        return

    words = clean.split()
    if len(words) == 0:
        return

    span = max(0.2, end - start)
    chunk = span / len(words)
    cursor = start
    for token in words:
        normalized = normalize_token(token)
        if not normalized:
            continue
        word_start = cursor
        word_end = min(end, word_start + chunk)
        timed_words.append(
            {
                "word": normalized,
                "start": round(word_start, 3),
                "end": round(max(word_end, word_start + 0.05), 3),
                "conf": 0.35,
            }
        )
        cursor = word_end


def append_segment_from_result(
    payload: dict,
    segments: list[tuple[float, float, str]],
    timed_words: list[dict[str, float | str]],
) -> None:
    words = payload.get("result") or []
    if isinstance(words, list) and len(words) > 0:
        structured_words: list[dict[str, float | str]] = []
        for word in words:
            if isinstance(word, dict):
                value = normalize_token(str(word.get("word") or ""))
                if not value:
                    continue
                start = safe_float(word.get("start"), 0.0)
                end = safe_float(word.get("end"), max(start + 0.05, start))
                confidence = safe_float(
                    word.get("conf", word.get("confidence", 1.0)),
                    1.0,
                )
                structured_words.append(
                    {
                        "word": value,
                        "start": round(start, 3),
                        "end": round(max(end, start + 0.05), 3),
                        "conf": round(max(0.0, min(1.0, confidence)), 3),
                    }
                )
        text = " ".join(str(item.get("word") or "") for item in structured_words).strip()
        start = (
            safe_float(structured_words[0].get("start"), 0.0)
            if len(structured_words) > 0
            else safe_float(words[0].get("start"), 0.0)
        )
        end = (
            safe_float(structured_words[-1].get("end"), max(start + 0.2, start))
            if len(structured_words) > 0
            else safe_float(words[-1].get("end"), max(start + 0.2, start))
        )
        if text:
            segments.append((start, max(end, start + 0.2), text))
            timed_words.extend(structured_words)
            return

    text = clean_text(str(payload.get("text") or ""))
    if not text:
        return

    last_end = segments[-1][1] if segments else 0.0
    estimated_duration = max(0.8, min(8.0, len(text.split()) * 0.42))
    estimated_end = last_end + estimated_duration
    segments.append((last_end, estimated_end, text))
    append_estimated_word_timings(text, last_end, estimated_end, timed_words)

def dedupe_timed_words(
    timed_words: list[dict[str, float | str]],
) -> list[dict[str, float | str]]:
    sorted_words = sorted(
        timed_words,
        key=lambda item: (
            safe_float(item.get("start"), 0.0),
            safe_float(item.get("end"), 0.0),
        ),
    )
    deduped: list[dict[str, float | str]] = []
    for raw in sorted_words:
        token = normalize_token(str(raw.get("word") or ""))
        if not token:
            continue
        start = max(0.0, safe_float(raw.get("start"), 0.0))
        end = max(start + 0.05, safe_float(raw.get("end"), start + 0.05))
        conf = max(0.0, min(1.0, safe_float(raw.get("conf", 1.0), 1.0)))
        current = {
            "word": token,
            "start": round(start, 3),
            "end": round(end, 3),
            "conf": round(conf, 3),
        }

        previous = deduped[-1] if deduped else None
        if previous:
            prev_token = str(previous.get("word") or "").lower()
            prev_start = safe_float(previous.get("start"), 0.0)
            prev_end = safe_float(previous.get("end"), prev_start + 0.05)
            prev_conf = safe_float(previous.get("conf", 1.0), 1.0)
            close_boundary = start <= prev_end + 0.12 and abs(start - prev_start) <= 0.22
            if prev_token == token.lower() and close_boundary:
                if conf >= prev_conf:
                    previous["start"] = round(min(prev_start, start), 3)
                    previous["end"] = round(max(prev_end, end), 3)
                    previous["conf"] = round(conf, 3)
                else:
                    previous["end"] = round(max(prev_end, end), 3)
                continue

        deduped.append(current)

    return deduped

def build_segments_from_timed_words(
    timed_words: list[dict[str, float | str]],
) -> list[tuple[float, float, str]]:
    if not timed_words:
        return []

    words = dedupe_timed_words(timed_words)
    if not words:
        return []

    groups: list[list[dict[str, float | str]]] = []
    current: list[dict[str, float | str]] = []

    def flush() -> None:
        nonlocal current
        if current:
            groups.append(current)
            current = []

    for word in words:
        start = safe_float(word.get("start"), 0.0)
        end = safe_float(word.get("end"), start + 0.05)
        if not current:
            current.append(word)
            continue

        previous = current[-1]
        prev_end = safe_float(previous.get("end"), safe_float(previous.get("start"), 0.0) + 0.05)
        gap = max(0.0, start - prev_end)
        elapsed = end - safe_float(current[0].get("start"), 0.0)

        if gap > 0.62 or len(current) >= 8 or elapsed > 3.8:
            flush()
        current.append(word)

    flush()

    segments: list[tuple[float, float, str]] = []
    for group in groups:
        text = clean_text(" ".join(str(item.get("word") or "") for item in group))
        if not text:
            continue
        start = safe_float(group[0].get("start"), 0.0)
        end = safe_float(group[-1].get("end"), start + 0.2)
        segments.append((start, max(end, start + 0.2), text))

    return segments


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to wav audio input")
    parser.add_argument("--output", required=True, help="Path to write SRT subtitles")
    parser.add_argument(
        "--words-output",
        required=False,
        default="",
        help="Optional path to write word-level timings as JSON",
    )
    parser.add_argument("--model", required=True, help="Path to Vosk model directory")
    parser.add_argument("--language", default="en", help="Language hint (currently informational)")
    args = parser.parse_args()

    if not os.path.isdir(args.model):
        raise RuntimeError(f"Vosk model directory not found: {args.model}")

    with wave.open(args.input, "rb") as wave_file:
        channels = wave_file.getnchannels()
        sample_width = wave_file.getsampwidth()
        sample_rate = wave_file.getframerate()
        if channels != 1 or sample_width != 2 or sample_rate != 16000:
            raise RuntimeError(
                "Input audio must be 16kHz mono PCM16 WAV. Ensure ffmpeg extraction is configured correctly."
            )

        SetLogLevel(-1)
        model = Model(args.model)
        recognizer = KaldiRecognizer(model, sample_rate)
        recognizer.SetWords(True)
        if hasattr(recognizer, "SetPartialWords"):
            recognizer.SetPartialWords(True)

        segments: list[tuple[float, float, str]] = []
        timed_words: list[dict[str, float | str]] = []
        while True:
            data = wave_file.readframes(4000)
            if len(data) == 0:
                break
            if recognizer.AcceptWaveform(data):
                append_segment_from_result(json.loads(recognizer.Result()), segments, timed_words)
        append_segment_from_result(json.loads(recognizer.FinalResult()), segments, timed_words)

    normalized_words = dedupe_timed_words(timed_words)
    derived_segments = build_segments_from_timed_words(normalized_words)
    final_segments = derived_segments if len(derived_segments) > 0 else segments

    if len(final_segments) == 0:
        raise RuntimeError(
            f"No subtitle segments were produced by the speech engine for language '{args.language}'."
        )

    output_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        for index, (start, end, text) in enumerate(final_segments, start=1):
            handle.write(f"{index}\n")
            handle.write(
                f"{format_srt_timestamp(start)} --> {format_srt_timestamp(max(end, start + 0.2))}\n"
            )
            handle.write(f"{clean_text(text)}\n\n")

    if args.words_output:
        words_output_dir = os.path.dirname(os.path.abspath(args.words_output))
        os.makedirs(words_output_dir, exist_ok=True)
        with open(args.words_output, "w", encoding="utf-8") as words_handle:
            json.dump({"words": normalized_words}, words_handle, ensure_ascii=False)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
