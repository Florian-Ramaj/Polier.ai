# API – Bauleiter-Assistent (Backend)

**Basis-URL:** über den Cloudflare-Tunnel, z. B. `https://xyz.trycloudflare.com`
(lokal: `http://127.0.0.1:8000`). Im Frontend **an genau einer Stelle** führen:

```js
const API = "https://xyz.trycloudflare.com"; // ändert sich bei jedem Tunnel-Neustart!
```

- Alle Endpunkte: `POST` mit `Content-Type: application/json` (außer `/health`).
- CORS ist offen (`*`), Aufrufe von Netlify/localhost funktionieren direkt.
- Die Basis-URL allein liefert `{"detail":"Not Found"}`. Das ist normal.
- Interaktiv testen: `API + "/docs"` (Swagger-UI mit allen Schemas).
- Ohne API-Key im Backend gibt es **Demo-Antworten mit identischer Struktur**.
- Fehler: HTTP 4xx/5xx mit `{"detail": "..."}`. Claude-Aufrufe dauern 3–15 s,
  also **Ladeanzeige einbauen**.

---

## GET /health
```json
{ "status": "ok", "claude_aktiv": true, "modell": "claude-sonnet-5-5" }
```
`claude_aktiv: false` → Demo-Modus (z. B. als Badge anzeigen).

---

## Gemeinsame Objekte

**Ereignis** (Ergebnis von `/analyze`, Eingabe für `/brief`):
```json
{
  "abweichung": true,
  "art": "behinderung",          // behinderung | mehrkosten | bedenken | mangel | sonstiges
  "gewerk": "Erdarbeiten",
  "ursache": "Leitungsplan fehlt",
  "folge": "Bagger steht still",
  "dauer_tage": 2,               // oder null
  "fehlende_angaben": ["dauer_tage"]
}
```
Ist `fehlende_angaben` nicht leer: Felder hervorheben und den Bauleiter
nachtragen lassen (**Human-in-the-loop**).

**Schreibvorschlag** (kommt aus Analyse/Zusammenfassung):
```json
{ "brieftyp": "behinderung", "begruendung": "Leistung 42 % unter Plan", "ereignis": { ...Ereignis... } }
```
→ Button „Brief entwerfen" schickt `ereignis` + `brieftyp` an `/brief`.

**Bericht** (generisches Dokument, für Export):
```json
{
  "titel": "Bautagesbericht vom 21.11.2026",
  "untertitel": "Bauvorhaben: ...",
  "abschnitte": [ { "ueberschrift": "Wetter", "text": "..." } ],
  "hinweis": "..."
}
```

---

## 1. Formular-Assistent: Stichworte → Brief

### POST /analyze
```json
{ "text": "Bagger steht seit 10 Uhr, Leitungsplan vom Bauherrn fehlt" }
```
→ **Ereignis**. Text kann aus Spracheingabe kommen (siehe unten).

### POST /brief
```json
{
  "ereignis": { ...ggf. korrigiertes Ereignis... },
  "brieftyp": "behinderung",     // behinderung | mehrkosten | bedenken | mangel
  "stammdaten": {                // optional, sonst Demo-Stammdaten
    "absender_firma": "Musterbau GmbH",
    "absender_anschrift": "Baustrasse 1, 80331 Muenchen",
    "absender_unterzeichner": "M. Mustermann (Bauleitung)",
    "empfaenger_name": "Bauherr Mustermann AG",
    "empfaenger_anschrift": "Hauptstrasse 10, 80333 Muenchen",
    "kopie_an": ["Architekturbuero Plan & Bau"],
    "bauvorhaben": "Neubau Wohnanlage, Muenchen",
    "ort": "Muenchen"
  }
}
```
→ **BriefDaten** (alle Felder editierbar anzeigen):
```json
{
  "brieftyp": "Behinderungsanzeige", "rechtsgrundlage": "§ 6 Abs. 1 VOB/B",
  "absender": "...", "empfaenger": "...", "kopie_an": ["..."],
  "ort_datum": "Muenchen, den 21.11.2026", "betreff": "...", "anrede": "...",
  "absaetze": ["...", "..."], "gruss": "...", "unterzeichner": "...", "hinweis": "..."
}
```

### POST /export/pdf · POST /export/docx
```json
{ "brief": { ...BriefDaten (bearbeitet)... } }
```
→ Datei (Blob). Download siehe Code-Beispiel unten.

---

## 2. Tagesbericht-Analyse (Soll/Ist, Abweichungs-Alarm)

### POST /tagesbericht/analyse
```json
{
  "datum": "21.11.2026",
  "leistungen": [
    { "gewerk": "Mauerwerk", "taetigkeit": "KS-Wand EG", "einheit": "m2", "soll": 120, "ist": 70 },
    { "gewerk": "Estrich", "taetigkeit": "Heizestrich", "einheit": "m2", "soll": 200, "ist": 195 }
  ],
  "notizen": "Kran von 8-11 Uhr defekt, Steinlieferung verspätet",
  "schwelle_prozent": 15
}
```
→
```json
{
  "abweichungen": [
    { "gewerk": "Mauerwerk", "taetigkeit": "KS-Wand EG", "einheit": "m2",
      "soll": 120, "ist": 70, "abweichung_prozent": -41.7, "kritisch": true }
  ],
  "bewertung": "Text ...",
  "vorschlaege": [ { ...Schreibvorschlag... } ]
}
```
Kritische Zeilen rot markieren. `vorschlaege` als **Alarm** anzeigen
(„Behinderungsanzeige vorbereiten?") → `/brief`.

---

## 3. Zusammenfassung: Protokolle, Bautagebuch, E-Mails

### POST /zusammenfassung
```json
{ "text": "...eingefügter Text...", "quelle": "protokoll" }   // protokoll | bautagebuch | email
```
→
```json
{
  "kurzfassung": "...",
  "offene_punkte": [ { "punkt": "...", "verantwortlich": "Architekt", "frist": "28.11.", "prioritaet": "hoch" } ],
  "entscheidungen": ["..."],
  "risiken": ["..."],
  "vorschlaege": [ { ...Schreibvorschlag... } ]
}
```
Für den Export: im Frontend in einen **Bericht** umwandeln (Abschnitte
„Kurzfassung", „Offene Punkte" …) und an `/export/bericht/pdf` schicken.

---

## 4. Tagesbericht-Entwurf aus Notizen, Terminen, Fotos

### POST /tagesbericht/entwurf
```json
{
  "datum": "21.11.2026",
  "bauvorhaben": "Neubau Wohnanlage",
  "notizen": "6 Maurer, 1 Kran. KS-Wände EG Achse A-C. Regen ab 14 Uhr.",
  "termine": "10:00 Begehung mit Bauherr",
  "fotos": [ { "media_type": "image/jpeg", "data": "<base64 OHNE 'data:image/jpeg;base64,'>" } ]
}
```
Max. 6 Fotos. **Fotos vorher im Browser verkleinern** (ca. 1024 px, JPEG):
spart Zeit und Kosten. → **Bericht** (Abschnitte editierbar anzeigen).

### POST /export/bericht/pdf · POST /export/bericht/docx
```json
{ "bericht": { ...Bericht... } }
```
→ Datei.

---

## Code-Schnipsel

```js
async function api(path, body) {
  const r = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail || r.status);
  return r.json();
}

async function download(path, body, filename) {   // z. B. ("/export/pdf", {brief}, "brief.pdf")
  const r = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

// Spracheingabe (Chrome/Edge, auch Android; braucht HTTPS -> Tunnel passt)
const rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
rec.lang = "de-DE"; rec.interimResults = false;
rec.onresult = e => { textarea.value += " " + e.results[0][0].transcript; };
// micButton.onclick = () => rec.start();
```

---

## Demo-Ablauf „Ein Tag im Leben eines Bauleiters"
1. **07:30** Protokoll der gestrigen Baubesprechung einfügen → `/zusammenfassung` → offene Punkte und Fristen.
2. **10:15** Per Sprache: „Bagger steht seit 10 Uhr, Leitungsplan fehlt" → `/analyze` → Felder prüfen → `/brief` (Behinderung) → PDF.
3. **16:00** Soll/Ist eintragen → `/tagesbericht/analyse` → Alarm „Mauerwerk −42 %" → Vorschlag → `/brief`.
4. **17:00** Notizen und Fotos → `/tagesbericht/entwurf` → bearbeiten → Word-Export.
