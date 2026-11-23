from typing import Optional
from pydantic import BaseModel, Field


# --- Eingabe fuer die Analyse (Anfrage 1) ---
class AnalyzeRequest(BaseModel):
    text: str


# --- Strukturiertes Ereignis, von Claude aus den Stichworten gefuellt ---
class Ereignis(BaseModel):
    abweichung: bool = Field(description="Gibt es eine Abweichung vom Plan?")
    art: Optional[str] = Field(None, description="behinderung | mehrkosten | bedenken | mangel | unfall | reklamation | notiz | sonstiges")
    gewerk: Optional[str] = Field(
        None,
        description="Betroffenes Gewerk ODER Bauabschnitt/Bereich, z. B. Estrich, "
                    "Rohbau, Dach, Treppenhaus, 2. OG. Ein genannter Bereich zaehlt "
                    "als Gewerk und darf nicht leer bleiben.",
    )
    beteiligte: Optional[str] = Field(
        None,
        description="Im Text genannte Personen mit Rolle, z. B. 'Mitarbeiter Ali Genc' "
                    "oder 'Nachunternehmer Firma Huber'. Nur was dort steht.",
    )
    ursache: Optional[str] = Field(
        None,
        description="Was ist passiert und wodurch, z. B. Sturz von der Leiter, "
                    "fehlender Leitungsplan, Lieferverzug.",
    )
    folge: Optional[str] = Field(
        None,
        description="Auswirkung: Schaden, Verletzung, Stillstand, Arbeitsausfall. "
                    "Bei einem Unfall gehoert die Verletzung der Person hierher.",
    )
    dauer_tage: Optional[int] = None
    aufgabe: Optional[str] = Field(
        None,
        description="Wenn im Text etwas ansteht oder zu erledigen ist (Lieferung, Termin, "
                    "Rueckruf, Pruefung), die Aufgabe in 3 bis 6 Woertern, z. B. "
                    "'Rigips-Lieferung annehmen'. Sonst leer.",
    )
    termin_text: Optional[str] = Field(
        None,
        description="Die Zeitangabe wortwoertlich aus dem Text, z. B. 'uebermorgen', "
                    "'naechsten Montag', 'am 3.12.'. Nur wenn eine im Text steht.",
    )
    termin: Optional[str] = Field(
        None,
        description="Dieselbe Zeitangabe als Datum JJJJ-MM-TT, gerechnet ab dem heutigen "
                    "Datum aus der Eingabe. Leer, wenn keine Zeitangabe im Text steht.",
    )
    fehlende_angaben: list[str] = Field(
        default_factory=list,
        description="Fehlende Pflichtangaben als KURZE Feldnamen, z. B. "
                    "['gewerk', 'ursache', 'dauer_tage']. Keine Saetze, keine Erklaerungen.",
    )


# --- Stammdaten pro Projekt (einmal hinterlegt, gelten fuer jeden Brief) ---
class Stammdaten(BaseModel):
    absender_firma: str = "Musterbau GmbH"
    absender_anschrift: str = "Baustraße 1, 80331 München"
    absender_unterzeichner: str = "M. Mustermann (Bauleitung)"
    empfaenger_name: str = "Bauherr Mustermann AG"
    empfaenger_anschrift: str = "Hauptstraße 10, 80333 München"
    kopie_an: list[str] = Field(default_factory=lambda: ["Architekturbüro Plan & Bau"])
    bauvorhaben: str = "Neubau Wohnanlage, München"
    ort: str = "München"
    # Tagessaetze der eigenen Firma, netto. 0 heisst: keine Kostenangabe im Brief.
    kosten_personal_tag: float = 0
    kosten_geraete_tag: float = 0


# --- Eingabe fuer den Brief (Anfrage 2) ---
class BriefRequest(BaseModel):
    ereignis: Ereignis
    brieftyp: str = "behinderung"  # behinderung | mehrkosten | bedenken
    stammdaten: Optional[Stammdaten] = None


# --- Fertiger Brief: Geruest (Code) + Absaetze (Claude). Vom Bauleiter editierbar. ---
# --- Foto als Anhang (base64, kommt vom Handy) ---
class Foto(BaseModel):
    media_type: str = "image/jpeg"
    data: str  # base64, mit oder ohne data:-Praefix
    beschreibung: str = ""  # Bildunterschrift, z. B. "Riss in Trennwand, 2. OG"


class BriefDaten(BaseModel):
    brieftyp: str
    rechtsgrundlage: str
    absender: str
    empfaenger: str
    kopie_an: list[str]
    ort_datum: str
    betreff: str
    anrede: str
    absaetze: list[str]
    gruss: str
    unterzeichner: str
    hinweis: str
    fotos: list[Foto] = Field(default_factory=list)  # Anhang: Fotodokumentation


# --- Eingabe fuer den Export (der ggf. korrigierte Brief) ---
class ExportRequest(BaseModel):
    brief: BriefDaten


# --- Schreibvorschlag: KI schlaegt ein Schreiben vor, Bauleiter entscheidet ---
class Schreibvorschlag(BaseModel):
    brieftyp: str = Field(description="behinderung | mehrkosten | bedenken | mangel | unfall | reklamation | notiz")
    begruendung: str = Field(description="Kurz: warum dieses Schreiben sinnvoll ist")
    ereignis: Ereignis


# --- Tagesbericht-Analyse (Soll/Ist-Vergleich) ---
class Leistung(BaseModel):
    gewerk: str
    taetigkeit: str = ""
    einheit: str = ""
    soll: float
    ist: float


class TagesberichtAnalyseRequest(BaseModel):
    datum: str = ""
    leistungen: list[Leistung]
    notizen: str = ""
    schwelle_prozent: float = 15
    mit_bewertung: bool = True  # False = nur rechnen, kostet keine Tokens


class Abweichung(BaseModel):
    gewerk: str
    taetigkeit: str
    einheit: str
    soll: float
    ist: float
    abweichung_prozent: float
    kritisch: bool


class TagesberichtAnalyse(BaseModel):
    abweichungen: list[Abweichung]
    bewertung: str
    vorschlaege: list[Schreibvorschlag] = Field(default_factory=list)


# --- Zusammenfassung von Protokollen, Bautagebuch, E-Mails ---
class ZusammenfassungRequest(BaseModel):
    text: str
    quelle: str = "protokoll"  # protokoll | bautagebuch | email


class OffenerPunkt(BaseModel):
    punkt: str
    verantwortlich: Optional[str] = None
    frist: Optional[str] = None
    prioritaet: Optional[str] = Field(None, description="hoch | mittel | niedrig")


class Zusammenfassung(BaseModel):
    titel: str = Field("", description="Thema der Besprechung, kurz. Leer, wenn unklar")
    teilnehmer: list[str] = Field(
        default_factory=list,
        description="Nur Namen oder Firmen, die im Text wirklich vorkommen. Nichts erfinden",
    )
    kurzfassung: str
    entscheidungen: list[str] = Field(
        default_factory=list,
        description="Was verbindlich beschlossen wurde, je ein vollstaendiger Satz",
    )
    offene_punkte: list[OffenerPunkt] = Field(default_factory=list)
    risiken: list[str] = Field(default_factory=list)
    vorschlaege: list[Schreibvorschlag] = Field(default_factory=list)


# --- Tagesbericht-Entwurf aus Notizen, Terminen, Fotos ---


class TagesberichtEntwurfRequest(BaseModel):
    datum: str = ""
    bauvorhaben: str = ""
    notizen: str = ""
    termine: str = ""
    fotos: list[Foto] = Field(default_factory=list)


# --- Generisches Dokument (Bericht) fuer PDF/Word-Export ---
class Abschnitt(BaseModel):
    ueberschrift: str
    text: str


class Bericht(BaseModel):
    titel: str
    untertitel: str = ""
    abschnitte: list[Abschnitt]
    hinweis: str = ""
    fotos: list[Foto] = Field(default_factory=list)  # Anhang: Fotodokumentation


class BerichtExportRequest(BaseModel):
    bericht: Bericht
