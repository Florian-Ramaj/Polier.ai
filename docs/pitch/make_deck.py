"""Erzeugt das Pitch Deck (PDF, 6 Folien, 16:9) im Polier.ai-Design.

Ausgelegt auf 3 Minuten Pitch: wenig Text, grosse Schrift. Was gesagt wird,
steht in pitch_script.md.

Aufruf (aus dem Projektordner):  .venv\\Scripts\\python.exe docs\\pitch\\make_deck.py
Ergebnis: docs/pitch/Polier_Pitch_Deck.pdf
"""
from pathlib import Path

from fpdf import FPDF

HIER = Path(__file__).parent
FONTS = HIER.parent.parent / "backend" / "fonts"
ICON = HIER.parent.parent / "frontend" / "icons" / "icon-512.png"

# Farben aus frontend/style.css
BG = (249, 238, 226)
TEXT = (74, 59, 50)
LEISE = (154, 134, 118)
AKZENT = (185, 105, 74)
DUNKEL = (150, 80, 47)
RAND = (235, 215, 195)
FLAECHE = (255, 249, 242)
ROSE = (246, 221, 211)
ROSE_TEXT = (122, 42, 30)
ROT = (215, 38, 34)
WEISS = (255, 255, 255)

WARN = []
W, H = 338.67, 190.5
M = 20
FOLIEN = 6


class Deck(FPDF):
    def __init__(self):
        super().__init__(orientation="L", unit="mm", format=(H, W))
        self.set_auto_page_break(False)
        self.add_font("D", "", str(FONTS / "DejaVuSans.ttf"))
        self.add_font("D", "B", str(FONTS / "DejaVuSans-Bold.ttf"))
        self.nr = 0
        self.grenze = None

    def seite(self):
        self.add_page()
        self.nr += 1
        self.set_fill_color(*BG)
        self.rect(0, 0, W, H, "F")
        self.set_fill_color(*AKZENT)
        self.rect(0, 0, 4, H, "F")

    def folie(self, kicker, titel):
        self.seite()
        self.text(M, 14, 250, kicker.upper(), 11, True, AKZENT)
        self.text(M, 22, 300, titel, 28, True)
        self.set_font("D", "", 8)
        self.set_text_color(*LEISE)
        self.set_xy(M, H - 10)
        self.cell(0, 5, "Polier.ai  ·  Challenge B: AI Site Manager Assistant")
        self.set_xy(W - M - 20, H - 10)
        self.cell(20, 5, f"{self.nr} / {FOLIEN}", align="R")

    def text(self, x, y, w, s, size=14, bold=False, farbe=TEXT, lh=None, align="L"):
        self.set_xy(x, y)
        self.set_font("D", "B" if bold else "", size)
        self.set_text_color(*farbe)
        self.multi_cell(w, lh or size * 0.52, s, align=align, new_x="LMARGIN", new_y="NEXT")
        if self.get_y() > H - 11 and self.nr > 1:
            WARN.append(f"Folie {self.nr}: Text in der Fusszeile: {s[:40]!r}")
        if self.grenze and self.get_y() > self.grenze:
            WARN.append(f"Folie {self.nr}: {self.get_y() - self.grenze:.1f} mm aus der Box: {s[:40]!r}")
        return self.get_y()

    def box(self, x, y, w, h, fill=FLAECHE, rand=RAND, r=3):
        self.set_fill_color(*fill)
        self.set_draw_color(*rand)
        self.set_line_width(0.4)
        self.rect(x, y, w, h, "DF", round_corners=True, corner_radius=r)

    def karte(self, x, y, w, h, titel, inhalt, tsize=16, size=12.5,
              fill=FLAECHE, tfarbe=DUNKEL, ifarbe=TEXT):
        self.box(x, y, w, h, fill=fill, rand=fill if fill != FLAECHE else RAND)
        self.grenze = y + h - 2
        yy = self.text(x + 6, y + 6, w - 12, titel, tsize, True, tfarbe)
        if inhalt:
            self.text(x + 6, yy + 2.5, w - 12, inhalt, size, farbe=ifarbe, lh=size * 0.5)
        self.grenze = None

    def pfeil(self, x1, y, x2):
        self.set_draw_color(*AKZENT)
        self.set_line_width(1)
        self.line(x1, y, x2 - 2, y)
        self.set_fill_color(*AKZENT)
        self.polygon([(x2, y), (x2 - 4, y - 2.5), (x2 - 4, y + 2.5)], style="F")

    def slogan(self, x, y, size):
        self.set_xy(x, y)
        self.set_font("D", "B", size)
        self.set_text_color(*TEXT)
        self.cell(self.get_string_width("Sprich. Wir schreiben"), size * 0.5, "Sprich. Wir schreiben")
        self.set_text_color(*ROT)
        self.cell(8, size * 0.5, ".")


d = Deck()
inhalt_b = W - 2 * M  # 298.67

# ===================================================== 1. Titel            (0:00-0:10)
d.seite()
# Dekor rechts: grosser Kreis im App-Rosa, angeschnitten
d.set_fill_color(*ROSE)
d.ellipse(W - 120, -30, 190, 190, "F")
d.set_fill_color(*ROT)
d.ellipse(W - 62, 128, 14, 14, "F")
if ICON.exists():
    d.image(str(ICON), M, 34, 26, 26)
d.text(M, 68, 200, "Polier.ai", 50, True)
d.slogan(M, 94, 28)
d.text(M, 114, 200, "Voice notes in, formal documents out.\nWith the site manager in control.",
       17, farbe=LEISE, lh=8.5)
d.text(M, 150, 200, "Challenge B · AI Site Manager Assistant", 12, True, AKZENT)

# ===================================================== 2. Problem          (0:10-0:40)
d.folie("Problem", "Site managers write instead of build")
kw = (inhalt_b - 2 * 8) / 3
probleme = [
    ("Hours of paperwork", "Daily reports, minutes, emails and formal notices, every day."),
    ("Strict rules", "Under VOB/B, delays and concerns must be reported in writing, "
                     "promptly and complete."),
    ("Money at stake", "A late or incomplete notice can cost the claim to extra time or money."),
]
for i, (t, s) in enumerate(probleme):
    rosa = i == 2
    d.karte(M + i * (kw + 8), 50, kw, 70, t, s, tsize=18, size=14,
            fill=ROSE if rosa else FLAECHE, tfarbe=ROSE_TEXT if rosa else DUNKEL,
            ifarbe=ROSE_TEXT if rosa else TEXT)
d.text(M, 134, inhalt_b, "The facts are scattered across notes, minutes, emails and photos, "
       "captured on a phone, outdoors, often by foremen whose first language is not German.",
       15, farbe=LEISE, lh=7.5)

# ===================================================== 3. Lösung           (0:40-1:15)
d.folie("Solution", "Speak. Check. Send.")
sw, sh, sy = 84, 60, 46
schritte = [
    ("1  Speak", "Dictate on site, in German, Turkish, Polish and more."),
    ("2  Check", "AI fills the fields and flags what is missing. Everything is editable."),
    ("3  Send", "A German letter or report as PDF or Word."),
]
gap = (inhalt_b - 3 * sw) / 2
for i, (t, s) in enumerate(schritte):
    x = M + i * (sw + gap)
    d.karte(x, sy, sw, sh, t, s, tsize=19, size=13.5)
    if i < 2:
        d.pfeil(x + sw + 3, sy + sh / 2, x + sw + gap - 3)
d.text(M, 118, inhalt_b, "Highlights", 13, True, AKZENT)
chips = ["7 letter types", "Cost impact in €", "Deadline watch", "Claim file as one PDF"]
cw = (inhalt_b - 3 * 6) / 4
for i, c in enumerate(chips):
    x = M + i * (cw + 6)
    d.box(x, 127, cw, 22, fill=ROSE, rand=ROSE, r=4)
    d.text(x + 3, 134, cw - 6, c, 13, True, ROSE_TEXT, align="C")
d.text(M, 156, inhalt_b, "Also: plan vs. actual, meeting protocols, daily reports with photos, "
       "a plan with real dates", 11, farbe=LEISE)

# ===================================================== 4. Ein Tag          (1:15-2:05)
d.folie("Use case demo", "A day in the life")
tage = [
    ("07:30", "Meeting recorded:\nprotocol with open items\nand deadlines"),
    ("10:15", "Foreman dictates in\nTurkish: German delay\nnotice with cost in €"),
    ("14:00", "Deadline watch: delivery\nmissing, no notice yet.\nOne tap to the letter"),
    ("17:00", "Claim file: all notes,\nletters and photos of\na trade as one PDF"),
]
tw = (inhalt_b - 3 * 6) / 4
for i, (zeit, s) in enumerate(tage):
    x = M + i * (tw + 6)
    d.box(x, 48, tw, 92)
    d.set_fill_color(*AKZENT)
    d.rect(x, 48, tw, 20, "F", round_corners=("TOP_LEFT", "TOP_RIGHT"), corner_radius=3)
    d.text(x + 6, 53, tw - 12, zeit, 20, True, WEISS)
    d.grenze = 138
    d.text(x + 6, 76, tw - 12, s, 14.5, lh=7.2)
    d.grenze = None
d.text(M, 150, inhalt_b, "Nothing leaves the app without the site manager’s review.",
       15, True, AKZENT, align="C")

# ===================================================== 5. Tech             (2:05-2:45)
d.folie("Tech stack & architecture", "Code for rules, AI for language")
by, bh = 48, 50
spalten = [
    (70, "Phone (PWA)", "HTML · CSS · JS\nWeb Speech API", WEISS),
    (56, "Cloudflare\nTunnel", "HTTPS", WEISS),
    (82, "FastAPI (Python)", "letter templates\ncost · date calculation\nPDF · Word export", WEISS),
    (66, "Claude API", "Sonnet / Opus 5.5\ntool use + JSON\nvision", ROSE),
]
gap = (inhalt_b - sum(s[0] for s in spalten)) / 3
x = M
for i, (w, t, s, fill) in enumerate(spalten):
    d.box(x, by, w, bh, fill=fill, rand=RAND if fill == WEISS else ROSE)
    d.grenze = by + bh - 2
    yy = d.text(x + 5, by + 5, w - 10, t, 14, True, DUNKEL, lh=6.5)
    d.text(x + 5, yy + 2.5, w - 10, s, 11.5, lh=5.8)
    d.grenze = None
    if i < 3:
        d.pfeil(x + w + 2, by + bh / 2, x + w + gap - 2)
    x += w + gap
regeln = [
    ("Code decides", "structure, legal references,\namounts in €, dates"),
    ("Claude writes", "facts from any language,\nGerman paragraphs, captions"),
    ("Human approves", "every field editable,\ncheck before export"),
]
rw = (inhalt_b - 2 * 8) / 3
for i, (t, s) in enumerate(regeln):
    d.karte(M + i * (rw + 8), 110, rw, 50, t, s, tsize=15, size=12.5,
            fill=ROSE if i == 2 else FLAECHE, tfarbe=ROSE_TEXT if i == 2 else DUNKEL)

# ===================================================== 6. Schluss          (2:45-3:00)
d.folie("What’s next", "From prototype to the construction site")
naechste = ["Login, team sync, EU hosting", "Connect to ERP and site diary software",
            "Weather data and calendar export"]
nw = (inhalt_b - 2 * 8) / 3
for i, s in enumerate(naechste):
    d.karte(M + i * (nw + 8), 50, nw, 42, s, "", tsize=15)
d.slogan(M, 112, 32)
d.text(M, 134, inhalt_b, "Less desk time. Notices on time. The site manager stays in charge.",
       16, farbe=LEISE)
d.text(M, 152, inhalt_b, "Thank you! Questions?", 18, True, AKZENT)

import sys
ziel = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "Polier_Pitch_Deck.pdf"
d.output(str(ziel))
print("geschrieben:", ziel, "Folien:", d.nr)
print("\n".join(WARN) or "Kein Text laeuft ueber.")
