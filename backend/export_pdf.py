"""PDF-Export aus BriefDaten mit eingebundener DejaVu-Schrift (Umlaute, Euro)."""
import base64
import binascii
from io import BytesIO
from pathlib import Path

from fpdf import FPDF

from models import BriefDaten

FONT_DIR = Path(__file__).parent / "fonts"


def _foto_strom(foto):
    """base64 -> BytesIO. None, wenn unbrauchbar.

    Bewusst KEINE temporaere Datei: uvicorn laeuft mit --reload und
    startet neu, sobald im ueberwachten Ordner eine Datei auftaucht.
    Das hat mitten in der Anfrage die Verbindung gekappt.
    """
    rohdaten = foto.data or ""
    if rohdaten.lstrip().startswith("data:") and "," in rohdaten[:64]:
        rohdaten = rohdaten.split(",", 1)[1]  # data:-Praefix abschneiden
    try:
        bytes_ = base64.b64decode(rohdaten, validate=False)
    except (binascii.Error, ValueError):
        return None
    return BytesIO(bytes_) if len(bytes_) >= 100 else None


def _fotos_anhang(pdf: FPDF, fotos: list) -> None:
    """Haengt die Fotos an: ein Foto pro Seite, Beschriftung darueber.

    Beschriftung zuerst, Bild darunter: so haengt die Platzierung nicht davon
    ab, wo der Cursor nach einem Bild unbekannter Hoehe steht.
    """
    if not fotos:
        return
    nutzbare_breite = pdf.w - pdf.l_margin - pdf.r_margin
    for nummer, foto in enumerate(fotos, start=1):
        strom = _foto_strom(foto)
        if strom is None:
            continue  # kaputtes Bild darf den Export nicht sprengen
        pdf.add_page()
        if nummer == 1:
            pdf.set_font("DejaVu", "B", 14)
            pdf.multi_cell(0, 8, "Anhang: Fotodokumentation",
                           new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
        pdf.set_font("DejaVu", "B", 11)
        pdf.multi_cell(0, 6, f"Foto {nummer}", new_x="LMARGIN", new_y="NEXT")
        if foto.beschreibung:
            pdf.set_font("DejaVu", "", 10)
            pdf.multi_cell(0, 5, foto.beschreibung, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)
        try:
            pdf.image(strom, w=nutzbare_breite)
        except Exception:
            pdf.set_font("DejaVu", "", 10)
            pdf.multi_cell(0, 5, "[Bild konnte nicht eingebunden werden]",
                           new_x="LMARGIN", new_y="NEXT")


def brief_als_pdf(b: BriefDaten) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_margins(25, 20, 20)
    pdf.add_page()
    pdf.add_font("DejaVu", "", str(FONT_DIR / "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", str(FONT_DIR / "DejaVuSans-Bold.ttf"))

    # Absender (klein)
    pdf.set_font("DejaVu", "", 9)
    pdf.multi_cell(0, 5, b.absender)
    pdf.ln(4)

    # Empfaenger
    pdf.set_font("DejaVu", "", 11)
    pdf.multi_cell(0, 6, b.empfaenger)
    pdf.ln(6)

    # Ort / Datum (rechts)
    pdf.cell(0, 6, b.ort_datum, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Betreff (fett)
    pdf.set_font("DejaVu", "B", 11)
    pdf.multi_cell(0, 6, b.betreff)
    pdf.ln(4)

    # Anrede + Absaetze
    pdf.set_font("DejaVu", "", 11)
    pdf.multi_cell(0, 6, b.anrede)
    pdf.ln(2)
    for para in b.absaetze:
        pdf.multi_cell(0, 6, para)
        pdf.ln(2)

    # Gruss + Unterschrift
    pdf.ln(2)
    pdf.multi_cell(0, 6, b.gruss)
    pdf.ln(10)
    pdf.multi_cell(0, 6, b.unterzeichner)

    if b.kopie_an:
        pdf.ln(4)
        pdf.set_font("DejaVu", "", 9)
        pdf.multi_cell(0, 5, "Kopie an: " + ", ".join(b.kopie_an))

    # Hinweis (ganz klein)
    pdf.ln(8)
    pdf.set_font("DejaVu", "", 8)
    pdf.multi_cell(0, 4, b.hinweis)

    _fotos_anhang(pdf, getattr(b, "fotos", []) or [])

    return bytes(pdf.output())


def bericht_als_pdf(b) -> bytes:
    """Generisches Dokument (Tagesbericht, Analyse, Zusammenfassung) als PDF."""
    pdf = FPDF(format="A4")
    pdf.set_margins(20, 20, 20)
    pdf.add_page()
    pdf.add_font("DejaVu", "", str(FONT_DIR / "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", str(FONT_DIR / "DejaVuSans-Bold.ttf"))

    pdf.set_font("DejaVu", "B", 16)
    pdf.multi_cell(0, 8, b.titel, new_x="LMARGIN", new_y="NEXT")
    if b.untertitel:
        pdf.set_font("DejaVu", "", 10)
        pdf.multi_cell(0, 5, b.untertitel, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    for a in b.abschnitte:
        pdf.set_font("DejaVu", "B", 12)
        pdf.multi_cell(0, 7, a.ueberschrift, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("DejaVu", "", 10.5)
        pdf.multi_cell(0, 5.5, a.text or "-", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)
    if b.hinweis:
        pdf.ln(4)
        pdf.set_font("DejaVu", "", 8)
        pdf.multi_cell(0, 4, b.hinweis)
    _fotos_anhang(pdf, getattr(b, "fotos", []) or [])
    return bytes(pdf.output())
