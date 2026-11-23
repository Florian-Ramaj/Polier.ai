# Polier.ai

**Sprich. Wir schreiben.** You speak, we write.

A mobile assistant for construction site managers. Dictate what happened on site, check the
structured result, and get a formal letter, daily report or meeting protocol as PDF or Word.
Built for the TUM.ai hackathon, Challenge B: *AI Site Manager Assistant for Documentation,
Daily Reports and Claims*.

## What it does

| Area | What the site manager gets |
|---|---|
| **Speak or type** | Free speech in the browser. Claude extracts trade, cause, consequence, people involved, duration and dates, and lists what is missing. |
| **Any language in, German out** | The foreman picks his language at the microphone (Turkish, Polish, Romanian, Croatian, Russian, Ukrainian, Arabic and more). Fields, letters and reports always come back in German with German construction terms. |
| **Check** | Every field is editable before anything is written. The human always approves. |
| **Letters** | Seven types with the legal reference set in code: delay notice (§ 6 VOB/B), additional costs (§ 2 VOB/B), concerns (§ 4 Abs. 3), defects (§ 4 Abs. 7), complaint (§ 13), accident report (§ 193 SGB VII), file note. Letterhead, recipient, copy to third parties, photos as appendix. PDF and Word. |
| **Cost impact** | With the company's daily rates for staff and equipment, delay and additional-cost letters get a paragraph with the amount and the calculation behind it. Computed in code, never by the model. |
| **Check before export** | Missing recipient, sample letterhead still in place, empty paragraphs or an unrecognised trade are flagged before download. |
| **Deadline watch** | Every delay, concern, additional cost or defect without a letter shows up on the start screen, amber on the same day and red from the next. Notes are scanned too ("delivery did not arrive", "crack in the wall"). One tap prepares the letter. |
| **Claim file** | Enter a keyword or tap a trade: all notes, letters, daily reports, plan items and the matching photos are collected in chronological order and exported as one PDF or Word file. |
| **Plan** | "New drywall delivery the day after tomorrow" becomes a task with a real date. Dates are computed in Python, not by the model. |
| **Plan vs. actual** | Positions with unit and target, progress as a slider. Percentages are computed in code at zero token cost; Claude only evaluates on request and suggests a letter for critical deviations. |
| **Meeting** | Record or paste a meeting. Out comes a protocol with participants, decisions, open items with owner and deadline, and suggested letters. |
| **Daily report** | Notes and photos of the day become a structured report, photos with captions in the appendix. |
| **Companies** | Own letterhead and a list of recipients per trade, stored on the phone. |

## Design principles

- **Code for rules, AI for language.** Letter structure, legal references, percentages and dates
  come from code, so they are always right. Claude extracts facts and writes paragraphs, and has to
  answer through a fixed JSON schema (tool use).
- **Human in the loop.** Nothing is exported without review. Every draft carries a notice that it
  is not legal advice.
- **No invented facts.** The prompts forbid names, dates and amounts that are not in the input.
  Missing information is listed, not guessed.
- **The app speaks up.** It does not only wait for input: open notices are flagged before the
  deadline slips, which is where claims are lost in practice.
- **Data stays on the phone.** Notes, photos, plan and letters live in the browser's local storage.
  Only the text needed for a request goes to the backend.

## Quick start (Windows)

You need Python 3.10 or newer, an Anthropic API key and
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
for access from a phone.

```bat
python -m venv .venv
setup.bat
```

Create `backend\.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-5-5
```

Without a key the backend runs in demo mode with canned answers, so the app can be clicked through
offline.

Start the backend:

```bat
start-backend.bat
```

The app is now at <http://localhost:8000>, the API docs at <http://localhost:8000/docs>.

### On a phone

In a second window:

```bat
cloudflared tunnel --url http://localhost:8000
```

Open the printed `https://….trycloudflare.com` address in Chrome on the phone and add it to the
home screen. The backend serves the app itself, so app and API share one address and no
configuration is needed.

A quick tunnel gets a new address on every start. If the installed app still points to an old one,
open **Menu → Server**, paste the new address and tap *Speichern und prüfen*. The address is stored
on the phone, not in the code.

## Architecture

```
Phone (PWA, speech recognition in Chrome)
   │  HTTPS, one address for app and API
Cloudflare quick tunnel
   │
FastAPI backend (Python)  ──►  Claude API (tool use, fixed JSON schema)
   ├─ letter templates in code (briefvorlagen.py)
   ├─ date and percentage calculation in code
   └─ PDF (fpdf2, DejaVu font) and Word (python-docx) export
```

| Endpoint | Purpose |
|---|---|
| `POST /analyze` | Text → structured event incl. task and date |
| `POST /brief` | Event + letter type + master data → letter |
| `POST /tagesbericht/analyse` | Plan vs. actual; `mit_bewertung=false` computes without Claude |
| `POST /tagesbericht/entwurf` | Notes + photos → daily report |
| `POST /zusammenfassung` | Meeting, minutes or mail → protocol |
| `POST /export/pdf`, `/export/docx` | Letter as file |
| `POST /export/bericht/pdf`, `/export/bericht/docx` | Report or protocol as file |
| `GET /health` | Status and whether Claude is active |

Details in [docs/api.md](docs/api.md).

## Project structure

```
backend/      FastAPI app, models, letter templates, PDF and Word export, fonts
frontend/     PWA: index.html, app.js, style.css, service worker, manifest
docs/         API description, pitch deck and script
```

## Team

Built by three people at the TUM.ai hackathon (Challenge B):

- **Florian Ramaj** ([@Florian-Ramaj](https://github.com/Florian-Ramaj)): letter types and templates, date and cost
  calculation in code, PDF and Word export, multi-language intake, deadline guard, claim file, and most of the
  app logic (voice capture, camera and photo attachments, plan vs. actual, summaries).
- **Dennis**: first backend prototype (daily report analysis, summaries, defect notices) and the pitch deck.
- **Mostafa** (`mostafaramadanmohamed`): design and layout of the PWA (menu, animations, screens).

This repository is a clean upload of the hackathon project without its original commit history.

## Limits of the prototype

- Speech recognition is the browser's own. It works for one speaker; meetings with several people
  talking over each other need a transcription service with speaker diarisation.
- `mailto:` cannot attach files. The app copies the letter text and opens the mail app; the PDF is
  attached by hand.
- No login and no team sync yet. Each phone has its own data.
- Quick tunnels are for demos. Production would run the backend on a server with a fixed domain.

## Not legal advice

Polier.ai produces drafts. Content, recipients and deadlines must be checked by a person before
anything is sent.
