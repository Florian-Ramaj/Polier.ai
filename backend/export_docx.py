"""Word-Export (.docx) aus BriefDaten. Gleiche Struktur wie der PDF-Export."""
import base64
import binascii
from io import BytesIO

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

from models import BriefDaten


def _foto_bytes(foto):
    """base64 -> BytesIO. None, wenn unbrauchbar."""
    rohdaten = foto.data or ""
    if "," in rohdaten[:64] and rohdaten.lstrip().startswith("data:"):
        rohdaten = rohdaten.split(",", 1)[1]
    try:
        bytes_ = base64.b64decode(rohdaten, validate=False)
    except (binascii.Error, ValueError):
        return None
    return BytesIO(bytes_) if len(bytes_) >= 100 else None


def _fotos_anhang(doc, fotos: list) -> None:
    """Haengt die Fotos als eigenes Kapitel an, ein Foto pro Seite."""
    if not fotos:
        return
    doc.add_page_break()
    doc.add_heading("Anhang: Fotodokumentation", level=1)
    for nummer, foto in enumerate(fotos, start=1):
        strom = _foto_bytes(foto)
        if strom is None:
            continue  # kaputtes Bild darf den Export nicht sprengen
        if nummer > 1:
            doc.add_page_break()
        _absatz(doc, f"Foto {nummer}", bold=True)
        if foto.beschreibung:
            _absatz(doc, foto.beschreibung, size=10)
        try:
            doc.add_picture(strom, width=Inches(6.0))
        except Exception:
            _absatz(doc, "[Bild konnte nicht eingebunden werden]", size=10)


def _absatz(doc, text: str, size: int | None = None, bold: bool = False, align=None):
    p = doc.add_paragraph()
    lines = text.split("\n")
    for i, line in enumerate(lines):
        run = p.add_run(line)
        run.bold = bold
        if size:
            run.font.size = Pt(size)
        if i < len(lines) - 1:
            run.add_break()
    if align is not None:
        p.alignment = align
    return p


def brief_als_docx(b: BriefDaten) -> bytes:
    doc = Document()
    normal = doc.styles["Normal"].font
    normal.name = "Calibri"
    normal.size = Pt(11)

    _absatz(doc, b.absender, size=9)
    _absatz(doc, b.empfaenger)
    doc.add_paragraph()
    _absatz(doc, b.ort_datum, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _absatz(doc, b.betreff, bold=True)
    _absatz(doc, b.anrede)
    for para in b.absaetze:
        _absatz(doc, para)
    doc.add_paragraph()
    _absatz(doc, b.gruss)
    doc.add_paragraph()
    _absatz(doc, b.unterzeichner)
    if b.kopie_an:
        _absatz(doc, "Kopie an: " + ", ".join(b.kopie_an), size=9)
    doc.add_paragraph()
    _absatz(doc, b.hinweis, size=8)

    _fotos_anhang(doc, getattr(b, "fotos", []) or [])

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def bericht_als_docx(b) -> bytes:
    """Generisches Dokument (Tagesbericht, Analyse, Zusammenfassung) als Word."""
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(11)
    doc.add_heading(b.titel, level=1)
    if b.untertitel:
        _absatz(doc, b.untertitel, size=9)
    for a in b.abschnitte:
        doc.add_heading(a.ueberschrift, level=2)
        _absatz(doc, a.text or "-")
    if b.hinweis:
        doc.add_paragraph()
        _absatz(doc, b.hinweis, size=8)
    _fotos_anhang(doc, getattr(b, "fotos", []) or [])
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()
