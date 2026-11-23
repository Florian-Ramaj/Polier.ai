# Pitch script: Polier.ai (3 minutes)

About 400 spoken words at a calm pace (around 135 words per minute).
Time marks are cumulative. Practise once with a timer.

---

## Slide 1: Title (0:00–0:10)
> Hi, we are Polier.ai. Our idea in three words: *Sprich. Wir schreiben.* You speak, we write.

## Slide 2: Problem (0:10–0:40)
> Site managers spend hours every day on paperwork.
> And these notices are not just paperwork. Under the VOB/B, a delay or a concern has to be reported in writing, promptly and complete.
> If that notice is late or missing details, the company can lose its claim to extra time or money.
> On top of that, the facts are scattered across notes, emails and photos. They are captured outside on a phone, often by foremen whose first language is not German.

## Slide 3: Solution (0:40–1:15)
> Polier.ai is a mobile web app with three steps.
> **Speak:** the foreman dictates on site, in German, Turkish, Polish or another language.
> **Check:** the AI turns that into structured fields and flags what is missing. Every field can be edited.
> **Send:** out comes a formal German letter or report as PDF or Word.
> Seven letter types, from delay notice to accident report, with the cost impact in euros. A deadline watch warns about missing notices, and a claim file collects everything about one trade.

## Slide 4: A day in the life (1:15–2:05)
*Option: show this live on the phone instead of the slide. Rehearse it, keep the slide as backup.*
> 7:30: the morning meeting is recorded, and out comes a protocol with open items, owners and deadlines.
> 10:15: the foreman dictates in Turkish that the excavator is idle because the utility plan is missing. Polier writes a German delay notice, with the cost impact in euros calculated in code.
> 14:00: a note says the drywall delivery did not arrive, and there is no notice yet. The deadline watch flags it, and one tap prepares the letter.
> 17:00: for a claim, the claim file collects all notes, letters and photos of a trade into one PDF.
> And nothing leaves the app without the site manager’s review.

## Slide 5: Tech stack & architecture (2:05–2:45)
> Technically, the phone app is a PWA with the browser’s speech recognition. It talks over a Cloudflare tunnel to our FastAPI backend in Python, which calls the Claude API.
> Our key rule: **code for rules, AI for language.** Letter structure, legal references, amounts in euros and dates come from code, so they are always correct. Claude extracts facts from any language and writes German paragraphs, and it has to answer in a fixed JSON schema.
> And the human approves everything before export.

## Slide 6: What’s next (2:45–3:00)
> Next we want login and team sync with EU hosting, a connection to ERP and site diary software, and weather and calendar integration.
> Less desk time, notices on time, and the site manager stays in charge. Thank you!

---

## Ready answers for the 2 minutes of questions

**Is this legal advice?**
No. Every document carries a note that it is an AI-assisted draft. The legal frame (structure, VOB/B paragraph) comes from fixed templates, and the site manager or company does the final review.

**What if the AI invents something?**
It is instructed to use only what was said. Missing information is not filled in but flagged as a missing field, and there is a check before export (e.g. missing recipient, sample letterhead).

**What does it cost?**
About one cent per letter with Claude Sonnet 5.5. Photos are resized in the browser to keep costs low. For the demo we can switch to Claude Opus 5.5 with one setting.

**Where does the voice data go?**
Speech-to-text runs in the browser (Web Speech API). Our server only receives the recognised text. In Chrome, the browser uses Google’s speech service for this. For production, an on-device or EU-hosted speech service would be an option.

**Where is the data stored?**
In the prototype, on the phone (browser storage). Production would need login, encrypted sync and hosting in the EU.

**Why not just use ChatGPT or Claude directly?**
A chat gives free text. Polier gives a checked, structured document in the right format, with correct legal references and dates, and stores deadlines in a plan.

**What would it take to use this on a real site?**
User accounts and secure hosting, connecting to existing site diary or ERP software, and a legal review of the templates.
