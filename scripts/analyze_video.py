#!/usr/bin/env python3
"""Fetch a video (by URL or local path) and analyze it with Gemini.

Gemini understands video natively — visuals, on-screen text, and speech
together — so this does not need a separate transcription step.

    # From a URL (needs the video host reachable; see README)
    python3 scripts/analyze_video.py "https://www.instagram.com/reel/XXXX/"

    # From a file already on disk (works under a restrictive egress policy)
    python3 scripts/analyze_video.py ~/Downloads/clip.mp4

Requires GEMINI_API_KEY in the environment. Get one at
https://aistudio.google.com/apikey
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

DEFAULT_PROMPT = """You are helping build study notes on AI security.

Analyze this video and return:

1. **Summary** — what is being claimed or demonstrated, in 3-5 sentences.
2. **Transcript** — a clean transcript of the spoken audio.
3. **On-screen content** — text, code, terminal output, or diagrams shown
   that are not spoken aloud.
4. **Techniques & concepts** — each specific attack, defense, tool, model,
   or framework named, with a one-line explanation of its role.
5. **Actionable takeaways** — what a security practitioner should actually
   do or test as a result.
6. **Accuracy check** — flag anything technically wrong, oversimplified,
   outdated, or overstated. Note if a claim needs verification.

Use markdown headings. Be specific and skip filler."""


def slugify(value: str) -> str:
    """Reduce a title to a filesystem-safe slug."""
    value = re.sub(r"[^\w\s-]", "", value or "").strip().lower()
    return re.sub(r"[\s_-]+", "-", value)[:60] or "video"


def fetch(source: str, work_dir: Path) -> dict:
    """Return video path and metadata, downloading first if source is a URL."""
    if not source.startswith(("http://", "https://")):
        path = Path(source).expanduser()
        if not path.is_file():
            sys.exit(f"error: no such file: {path}")
        return {"path": path, "title": path.stem, "id": path.stem}

    try:
        import yt_dlp
    except ImportError:
        sys.exit("error: yt-dlp not installed. Run: pip install -r requirements.txt")

    opts = {
        "format": "mp4/bestvideo+bestaudio/best",
        "outtmpl": str(work_dir / "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(source, download=True)
            path = Path(ydl.prepare_filename(info))
    except Exception as exc:  # yt_dlp raises a wide range of network errors
        sys.exit(
            f"error: download failed: {exc}\n\n"
            "If this is a connection or tunnel error, the video host is blocked "
            "by this environment's network egress policy. See README.md."
        )

    return {
        "path": path,
        "title": info.get("title"),
        "id": info.get("id"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
        "caption": info.get("description"),
        "webpage_url": info.get("webpage_url", source),
    }


def analyze(video_path: Path, prompt: str, model: str) -> str:
    """Upload the video to Gemini and return its analysis as markdown."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit(
            "error: GEMINI_API_KEY is not set.\n"
            "Create a key at https://aistudio.google.com/apikey, then:\n"
            "  export GEMINI_API_KEY=...  (or add it to the environment's secrets)"
        )

    from google import genai

    client = genai.Client(api_key=api_key)

    print(f"Uploading {video_path.name} to Gemini...", file=sys.stderr)
    uploaded = client.files.upload(file=str(video_path))

    # Gemini transcodes video server-side; it is unusable until ACTIVE.
    waited = 0
    while uploaded.state.name == "PROCESSING":
        if waited > 600:
            sys.exit("error: Gemini file processing timed out after 10 minutes")
        time.sleep(5)
        waited += 5
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name == "FAILED":
        sys.exit("error: Gemini could not process this video file")

    print(f"Analyzing with {model}...", file=sys.stderr)
    response = client.models.generate_content(
        model=model, contents=[uploaded, prompt]
    )

    client.files.delete(name=uploaded.name)
    return response.text


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("source", help="Video URL or local file path")
    parser.add_argument(
        "--model",
        default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        help="Gemini model (default: gemini-2.5-flash; use gemini-2.5-pro for depth)",
    )
    parser.add_argument("--out", default="./notes", help="Output directory")
    parser.add_argument("--prompt", help="Custom analysis prompt (overrides default)")
    parser.add_argument(
        "--prompt-file", help="Read the analysis prompt from a file"
    )
    parser.add_argument(
        "--keep-video", action="store_true", help="Keep the downloaded video file"
    )
    args = parser.parse_args()

    prompt = args.prompt or DEFAULT_PROMPT
    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    meta = fetch(args.source, out_dir)
    analysis = analyze(meta["path"], prompt, args.model)

    stem = slugify(meta.get("title") or meta.get("id"))
    header = [f"# {meta.get('title') or stem}", ""]
    for label, key in (("Source", "webpage_url"), ("Uploader", "uploader")):
        if meta.get(key):
            header.append(f"- **{label}:** {meta[key]}")
    if meta.get("duration"):
        header.append(f"- **Duration:** {meta['duration']}s")
    header.append("")

    note_path = out_dir / f"{stem}.md"
    note_path.write_text("\n".join(header) + analysis + "\n")

    json_path = out_dir / f"{stem}.json"
    json_path.write_text(
        json.dumps(
            {
                "source": args.source,
                "title": meta.get("title"),
                "uploader": meta.get("uploader"),
                "duration_seconds": meta.get("duration"),
                "caption": meta.get("caption"),
                "model": args.model,
                "analysis": analysis,
            },
            indent=2,
        )
    )

    if not args.keep_video and args.source.startswith(("http://", "https://")):
        meta["path"].unlink(missing_ok=True)

    print(analysis)
    print(f"\nSaved: {note_path}\n       {json_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
