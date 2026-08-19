#!/usr/bin/env python3
"""Download a public video URL (Instagram reel, etc.) and transcribe it for review.

Usage:
    python3 scripts/transcribe_reel.py <url> [--model base] [--out ./transcripts]

Requires network access to the source site's domain(s) (e.g. instagram.com and
its cdninstagram.com/fbcdn.net CDN hosts) and to huggingface.co on first run of
a given --model size (to fetch the faster-whisper model weights, cached under
~/.cache/huggingface afterwards). Neither is reachable under a narrow
package-registry-only egress allowlist; see README.md for details.
"""

import argparse
import json
import sys
from pathlib import Path


def download(url: str, out_dir: Path) -> dict:
    import yt_dlp

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "192",
            }
        ],
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    return {
        "audio_path": out_dir / f"{info['id']}.wav",
        "id": info.get("id"),
        "title": info.get("title"),
        "description": info.get("description"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
    }


def transcribe(audio_path: Path, model_size: str) -> str:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(audio_path))
    return " ".join(segment.text.strip() for segment in segments)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Public video URL (Instagram reel, etc.)")
    parser.add_argument(
        "--model",
        default="base",
        help="faster-whisper model size: tiny, base, small, medium, large-v3 "
        "(or an '.en' variant, e.g. base.en, for English-only speed). "
        "Default: base.",
    )
    parser.add_argument("--out", default="./transcripts", help="Output directory")
    parser.add_argument(
        "--keep-audio", action="store_true", help="Keep the downloaded .wav file"
    )
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading: {args.url}", file=sys.stderr)
    meta = download(args.url, out_dir)

    print(f"Transcribing with model '{args.model}'...", file=sys.stderr)
    transcript = transcribe(meta["audio_path"], args.model)

    result = {
        "url": args.url,
        "id": meta["id"],
        "title": meta["title"],
        "uploader": meta["uploader"],
        "duration_seconds": meta["duration"],
        "caption": meta["description"],
        "transcript": transcript,
    }

    out_path = out_dir / f"{meta['id']}.json"
    out_path.write_text(json.dumps(result, indent=2))

    if not args.keep_audio:
        meta["audio_path"].unlink(missing_ok=True)

    print(json.dumps(result, indent=2))
    print(f"\nSaved to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
