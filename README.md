# oslo

Tooling for reviewing and learning from short-form video (Instagram reels,
TikTok, YouTube, X) — built around AI security study notes.

## Scripts

### `scripts/analyze_video.py` — primary

Fetches a video by URL (or reads a local file) and analyzes it with Gemini,
which understands video natively: speech, visuals, and on-screen text
together. Writes a markdown study note plus a JSON record.

```sh
export GEMINI_API_KEY=...          # https://aistudio.google.com/apikey

python3 scripts/analyze_video.py "https://www.instagram.com/reel/XXXX/"
python3 scripts/analyze_video.py ~/Downloads/clip.mp4 --model gemini-2.5-pro
python3 scripts/analyze_video.py <source> --prompt-file my-prompt.txt
```

The default prompt produces: summary, transcript, on-screen content,
techniques/tools named, actionable takeaways, and an accuracy check. Override
it with `--prompt` or `--prompt-file`.

### `scripts/transcribe_reel.py` — offline fallback

Transcribes with a local Whisper model instead of a cloud API. No API key and
no per-video cost, but audio only — it does not see anything on screen. Needs
`huggingface.co` reachable to fetch model weights on first run.

```sh
python3 scripts/transcribe_reel.py "<url>" --model base
```

## Setup

```sh
apt-get install -y ffmpeg
pip install -r requirements.txt
```

## Network requirements

Video download is the part most likely to be blocked. In a Claude Code web
environment, egress is governed by the environment's network policy
([docs](https://code.claude.com/docs/en/claude-code-on-the-web)).

| Needs to be reachable | For |
| --- | --- |
| `instagram.com`, `cdninstagram.com`, `fbcdn.net` | Instagram download |
| `tiktok.com`, `tiktokcdn.com` | TikTok download |
| `youtube.com`, `googlevideo.com` | YouTube download |
| `generativelanguage.googleapis.com` | Gemini analysis |
| `huggingface.co` | Whisper weights (fallback script only) |

A "package registries only" policy blocks all the video hosts, so
`analyze_video.py` will fail at the download step with a tunnel/proxy error.
Passing a **local file path** instead of a URL works under any policy, since
no download is attempted.

Because video hosts serve from many rotating CDN subdomains, a narrow custom
allowlist tends to be brittle — broader internet access is more reliable.

## Scope note

`yt-dlp` fetches public third-party content through an unofficial extractor.
That falls outside Instagram's and TikTok's terms for automated access, and
extractors break whenever those sites change. Keep daily volume modest. For
content posted by an account you control, the official
[Instagram Graph API](https://developers.facebook.com/docs/instagram-platform)
is the sanctioned and more stable route.

## Optional: auto-install dependencies each session

To have a Claude Code web session install `ffmpeg` and the pip requirements
automatically, add `.claude/hooks/session-start.sh`:

```bash
#!/bin/bash
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then exit 0; fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq ffmpeg
fi
pip install --break-system-packages --quiet -r "$CLAUDE_PROJECT_DIR/requirements.txt"
```

Make it executable and register it in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" } ] }
    ]
  }
}
```

This is left for a human to add deliberately: a `SessionStart` hook executes
shell commands automatically at the start of every future session, so it
should be reviewed rather than introduced by an agent.
