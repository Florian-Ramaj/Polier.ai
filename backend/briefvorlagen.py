"""Briefvorlagen: Das Geruest ist Code, nur die Fall-Absaetze kommen von Claude.

So sehen alle Brieftypen einheitlich aus. Ein neuer Brieftyp ist nur ein
weiterer Eintrag in BRIEFTYPEN, kein neuer Code.
"""
from datetime import date

from models import Ereignis, Stammdaten, BriefDaten


BRIEFTYPEN = {
    "behinderung": {
        "label": "Behinderungsanzeige",
        "betreff": "Behinderungsanzeige - {gewerk}",
        "rechtsgrundlage": "§ 6 Abs. 1 VOB/B",
        "einleitung": "hiermit zeigen wir Ihnen nach {recht} eine Behinderung der Bauausführung im Gewerk {gewerk} an.",
    },
    "mehrkosten": {
        "label": "Mehrkostenankündigung",
        "betreff": "Ankündigung von Mehrkosten - {gewerk}",
        "rechtsgrundlage": "§ 2 Abs. 5 und 6 VOB/B",
        "einleitung": "hiermit kündigen wir Ihnen nach {recht} einen Anspruch auf zusätzliche Vergütung im Gewerk {gewerk} an.",
    },
    "bedenken": {
        "label": "Bedenkenanzeige",
        "betreff": "Bedenkenanzeige - {gewerk}",
        "rechtsgrundlage": "§ 4 Abs. 3 VOB/B",
        "einleitung": "hiermit melden wir Ihnen nach {recht} Bedenken gegen die vorgesehene Ausführung im Gewerk {gewerk} an.",
    },
    "mangel": {
        "label": "Mängelanzeige",
        "betreff": "Mängelanzeige - {gewerk}",
        "rechtsgrundlage": "§ 4 Abs. 7 VOB/B",
        "einleitung": "hiermit zeigen wir Ihnen nach {recht} einen Mangel an der Leistung im Gewerk {gewerk} an und bitten um Beseitigung.",
    },
    "reklamation": {
        "label": "Reklamation",
        "betreff": "Reklamation - {gewerk}",
        "rechtsgrundlage": "§ 13 VOB/B",
        "einleitung": "hiermit reklamieren wir Ihnen gegenüber nach {recht} die Ausführung im Gewerk {gewerk} und bitten um Abhilfe.",
    },
    "unfall": {
        "label": "Unfallmeldung",
        "betreff": "Unfallmeldung - {gewerk}",
        "rechtsgrundlage": "§ 193 SGB VII",
        "einleitung": "hiermit melden wir Ihnen einen Arbeitsunfall im Gewerk {gewerk} (Unfallanzeige nach {recht}).",
    },
    "notiz": {
        "label": "Aktennotiz",
        "betreff": "Aktennotiz - {gewerk}",
        "rechtsgrundlage": "",
        "einleitung": "wir halten zum Gewerk {gewerk} den folgenden Sachverhalt fest.",
    },
}

HINWEIS = (
    "Dieser Entwurf wurde mit KI-Unterstützung erstellt und ist keine Rechtsberatung. "
    "Inhalt, Empfänger und Fristen sind vor dem Versand zu prüfen."
)


def euro(betrag: float) -> str:
    """1234.5 -> '1.234,50 EUR' in deutscher Schreibweise."""
    text = f"{betrag:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return text + " €"


def kostenabsatz(ereignis: Ereignis, brieftyp: str, stammdaten: Stammdaten) -> str:
    """Rechnet die Kostenfolge aus Dauer und Tagessaetzen. Leer, wenn etwas fehlt.

    Die Zahlen kommen aus den Firmendaten und der Dauer, nie vom Sprachmodell.
    """
    if brieftyp not in ("behinderung", "mehrkosten"):
        return ""
    tage = ereignis.dauer_tage or 0
    personal = max(stammdaten.kosten_personal_tag or 0, 0)
    geraete = max(stammdaten.kosten_geraete_tag or 0, 0)
    if tage <= 0 or (personal + geraete) <= 0:
        return ""
    tagessatz = personal + geraete
    summe = tage * tagessatz
    rechnung = f"{tage} {'Tag' if tage == 1 else 'Tagen'} zu je {euro(tagessatz)}"
    if personal and geraete:
        rechnung += f" (Personal {euro(personal)}, Geräte und Vorhaltung {euro(geraete)})"
    if brieftyp == "behinderung":
        return (f"Nach unserer vorläufigen Berechnung entstehen durch die Behinderung Mehrkosten "
                f"von rund {euro(summe)} netto, gerechnet mit {rechnung}. Die Geltendmachung nach "
                f"§ 6 Abs. 6 VOB/B behalten wir uns ausdrücklich vor.")
    return (f"Nach vorläufiger Schätzung belaufen sich die Mehrkosten auf rund {euro(summe)} "
            f"netto, gerechnet mit {rechnung}. Ein prüffähiges Nachtragsangebot reichen wir nach.")


def baue_brief(ereignis: Ereignis, brieftyp: str, stammdaten: Stammdaten,
               absaetze: list[str]) -> BriefDaten:
    """Setzt das feste Geruest mit den variablen Absaetzen zusammen."""
    typ = BRIEFTYPEN.get(brieftyp, BRIEFTYPEN["behinderung"])
    gewerk = ereignis.gewerk or "Bauleistung"

    intro = (typ["einleitung"].format(recht=typ["rechtsgrundlage"], gewerk=gewerk)
             + f' Das betrifft das Bauvorhaben "{stammdaten.bauvorhaben}".')
    closing = ("Wir bitten um Kenntnisnahme und um Bestätigung des Eingangs. "
               "Für die Abstimmung des weiteren Vorgehens stehen wir Ihnen gern zur Verfügung.")
    kosten = kostenabsatz(ereignis, brieftyp, stammdaten)
    voll_absaetze = [intro] + list(absaetze) + ([kosten] if kosten else []) + [closing]

    return BriefDaten(
        brieftyp=typ["label"],
        rechtsgrundlage=typ["rechtsgrundlage"],
        absender=f"{stammdaten.absender_firma}\n{stammdaten.absender_anschrift}",
        empfaenger=f"{stammdaten.empfaenger_name}\n{stammdaten.empfaenger_anschrift}",
        kopie_an=stammdaten.kopie_an,
        ort_datum=f"{stammdaten.ort}, den {date.today().strftime('%d.%m.%Y')}",
        betreff=typ["betreff"].format(gewerk=gewerk),
        anrede="Sehr geehrte Damen und Herren,",
        absaetze=voll_absaetze,
        gruss="Mit freundlichen Grüßen",
        unterzeichner=stammdaten.absender_unterzeichner,
        hinweis=HINWEIS,
    )
