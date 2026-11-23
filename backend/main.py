import os
import re
from typing import Optional
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from anthropic import Anthropic

from models import (
    AnalyzeRequest, Ereignis, BriefRequest, BriefDaten, ExportRequest, Stammdaten,
    Schreibvorschlag, TagesberichtAnalyseRequest, TagesberichtAnalyse, Abweichung,
    ZusammenfassungRequest, Zusammenfassung, OffenerPunkt,
    TagesberichtEntwurfRequest, Bericht, Abschnitt, BerichtExportRequest, Foto,
)
from briefvorlagen import baue_brief, BRIEFTYPEN, HINWEIS
from export_pdf import brief_als_pdf, bericht_als_pdf
from export_docx import brief_als_docx, bericht_als_docx

load_dotenv(Path(__file__).parent / ".env")
load_dotenv()

app = FastAPI(title="Bauleiter-Assistent")

# CORS: erlaubt einem extern gehosteten Frontend (z. B. Netlify) den Zugriff.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Anthropic() if os.getenv("ANTHROPIC_API_KEY") else None
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")

GRUNDREGELN = (
    "Du unterstuetzt einen Bauleiter einer ausfuehrenden Baufirma in Deutschland. "
    "Verwende ausschliesslich Fakten aus der Eingabe, erfinde nichts (keine Namen, Daten, Betraege). "
    "Fehlt etwas Wichtiges, benenne es. Du gibst keine Rechtsberatung, du lieferst Entwuerfe. "
    "Die Eingabe kann in jeder Sprache sein, etwa Tuerkisch, Polnisch, Rumaenisch, Kroatisch, "
    "Russisch, Ukrainisch, Arabisch oder Englisch, auch gemischt mit Deutsch. Deine Ausgabe ist "
    "trotzdem immer Deutsch, mit den ueblichen deutschen Baubegriffen (Estrich, Trockenbau, "
    "Bewehrung, Schalung usw.). Personen- und Firmennamen bleiben unveraendert."
)

SYSTEM_ANALYSE = GRUNDREGELN + (
    " Lies seine Stichworte und trage nur ein, was dort steht. "
    "In fehlende_angaben NUR die Feldnamen der fehlenden Pflichtfelder eintragen "
    "(gewerk, ursache, folge, dauer_tage), keine Saetze, nichts anderes. "
    "Steht eine Angabe im Text, gehoert sie ins Feld und NICHT in fehlende_angaben. "
    "Bei einem Unfall: verletzte Person in beteiligte, die Verletzung in folge."
)

TERMIN_HILFE = (
    " Steht im Text eine Zeitangabe (heute, morgen, uebermorgen, naechste Woche, "
    "ein Wochentag, ein Datum), gehoert sie in termin_text und als "
    "Datum JJJJ-MM-TT in termin. termin_text steht immer auf Deutsch, auch wenn die "
    "Eingabe eine andere Sprache hat (z. B. 'yarin' -> 'morgen', 'pojutrze' -> 'uebermorgen', "
    "'w piatek' -> 'am Freitag'). Steht dort nichts dergleichen, bleiben beide leer."
)

WOCHENTAGE = {"montag": 0, "dienstag": 1, "mittwoch": 2, "donnerstag": 3,
              "freitag": 4, "samstag": 5, "sonnabend": 5, "sonntag": 6}

MONATE = {"januar": 1, "jänner": 1, "februar": 2, "märz": 3, "april": 4, "mai": 5,
          "juni": 6, "juli": 7, "august": 8, "september": 9, "oktober": 10,
          "november": 11, "dezember": 12}

# Ausgeschriebene Tage, falls die Spracherkennung keine Ziffer schreibt
ORDNUNGSZAHLEN = {
    "erste": 1, "zweite": 2, "dritte": 3, "vierte": 4, "fünfte": 5, "sechste": 6,
    "siebte": 7, "siebente": 7, "achte": 8, "neunte": 9, "zehnte": 10, "elfte": 11,
    "zwölfte": 12, "dreizehnte": 13, "vierzehnte": 14, "fünfzehnte": 15,
    "sechzehnte": 16, "siebzehnte": 17, "achtzehnte": 18, "neunzehnte": 19,
    "zwanzigste": 20, "einundzwanzigste": 21, "zweiundzwanzigste": 22,
    "dreiundzwanzigste": 23, "vierundzwanzigste": 24, "fünfundzwanzigste": 25,
    "sechsundzwanzigste": 26, "siebenundzwanzigste": 27, "achtundzwanzigste": 28,
    "neunundzwanzigste": 29, "dreissigste": 30, "einunddreissigste": 31,
}


def _datum_bauen(tag: int, monat: int, jahr: Optional[int], heute: date) -> Optional[str]:
    """Baut ein Datum und schiebt es ins naechste Jahr, wenn es schon vorbei ist."""
    try:
        gefunden = date(jahr or heute.year, monat, tag)
    except ValueError:
        return None
    if jahr is None and gefunden < heute:
        try:
            gefunden = date(heute.year + 1, monat, tag)
        except ValueError:
            return None
    return str(gefunden)


def _termin_aus_text(text: str, heute: date) -> Optional[str]:
    """Rechnet eine Zeitangabe selbst aus, ohne Claude.

    Das ist genauer als jedes Sprachmodell und kostet nichts. Nur was hier
    nicht passt, bleibt bei dem, was Claude geliefert hat.
    """
    t = (text.lower().replace("ue", "ü").replace("ae", "ä")
         .replace("oe", "ö").replace("ß", "ss"))

    # "heute morgen" ist heute, nicht morgen
    if re.search(r"\bheute\s+(morgen|früh|vormittag|mittag|nachmittag|abend)", t):
        return str(heute)
    if re.search(r"\bübermorgen\b", t):
        return str(heute + timedelta(days=2))
    if re.search(r"\bmorgen\b", t):
        return str(heute + timedelta(days=1))
    if re.search(r"\bheute\b", t):
        return str(heute)

    # "in 3 Tagen", "in zwei Wochen"
    zahlwort = {"einer": 1, "einem": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5,
                "sechs": 6, "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "vierzehn": 14}
    treffer = re.search(r"in\s+(\d+|" + "|".join(zahlwort) + r")\s*(tag|woche)", t)
    if treffer:
        wert = treffer.group(1)
        anzahl = int(wert) if wert.isdigit() else zahlwort[wert]
        tage = anzahl * (7 if treffer.group(2) == "woche" else 1)
        return str(heute + timedelta(days=tage))

    # Datum wie 3.12., 03.12.2026 oder 24.12
    treffer = re.search(r"\b(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?", t)
    if treffer:
        gebaut = _datum_bauen(int(treffer.group(1)), int(treffer.group(2)),
                              int(treffer.group(3)) if treffer.group(3) else None, heute)
        if gebaut:
            return gebaut

    # Datum mit Monatsnamen: "3. Dezember", "am dritten Dezember", "15 Januar 2027"
    monatsnamen = "|".join(MONATE)
    treffer = re.search(r"\b(\d{1,2})\.?\s*(" + monatsnamen + r")\b\s*(\d{4})?", t)
    if treffer:
        gebaut = _datum_bauen(int(treffer.group(1)), MONATE[treffer.group(2)],
                              int(treffer.group(3)) if treffer.group(3) else None, heute)
        if gebaut:
            return gebaut
    worte = "|".join(sorted(ORDNUNGSZAHLEN, key=len, reverse=True))
    treffer = re.search(r"\b(" + worte + r")[nrms]?\s+(" + monatsnamen + r")\b\s*(\d{4})?", t)
    if treffer:
        gebaut = _datum_bauen(ORDNUNGSZAHLEN[treffer.group(1)], MONATE[treffer.group(2)],
                              int(treffer.group(3)) if treffer.group(3) else None, heute)
        if gebaut:
            return gebaut

    # Wochentag
    # - "naechste Woche Freitag" liegt sicher in der Kalenderwoche danach
    # - sonst der naechste dieses Namens, der noch kommt
    for name, nummer in WOCHENTAGE.items():
        if re.search(r"\b" + name + r"s?\b", t):
            if "nächste woche" in t or "kommende woche" in t:
                montag_danach = heute + timedelta(days=7 - heute.weekday())
                return str(montag_danach + timedelta(days=nummer))
            vorlauf = (nummer - heute.weekday()) % 7
            return str(heute + timedelta(days=vorlauf or 7))

    if "nächste woche" in t:
        return str(heute + timedelta(days=7))
    return None


SYSTEM_BRIEF = GRUNDREGELN + (
    " Du formulierst die inhaltlichen Absaetze eines formellen Schreibens an den Auftraggeber. "
    "Sachlich, hoeflich, in der Wir-Form. "
    "Schreibe KEINE Anrede, KEINEN Betreff, KEINEN Gruss und KEINE Einleitung - nur 2 bis 4 Sachabsaetze."
)

BRIEFTYP_HILFE = (
    "Brieftypen: behinderung (Verzoegerung/Stillstand durch Umstaende ausserhalb unseres Einflusses), "
    "mehrkosten (zusaetzliche oder geaenderte Leistungen), bedenken (gegen Planung, Anordnung oder Vorleistung), "
    "mangel (Mangel an einer Leistung), "
    "unfall (Arbeitsunfall oder Verletzung einer Person auf der Baustelle), "
    "reklamation (Beanstandung nach Abnahme), notiz (sonstiger Sachverhalt zum Festhalten)."
)


def _claude_tool(system: str, content, name: str, schema: dict, max_tokens: int = 2000) -> dict:
    """Ruft Claude auf und erzwingt ein strukturiertes Ergebnis ueber ein Tool."""
    if isinstance(content, str):
        content = content + f"\n\nGib das Ergebnis mit dem Tool {name} zurueck."
    else:
        content = content + [{"type": "text", "text": f"Gib das Ergebnis mit dem Tool {name} zurueck."}]
    try:
        msg = client.messages.create(
            model=MODEL, max_tokens=max_tokens, system=system,
            tools=[{"name": name, "description": "Gibt das Ergebnis strukturiert zurueck.",
                    "input_schema": schema}],
            tool_choice={"type": "auto"},
            messages=[{"role": "user", "content": content}],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude-Fehler: {type(e).__name__}: {e}")
    block = next((b for b in msg.content if b.type == "tool_use"), None)
    if block is None:
        raise HTTPException(status_code=502, detail="Claude hat kein strukturiertes Ergebnis geliefert.")
    return block.input


def _slug(s: str) -> str:
    """Macht aus 'Maengelanzeige - Estrich' ein dateitaugliches 'Maengelanzeige_Estrich'."""
    for k, v in {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
                 "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}.items():
        s = s.replace(k, v)
    s = s.replace(" - ", "_")
    s = re.sub(r"[^A-Za-z0-9_\-]+", "_", s).strip("_")
    s = re.sub(r"_+", "_", s)
    return s or "Dokument"


def _dateiname(basis: str, ext: str) -> str:
    """z. B. 'Behinderungsanzeige_Estrich_2026-11-21.pdf'."""
    return f"{_slug(basis)}_{date.today().isoformat()}.{ext}"


def _datei(data: bytes, media_type: str, name: str) -> StreamingResponse:
    return StreamingResponse(BytesIO(data), media_type=media_type,
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- Status
@app.get("/health")
def health():
    return {"status": "ok", "claude_aktiv": client is not None, "modell": MODEL if client else None}


# ---------------------------------------------------------------- 1. Stichworte -> Ereignis
@app.post("/analyze", response_model=Ereignis)
def analyze(req: AnalyzeRequest):
    if client is None:  # Demo-Antwort, solange kein API-Key da ist
        return Ereignis(abweichung=True, art="behinderung", gewerk="Erdarbeiten",
                        ursache="Leitungsplan fehlt, Bagger steht still",
                        folge="Baugrube kann nicht ausgehoben werden", dauer_tage=None,
                        aufgabe=req.text.strip()[:60],
                        termin=_termin_aus_text(req.text, date.today()),
                        fehlende_angaben=["dauer_tage"])
    heute = date.today()
    data = _claude_tool(SYSTEM_ANALYSE + " " + BRIEFTYP_HILFE + TERMIN_HILFE,
                        f"Heute ist {heute.strftime('%A, %d.%m.%Y')}.\n\n{req.text}",
                        "ereignis_erfassen", Ereignis.model_json_schema(), 1000)
    ereignis = Ereignis(**data)
    # Das Datum rechnet Python, nicht das Sprachmodell.
    selbst = _termin_aus_text(ereignis.termin_text or req.text, heute)
    if selbst:
        ereignis.termin = selbst
    return ereignis


# ---------------------------------------------------------------- 2. Ereignis -> Brief
def _schreibe_absaetze(ereignis: Ereignis, brieftyp: str) -> list[str]:
    """Claude schreibt nur die Fall-Absaetze (ohne Key: Demo-Text)."""
    if client is None:
        g = ereignis.gewerk or "die betroffene Leistung"
        u = ereignis.ursache or "ein eingetretenes Ereignis"
        f = ereignis.folge or "eine Beeinträchtigung des Bauablaufs"
        teile = [f"Betroffen ist das Gewerk {g}. Ursache ist: {u}.",
                 f"Als Folge ergibt sich: {f}."]
        if ereignis.dauer_tage:
            teile.append(f"Nach derzeitiger Einschätzung ist mit einer Verzögerung "
                         f"von rund {ereignis.dauer_tage} Tagen zu rechnen.")
        return teile

    typ = BRIEFTYPEN.get(brieftyp, BRIEFTYPEN["behinderung"])
    data = _claude_tool(
        SYSTEM_BRIEF,
        f"Brieftyp: {typ['label']} ({typ['rechtsgrundlage']}).\n"
        f"Fakten (nur diese verwenden): {ereignis.model_dump(exclude={'fehlende_angaben'})}\n"
        f"Einleitungssatz (\"hiermit zeigen wir ... an\") und Schlusssatz stehen bereits im Brief. "
        f"Beginne direkt mit dem Sachverhalt, wiederhole die Rechtsgrundlage nicht.",
        "absaetze_schreiben",
        {"type": "object",
         "properties": {"absaetze": {"type": "array", "items": {"type": "string"}}},
         "required": ["absaetze"]},
        1200,
    )
    return data["absaetze"]


@app.post("/brief", response_model=BriefDaten)
def brief(req: BriefRequest):
    stamm = req.stammdaten or Stammdaten()
    absaetze = _schreibe_absaetze(req.ereignis, req.brieftyp)
    return baue_brief(req.ereignis, req.brieftyp, stamm, absaetze)


# ---------------------------------------------------------------- 3. Tagesbericht-Analyse
@app.post("/tagesbericht/analyse", response_model=TagesberichtAnalyse)
def tagesbericht_analyse(req: TagesberichtAnalyseRequest):
    # Rechnen macht der Code (nachvollziehbar), bewerten macht Claude.
    abw = []
    for l in req.leistungen:
        pct = round((l.ist - l.soll) / l.soll * 100, 1) if l.soll else 0.0
        abw.append(Abweichung(gewerk=l.gewerk, taetigkeit=l.taetigkeit, einheit=l.einheit,
                              soll=l.soll, ist=l.ist, abweichung_prozent=pct,
                              kritisch=pct <= -req.schwelle_prozent))
    kritische = [a for a in abw if a.kritisch]

    # Reines Rechnen: keine Anfrage an Claude, also keine Tokens.
    if not req.mit_bewertung:
        return TagesberichtAnalyse(abweichungen=abw, bewertung="", vorschlaege=[])

    if client is None:
        vorschlaege = [Schreibvorschlag(
            brieftyp="behinderung",
            begruendung=f"Leistung {a.abweichung_prozent} % unter Plan.",
            ereignis=Ereignis(abweichung=True, art="behinderung", gewerk=a.gewerk,
                              ursache=req.notizen or None,
                              folge=f"{a.taetigkeit}: {a.ist} statt {a.soll} {a.einheit}",
                              fehlende_angaben=[] if req.notizen else ["ursache"]),
        ) for a in kritische]
        bewertung = (f"{len(kritische)} von {len(abw)} Positionen liegen mehr als "
                     f"{req.schwelle_prozent:g} % unter Plan." if kritische
                     else "Keine kritischen Abweichungen.")
        return TagesberichtAnalyse(abweichungen=abw, bewertung=bewertung, vorschlaege=vorschlaege)

    tabelle = "\n".join(f"- {a.gewerk} / {a.taetigkeit}: Soll {a.soll} {a.einheit}, Ist {a.ist} "
                        f"{a.einheit}, {a.abweichung_prozent:+} %{' KRITISCH' if a.kritisch else ''}"
                        for a in abw)
    schema = {
        "type": "object",
        "properties": {
            "bewertung": {"type": "string", "description": "3-6 Saetze: Lage, Ursachen laut Notizen, Auswirkungen"},
            "vorschlaege": {"type": "array", "items": Schreibvorschlag.model_json_schema(),
                            "description": "Nur wenn ein Schreiben wirklich angebracht ist"},
        },
        "required": ["bewertung", "vorschlaege"],
    }
    schema = {**schema, "$defs": schema["properties"]["vorschlaege"]["items"].pop("$defs", {})}
    data = _claude_tool(
        GRUNDREGELN + " Bewerte den Soll/Ist-Vergleich eines Bautagesberichts. " + BRIEFTYP_HILFE
        + " Schlage Schreiben nur vor, wenn eine Abweichung kritisch ist und die Ursache "
          "ausserhalb unseres Verantwortungsbereichs liegen koennte. Fehlende Angaben in "
          "ereignis.fehlende_angaben eintragen.",
        f"Datum: {req.datum or 'heute'}\nLeistungen:\n{tabelle}\n\nNotizen des Bauleiters:\n{req.notizen or '-'}",
        "analyse_ausgeben", schema, 2000,
    )
    return TagesberichtAnalyse(abweichungen=abw, bewertung=data.get("bewertung", ""),
                               vorschlaege=data.get("vorschlaege", []))


# ---------------------------------------------------------------- 4. Zusammenfassung
QUELLEN = {"protokoll": "Besprechungsprotokoll", "bautagebuch": "Bautagebuch-Einträge",
           "email": "E-Mail-Verkehr"}


@app.post("/zusammenfassung", response_model=Zusammenfassung)
def zusammenfassung(req: ZusammenfassungRequest):
    if client is None:
        zeilen = [z.strip("-• ").strip() for z in req.text.splitlines() if z.strip()]
        offen = [OffenerPunkt(punkt=z) for z in zeilen
                 if any(w in z.lower() for w in ("bis ", "offen", "klären", "klaeren", "frist"))]
        return Zusammenfassung(kurzfassung=" ".join(zeilen[:2])[:400] or "-",
                               offene_punkte=offen,
                               risiken=["Demo-Modus: ohne API-Key nur einfache Stichwortsuche."])
    schema = Zusammenfassung.model_json_schema()
    data = _claude_tool(
        GRUNDREGELN + " Fasse Baustellen-Dokumente strukturiert zusammen. Hebe offene Punkte mit "
        "Verantwortlichem und Frist hervor (Frist exakt wie im Text, sonst leer). "
        "Trenne sauber: entscheidungen sind beschlossene Festlegungen, offene_punkte sind "
        "Aufgaben, die noch jemand erledigen muss. Als teilnehmer nur Namen oder Firmen, die "
        "im Text wirklich genannt werden; bei einer Mitschrift ohne Namen bleibt die Liste leer. "
        + BRIEFTYP_HILFE
        + " Schlage ein Schreiben nur vor, wenn der Text einen klaren Anlass dafuer enthaelt.",
        f"Art: {QUELLEN.get(req.quelle, req.quelle)}\n\n{req.text}",
        "zusammenfassung_ausgeben", schema, 3000,
    )
    return Zusammenfassung(**data)


# ---------------------------------------------------------------- 5. Tagesbericht-Entwurf
STANDARD_ABSCHNITTE = ["Wetter", "Personal und Geräte", "Ausgeführte Leistungen",
                       "Termine und Besuche", "Lieferungen", "Behinderungen und Besonderheiten",
                       "Fotodokumentation"]


@app.post("/tagesbericht/entwurf", response_model=Bericht)
def tagesbericht_entwurf(req: TagesberichtEntwurfRequest):
    datum = req.datum or date.today().strftime("%d.%m.%Y")
    titel = f"Bautagesbericht vom {datum}"
    untertitel = f"Bauvorhaben: {req.bauvorhaben}" if req.bauvorhaben else ""

    if client is None:
        abschnitte = [Abschnitt(ueberschrift=s, text="") for s in STANDARD_ABSCHNITTE]
        abschnitte[2].text = req.notizen
        abschnitte[3].text = req.termine
        abschnitte[6].text = f"{len(req.fotos)} Foto(s) angehängt (Demo-Modus: keine Bildauswertung)."
        return Bericht(titel=titel, untertitel=untertitel, abschnitte=abschnitte,
                       hinweis=HINWEIS, fotos=list(req.fotos[:6]))

    content = []
    for i, f in enumerate(req.fotos[:6]):  # max. 6 Fotos -> Kosten begrenzt
        content.append({"type": "text", "text": f"Foto {i + 1}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": f.media_type,
                                                    "data": f.data}})
    content.append({"type": "text", "text":
                    f"Datum: {datum}\nNotizen des Bauleiters:\n{req.notizen or '-'}\n\n"
                    f"Termine:\n{req.termine or '-'}\n\n"
                    f"Erstelle einen Bautagesbericht mit genau diesen Abschnitten: "
                    f"{', '.join(STANDARD_ABSCHNITTE)}. Unbekanntes als 'keine Angabe' kennzeichnen. "
                    f"Fotos nur beschreiben, was sicher erkennbar ist. "
                    f"Gib zusaetzlich fuer jedes Foto in bildunterschriften EINE kurze "
                    f"Zeile (max. 12 Woerter), in derselben Reihenfolge wie die Fotos."})
    data = _claude_tool(
        GRUNDREGELN + " Du schreibst knappe, sachliche Bautagesberichte.",
        content, "bericht_ausgeben",
        {"type": "object",
         "properties": {"abschnitte": {"type": "array", "items": {
             "type": "object",
             "properties": {"ueberschrift": {"type": "string"}, "text": {"type": "string"}},
             "required": ["ueberschrift", "text"]}},
             "bildunterschriften": {"type": "array", "items": {"type": "string"}}},
         "required": ["abschnitte"]},
        2500,
    )
    # Fotos wandern in den Bericht, damit der Export sie einbetten kann.
    unterschriften = data.get("bildunterschriften") or []
    fotos = []
    for i, f in enumerate(req.fotos[:6]):
        fotos.append(Foto(media_type=f.media_type, data=f.data,
                          beschreibung=f.beschreibung or (
                              unterschriften[i] if i < len(unterschriften) else "")))
    return Bericht(titel=titel, untertitel=untertitel,
                   abschnitte=[Abschnitt(**a) for a in data["abschnitte"]],
                   hinweis=HINWEIS, fotos=fotos)


# ---------------------------------------------------------------- Export
@app.post("/export/pdf")
def export_pdf(req: ExportRequest):
    return _datei(brief_als_pdf(req.brief), "application/pdf",
                  _dateiname(req.brief.betreff, "pdf"))


@app.post("/export/docx")
def export_docx(req: ExportRequest):
    return _datei(brief_als_docx(req.brief),
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  _dateiname(req.brief.betreff, "docx"))


@app.post("/export/bericht/pdf")
def export_bericht_pdf(req: BerichtExportRequest):
    return _datei(bericht_als_pdf(req.bericht), "application/pdf",
                  _dateiname(req.bericht.titel, "pdf"))


@app.post("/export/bericht/docx")
def export_bericht_docx(req: BerichtExportRequest):
    return _datei(bericht_als_docx(req.bericht),
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  _dateiname(req.bericht.titel, "docx"))


# --- Frontend mitausliefern -------------------------------------------------
# Liegt das Frontend im Repo, serviert das Backend es gleich mit.
# Dann brauchen App und API nur EINE Adresse (einen Tunnel) und es gibt
# kein CORS-Problem mehr. Muss nach allen API-Routen stehen, weil der
# Mount auf "/" sonst alles abfangen wuerde.
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
