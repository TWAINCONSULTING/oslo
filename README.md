# oslo

## Video transcription & synthesis

`scripts/transcribe_reel.py` downloads a public video URL (e.g. an Instagram
reel), extracts the audio, and transcribes it with a local Whisper model —
producing a JSON file with the caption, uploader, duration, and full
transcript, ready to be read and synthesized.

```sh
python3 scripts/transcribe_reel.py "https://www.instagram.com/reel/XXXXXXXXXXX/" --out ./transcripts
```

Dependencies (`ffmpeg`, and the pip packages in `requirements.txt`) are
installed automatically by `.claude/hooks/session-start.sh` on every Claude
Code web session once this is merged to the default branch.

### Network access required

This only works in a Claude Code environment whose network egress policy
allows reaching:

- `instagram.com` and its CDN hosts (`cdninstagram.com`, `fbcdn.net`) — to
  fetch the video
- `huggingface.co` — to download the Whisper model weights on first use of a
  given `--model` size (cached under `~/.cache/huggingface` after that)

A narrow "package registries only" allowlist (the common default for coding
environments) blocks both. Set the environment's network policy to allow
broader/full internet access — see
[the Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web)
for how policies are configured per environment. A custom allowlist limited
to just `instagram.com` is not reliable, since Instagram serves video from
many rotating CDN subdomains.

### Note on scope

This downloads public content from third-party accounts (not content
posted by this account), via an unofficial method (`yt-dlp`'s Instagram
extractor). That's outside Instagram's Terms of Service for automated
access, and the extractor can break whenever Instagram changes its site.
Keep daily volume reasonable to reduce the chance of the source triggering
rate limits or blocks. If most of the content to review is ever this
account's own posts, the [Instagram Graph API](https://developers.facebook.com/docs/instagram-platform)
is the sanctioned, more reliable alternative for that subset.
