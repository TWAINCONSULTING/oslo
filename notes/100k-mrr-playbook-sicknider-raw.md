# $100k MRR Playbook

- **Source:** https://www.instagram.com/reel/DbtsYOuDDql/
- **Creator:** Nick Snider — @sicknider.raw ("My Raw Journey")
- **Posted:** 2026-08-06 · 1:45 · 264 likes · 12 comments
- **Caption:** "THE FULL PLAYBOOK TO GET TO $100k MRR. Save and share this video with your co-founder and get to marketing"

## Method note

Analyzed from video frames plus burned-in captions, not from an audio
transcription. Speech-to-text was unavailable (see *Pipeline gap* below), so
the spoken track was reconstructed from on-screen captions sampled at ~1.2s.
Captions change faster than that, so **roughly half the spoken phrases are
missing**. The whiteboard content is complete and verbatim; the narration
below is a reconstruction, and quoted fragments are exact but non-contiguous.

## The whiteboard (complete)

```
$100k MRR Playbook
 1  Idea Generation
      ↳ Virality  vs  Paid Ads
 2  Build It — Cursor, Supabase, Vercel
 3  Conversion Flow
 4  STOP BUILDING
        MARKET
```

## Walkthrough

**Framing / credibility.** Opens on a revenue claim: he and a friend
("Austin") built apps and an "app studio," reaching "over $200,000 of monthly
recurring" revenue. A dashboard screenshot flashes showing **$211,000.07 USD**
with a green **+62,985.75** delta. A product called "Sunday Sauce" is named
alongside "$100,000 monthly recurring revenue." He frames the video as the
steps that took him "from zero to $200,000 a month."

**1 — Idea generation: virality vs paid ads.** Two distinct go-to-market
paths, chosen up front rather than discovered later.

- *Virality route:* pick niches that are "inherently viral." Credits
  **Ernesto Lopez**. An on-screen list shows the niche pattern: Detox Counter,
  Fasting, Overcome-X-problem, Procrastination, Night Routine, Focus & Deep
  Work, Study Habits, Mindfulness & Meditation — i.e. self-improvement
  categories with built-in before/after narratives.
- *Paid ads route:* "TikTok ads," find "long tail keywords" you "can rank
  for," and mind "the price" (CAC vs price point).

**2 — Build it.** Explicitly a vibe-coding stack: **Cursor** as the editor
(he names Claude Opus 4.6 as the model — auto-captioned "Clod Opus 4.6"),
**Supabase** as backend/database, **Vercel** for deploy (auto-captioned
"Versol"). Core instruction: **"Do not over[build]"** — ship the minimum, then
move to the other steps.

**3 — Conversion flow.** His claimed differentiator: "one of the least"
talked-about but most important steps. The argument is that traffic is
worthless without conversion — you can have "unlimited traffic," but "if your
[flow] isn't optimized, then you're just [wasting it]." Prescribes
*continuous* optimization rather than a one-time setup, covering ad targeting
and making sure the product matches what the ad promised.

**4 — Stop building, start marketing.** The emphasis of the whole video
(largest item on the board). Concretely: study competitors — "look at
creators," "go on X," see "what content they're" doing — then publish at
volume. Captions include "single day" and "spam," closing on a
volume-probability argument: **"the more content ... the higher chance."**

## Takeaways

1. **Pick your distribution channel before you build.** Virality and paid ads
   imply different products; deciding after launch is the mistake.
2. **Niche selection is a virality lever, not a preference.** Self-improvement
   categories come with native before/after hooks.
3. **Treat the build as the cheap part.** Cursor + Supabase + Vercel is a
   deliberately commoditized stack; time saved there funds distribution.
4. **Conversion is a continuous loop.** The genuinely useful point — most
   playbooks stop at "get traffic."
5. **Founder failure mode is over-building.** Stated twice, and the reason
   step 4 is the biggest thing on the board.

## Accuracy check

- **Revenue claims are unverifiable.** A dashboard screenshot is not evidence;
  it shows no product, timeframe, or gross-vs-net. Note the internal
  inconsistency: the title promises $100k MRR while the narration claims
  $200k+. Treat as marketing for the creator's own funnel.
- **Survivorship bias.** One outcome presented as a repeatable procedure, with
  no base rate for how many run the same playbook and fail.
- **"Spam content daily" is a real cost.** Presented as a pure-upside
  probability play, ignoring audience burnout, platform throttling, and the
  labor involved.
- **The stack reference is dated.** Claude Opus 4.6 was current at posting;
  the Claude 5 family has since superseded it. The pattern (agentic editor +
  managed backend + zero-config deploy) is what carries, not the exact model.
- **Nothing here is AI-security related** — worth flagging given the stated
  goal of building AI security study notes.

## Pipeline gap

Local Whisper could not run: `huggingface.co` is reachable but the weights
live on `cas-server.xethub.hf.co`, `transfer.xethub.hf.co`, and
`cdn-lfs*.huggingface.co`, which are not in the environment's allowlist.
OpenAI's `openaipublic.azureedge.net` is likewise blocked.

Either fix gives full audio transcription:

1. Add `*.xethub.hf.co` and `*.hf.co` to the environment's allowed domains, or
2. Set `GEMINI_API_KEY` — `generativelanguage.googleapis.com` is already
   reachable, and `scripts/analyze_video.py` then handles audio and visuals in
   one pass.
