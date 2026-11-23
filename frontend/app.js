// Backend-Adresse
// - leer = gleiche Adresse, von der die App geladen wurde
//   (FastAPI liefert das Frontend mit aus: ein Tunnel für App und API)
// - nur wenn die App von einem anderen Host kommt (Cloudflare Workers),
//   wird die Tunnel-Adresse gebraucht
const TUNNEL = "https://cambridge-naval-movement-barely.trycloudflare.com";
const API = location.hostname.endsWith("workers.dev") ? TUNNEL : "";

// Server-Adresse
// - normal liefert derselbe Server die App aus, dann ist die Basis leer
// - wird der Tunnel neu gestartet, kann die neue Adresse im Menue
//   eingetragen werden. So braucht eine neue Adresse keinen neuen Code.
function serverBasis() {
  const eigene = (localStorage.getItem("server") || "").trim();
  return eigene ? eigene.replace(/\/+$/, "") : API;
}

// Anzeigenamen
const BRIEFNAMEN = {
  behinderung: "Behinderungsanzeige", mehrkosten: "Mehrkostenanzeige",
  bedenken: "Bedenkenanzeige", mangel: "Mängelanzeige", unfall: "Unfallmeldung",
  reklamation: "Reklamation", notiz: "Aktennotiz"
};
const QUELLNAMEN = { protokoll: "Besprechungsprotokoll", bautagebuch: "Bautagebuch", email: "E-Mail" };

// Alle Seiten der App
const seiten = [
  "seite_start", "seite_felder", "seite_brief",
  "seite_menue", "seite_plan", "seite_dateien", "seite_notizen", "seite_zusammen",
  "seite_soll", "seite_firmen", "seite_server", "seite_akte"
];

// Felder des Briefs (einfache Textfelder)
const briefFelder = [
  "rechtsgrundlage", "absender", "empfaenger", "ort_datum",
  "betreff", "anrede", "gruss", "unterzeichner"
];

// Daten zwischen den Schritten
// - ereignis: Antwort von /analyze
// - briefDaten: Antwort von /brief
let ereignis = null;
let briefDaten = null;
let briefId = null;
// Ids der Fotos, die an diesen Brief gehören
let briefFotoIds = [];
// E-Mail des gewählten Empfängers, für den Mail-Knopf
let briefMail = "";
// Fristenwaechter: zu welchem Vorgang gehoert der Brief, der gerade entsteht
let vorgangId = null;
// erst true, wenn der Waechter-Code am Dateiende geladen ist
let waechterBereit = false;

// Service Worker anmelden
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

// Element holen
function el(id) {
  return document.getElementById(id);
}

// Eine Seite anzeigen, alle anderen verstecken
function zeigeSeite(name) {
  for (const s of seiten) {
    el(s).hidden = s !== name;
  }
  el("menue_knopf").hidden = name === "seite_menue";
  document.body.classList.toggle("start", name === "seite_start");
  if (name === "seite_start" && waechterBereit) {
    waechterAnzeigen();
  }
}

// Meldung oben anzeigen (leerer Text = ausblenden)
function meldung(text) {
  el("meldung").className = text.endsWith("…") ? "bewegt" : "";
  el("meldung").textContent = text;
  el("meldung").hidden = text === "";
}

// Knopf sperren, solange das Backend arbeitet
function laden(knopf, an, text) {
  knopf.disabled = an;
  knopf.classList.toggle("laedt", an);
  if (!knopf.dataset.symbol) {
    knopf.textContent = text;
  }
}

// Anfrage ans Backend
// - POST mit JSON
// - Fehler als Meldung weitergeben
async function anfrage(pfad, daten) {
  const abbruch = new AbortController();
  const frist = setTimeout(() => abbruch.abort(), 90000);
  let antwort;
  try {
    antwort = await fetch(serverBasis() + pfad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(daten),
      signal: abbruch.signal
    });
  } catch (fehler) {
    if (fehler.name === "AbortError") {
      throw new Error("Das dauert zu lange. Bitte nochmal versuchen.");
    }
    throw new Error("Keine Verbindung zum Server. Prüfe das Internet und versuche es nochmal.");
  } finally {
    clearTimeout(frist);
  }
  if (!antwort.ok) {
    throw new Error("Der Server meldet einen Fehler (" + antwort.status + "). Bitte nochmal versuchen.");
  }
  return antwort;
}

// Spracherkennung
// - Chrome auf Android
// - Text erscheint live im Textfeld
// - solange die Aufnahme läuft, ist das Mikro gesperrt
let erkennung = null;

function mikroStand(text) {
  el("mikro_stand").textContent = text;
  el("mikro_stand").hidden = text === "";
}

// Sprache der Aufnahme
// - der Polier spricht in seiner Sprache, Felder und Briefe kommen auf Deutsch
// - die Wahl bleibt auf dem Handy gespeichert
function spracheHolen() {
  return localStorage.getItem("sprache") || "de-DE";
}

function spracheAnzeigen() {
  el("sprache").value = spracheHolen();
  el("sprache").classList.toggle("fremd", spracheHolen() !== "de-DE");
}

function mikroStarten() {
  if (erkennung !== null) {
    return;
  }
  const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Erkennung) {
    meldung("Spracherkennung geht hier nicht. Bitte tippen.");
    return;
  }
  const vorher = el("text").value.trim();
  erkennung = new Erkennung();
  erkennung.lang = spracheHolen();
  erkennung.interimResults = true;
  erkennung.onstart = () => {
    el("mikro").classList.add("aktiv");
    mikroStand(spracheHolen() === "de-DE"
      ? "Ich höre zu …"
      : "Ich höre zu (" + el("sprache").selectedOptions[0].textContent + ") … Das Schreiben kommt auf Deutsch.");
  };
  erkennung.onresult = (ereignisSprache) => {
    let gesprochen = "";
    for (const ergebnis of ereignisSprache.results) {
      gesprochen += ergebnis[0].transcript;
    }
    el("text").value = (vorher + " " + gesprochen).trim();
  };
  erkennung.onerror = (fehler) => {
    const texte = {
      "no-speech": "Nichts gehört. Tippe aufs Mikro und versuch es nochmal.",
      "not-allowed": "Das Mikrofon ist nicht erlaubt. Erlaube es in den Browser-Einstellungen.",
      "service-not-allowed": "Das Mikrofon ist nicht erlaubt. Erlaube es in den Browser-Einstellungen.",
      "audio-capture": "Kein Mikrofon gefunden.",
      "network": "Keine Verbindung für die Spracherkennung."
    };
    if (fehler.error !== "aborted") {
      meldung(texte[fehler.error] || "Spracherkennung fehlgeschlagen. Bitte tippen.");
    }
  };
  erkennung.onend = () => {
    el("mikro").classList.remove("aktiv");
    mikroStand("");
    erkennung = null;
  };
  meldung("");
  mikroStand("Mikrofon startet …");
  try {
    erkennung.start();
  } catch (fehler) {
    erkennung = null;
    mikroStand("");
    meldung("Spracherkennung fehlgeschlagen. Bitte tippen.");
  }
}

// Schritt 1: Stichworte analysieren
async function analysieren() {
  const text = el("text").value.trim();
  if (text === "") {
    meldung("Bitte erst sprechen oder tippen.");
    return;
  }
  meldung("");
  laden(el("senden"), true, "Analysiere …");
  try {
    const antwort = await anfrage("/analyze", { text: text });
    ereignis = await antwort.json();
    vorgangMerken(ereignis, text);
    felderAnzeigen();
    zeigeSeite("seite_felder");
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(el("senden"), false, "Senden");
}

// Felder aus dem Ergebnis in die Eingabefelder schreiben
function felderAnzeigen() {
  const typen = ["behinderung", "mehrkosten", "bedenken", "mangel", "unfall", "reklamation", "notiz"];
  el("gewerk").value = ereignis.gewerk || "";
  el("beteiligte").value = ereignis.beteiligte || "";
  el("ursache").value = ereignis.ursache || "";
  el("folge").value = ereignis.folge || "";
  el("dauer").value = ereignis.dauer_tage || "";
  el("brieftyp").value = typen.includes(ereignis.art) ? ereignis.art : "behinderung";

  empfaengerAuswahlFuellen();

  kostenHinweisAnzeigen();

  const fehlend = ereignis.fehlende_angaben || [];
  el("fehlend").hidden = fehlend.length === 0;
  el("fehlend").textContent = "Bitte ergänzen: " + fehlend.join(", ");
}

// Kostenfolge vorab zeigen
// - dieselbe Rechnung wie im Backend: Tage mal Tagessatz aus den Firmendaten
// - nur fuer Behinderung und Mehrkosten
function euroText(betrag) {
  return betrag.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function kostenHinweisAnzeigen() {
  const feld = el("kosten_hinweis");
  const typ = el("brieftyp").value;
  if (typ !== "behinderung" && typ !== "mehrkosten") {
    feld.hidden = true;
    return;
  }
  const f = firmaHolen();
  const personal = Math.max(Number(f.kosten_personal) || 0, 0);
  const geraete = Math.max(Number(f.kosten_geraete) || 0, 0);
  const tage = Number(el("dauer").value) || 0;
  if (personal + geraete <= 0) {
    feld.textContent = "Mit euren Tagessätzen unter Firmen rechnet die App die Kosten hier aus.";
  } else if (tage <= 0) {
    feld.textContent = "Trag die Dauer ein, dann steht die Kostenfolge im Brief.";
  } else {
    feld.textContent = "Kostenfolge im Brief: " + tage + (tage === 1 ? " Tag" : " Tage") + " × "
      + euroText(personal + geraete) + " = " + euroText(tage * (personal + geraete)) + " netto";
  }
  feld.hidden = false;
}

// Korrigierte Felder zurück ins Ereignis schreiben
function felderLesen() {
  ereignis.gewerk = el("gewerk").value;
  ereignis.beteiligte = el("beteiligte").value;
  ereignis.ursache = el("ursache").value;
  ereignis.folge = el("folge").value;
  ereignis.dauer_tage = el("dauer").value === "" ? null : Number(el("dauer").value);
}

// Schritt 2: Brief erzeugen
async function briefErzeugen() {
  felderLesen();
  meldung("");
  laden(el("brief_erzeugen"), true, "Erzeuge Brief …");
  try {
    const antwort = await anfrage("/brief", {
      ereignis: ereignis,
      brieftyp: el("brieftyp").value,
      stammdaten: stammdatenBauen()
    });
    briefDaten = await antwort.json();
    briefId = null;
    briefFotoIds = fotosOffen().map((f) => f.id);
    fotosZuordnen(briefFotoIds);   // gehoeren jetzt zu diesem Brief
    fotoStandAnzeigen();
    briefAnzeigen();
    zeigeSeite("seite_brief");
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(el("brief_erzeugen"), false, "Brief erzeugen");
}

// Brief in die Eingabefelder schreiben
function briefAnzeigen() {
  el("b_titel").textContent = briefDaten.brieftyp || "Brief";
  for (const feld of briefFelder) {
    el("b_" + feld).value = briefDaten[feld] || "";
  }
  el("absaetze").innerHTML = "";
  for (const text of briefDaten.absaetze || []) {
    const feld = document.createElement("textarea");
    feld.value = text;
    feld.rows = 5;
    el("absaetze").appendChild(feld);
  }
  el("b_kopie_an").value = (briefDaten.kopie_an || []).join(", ");
  el("hinweis").textContent = briefDaten.hinweis || "";

  const anzahl = briefFotoIds.length;
  el("b_fotos_zeile").hidden = anzahl === 0;
  el("b_fotos_text").textContent = anzahl === 1
    ? "Aufgenommenes Foto anhängen"
    : anzahl + " aufgenommene Fotos anhängen";
}

// Geänderten Brief aus den Eingabefeldern holen
function briefLesen() {
  for (const feld of briefFelder) {
    briefDaten[feld] = el("b_" + feld).value;
  }
  briefDaten.kopie_an = el("b_kopie_an").value
    .split(",").map((x) => x.trim()).filter(Boolean);
  const felder = el("absaetze").querySelectorAll("textarea");
  briefDaten.absaetze = Array.from(felder).map((f) => f.value);
}

// Platzhalter aus den Standard-Stammdaten
// - stehen sie noch im Brief, hat niemand den Briefkopf gepflegt
const PLATZHALTER = [
  "Musterbau GmbH", "Mustermann", "Musterfirma", "Baustrasse 1", "Hauptstrasse 10",
  "Baustraße 1", "Hauptstraße 10", "Neubau Wohnanlage, M",
  "Architekturbuero Plan & Bau", "Architekturbüro Plan & Bau"
];

function istPlatzhalter(text) {
  const t = (text || "").toLowerCase();
  return PLATZHALTER.some((p) => t.includes(p.toLowerCase()));
}

// Vollstaendigkeit pruefen, bevor der Brief rausgeht
// - gibt eine Liste von Klartext-Saetzen zurueck, leer heisst alles in Ordnung
function briefPruefen() {
  const b = briefDaten;
  const maengel = [];

  if (!(b.empfaenger || "").trim()) {
    maengel.push("Der Empfänger fehlt.");
  } else if (istPlatzhalter(b.empfaenger)) {
    maengel.push("Beim Empfänger steht noch ein Beispielname.");
  }

  if (!(b.absender || "").trim()) {
    maengel.push("Der Absender fehlt.");
  } else if (istPlatzhalter(b.absender)) {
    maengel.push("Der Briefkopf ist noch der Beispiel-Briefkopf. Trag ihn unter Firmen ein.");
  }

  if (!(b.betreff || "").trim()) {
    maengel.push("Der Betreff fehlt.");
  }
  if (!(b.ort_datum || "").trim()) {
    maengel.push("Ort und Datum fehlen.");
  }
  if (!(b.unterzeichner || "").trim()) {
    maengel.push("Der Unterzeichner fehlt.");
  } else if (istPlatzhalter(b.unterzeichner)) {
    maengel.push("Beim Unterzeichner steht noch ein Beispielname.");
  }

  const absaetze = (b.absaetze || []).filter((a) => a.trim() !== "");
  if (absaetze.length === 0) {
    maengel.push("Der Brief hat keinen Text.");
  }
  if (absaetze.some((a) => /keine angabe|\[|xxx|tbd/i.test(a))) {
    maengel.push("In einem Absatz steht noch eine Lücke.");
  }

  // Gewerk steckt im Betreff; das Ersatzwort heisst, dass keines erkannt wurde
  if ((b.betreff || "").includes("Bauleistung")) {
    maengel.push("Das Gewerk wurde nicht erkannt. Steht im Betreff nur \u201eBauleistung\u201c.");
  }
  return maengel;
}

// Schritt 3: PDF oder Word herunterladen
// - art ist "pdf" oder "docx"
// - vorher kurz pruefen, ob etwas Wichtiges fehlt
function exportStarten(art) {
  briefLesen();
  const maengel = briefPruefen();
  if (maengel.length === 0) {
    exportieren(art);
    return;
  }
  frageStellen(
    maengel.length === 1 ? "Eine Sache fehlt noch" : maengel.length + " Sachen fehlen noch",
    maengel.join("\n") + "\n\nTrotzdem herunterladen?",
    "Trotzdem",
    () => exportieren(art)
  );
}

async function exportieren(art) {
  briefLesen();
  const knopf = el(art === "pdf" ? "export_pdf" : "export_docx");
  const knopfText = art === "pdf" ? "Als PDF herunterladen" : "Als Word herunterladen";
  stand("");
  meldung("");
  laden(knopf, true, art === "pdf" ? "Erzeuge PDF …" : "Erzeuge Word …");
  try {
    const fotos = el("b_fotos_an").checked ? fotosNachIds(briefFotoIds) : [];
    const antwort = await anfrage("/export/" + art, {
      brief: Object.assign({}, briefDaten, { fotos: fotos })
    });
    const datei = await antwort.blob();
    if (datei.size === 0) {
      throw new Error("Die Datei kam leer zurück. Bitte nochmal versuchen.");
    }
    const basis = (briefDaten.betreff || "Brief")
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
      .replace(/ - /g, "_").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    herunterladen(datei, basis + "_" + new Date().toISOString().slice(0, 10) + "." + art);
    stand("Fertig. Die Datei liegt in deinen Downloads.", true);
    try {
      fotosZuordnen(briefFotoIds);   // tauchen im naechsten Brief nicht wieder auf
      briefSpeichern();
    } catch (fehlerSpeicher) {
      stand("Heruntergeladen, aber nicht gespeichert: " + fehlerSpeicher.message);
    }
  } catch (fehler) {
    stand(fehler.message);
    meldung(fehler.message);
  }
  laden(knopf, false, knopfText);
}

// Meldung direkt bei den Export-Knoepfen
// - die Meldung ganz oben sieht man hier unten nicht
function stand(text, gut) {
  const feld = el("b_stand");
  feld.textContent = text;
  feld.className = gut ? "hinweis gut" : "hinweis";
  feld.hidden = text === "";
}

// Datei wirklich herunterladen
// - der Link muss im Dokument haengen, sonst ignorieren ihn manche Android-Browser
// - klappt das nicht, wird die Datei wenigstens in einem neuen Tab geoeffnet
function herunterladen(datei, dateiname) {
  const adresse = URL.createObjectURL(datei);
  const link = document.createElement("a");
  link.href = adresse;
  link.download = dateiname;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(adresse), 60000);
}

// Knöpfe verbinden
el("mikro").addEventListener("click", mikroStarten);
el("senden").addEventListener("click", wahlZeigen);
el("brief_erzeugen").addEventListener("click", briefErzeugen);
el("export_pdf").addEventListener("click", () => exportStarten("pdf"));
el("export_docx").addEventListener("click", () => exportStarten("docx"));
el("b_kopieren").addEventListener("click", briefKopieren);
el("b_mail").addEventListener("click", briefMailOeffnen);
el("zurueck_start").addEventListener("click", () => zeigeSeite("seite_start"));
el("zurueck_felder").addEventListener("click", () => {
  zeigeSeite(ereignis === null ? "seite_dateien" : "seite_felder");
});

// Daten im Browser speichern
// - localStorage, als Text (JSON)
function speichern(name, daten) {
  localStorage.setItem(name, JSON.stringify(daten));
}

// Gespeicherte Liste holen
// - leere Liste, wenn nichts da ist
function holen(name) {
  try {
    return JSON.parse(localStorage.getItem(name)) || [];
  } catch (fehler) {
    return [];
  }
}

// Datum 2026-11-25 als 25.11.2026 schreiben
function datumDeutsch(text) {
  const teile = text.split("-");
  return teile[2] + "." + teile[1] + "." + teile[0];
}

// Checkliste anzeigen
// - sortiert nach Frist
// - überfällige Fristen in Rot
function listeAnzeigen() {
  const punkte = holen("punkte");
  punkte.sort((a, b) => (a.frist || "9999").localeCompare(b.frist || "9999"));
  const heute = new Date().toLocaleDateString("sv-SE");
  const notizen = holen("notizen");
  const fertig = punkte.filter((p) => p.erledigt).length;

  el("plan_stand").textContent = punkte.length === 0
    ? ""
    : fertig + " von " + punkte.length + " erledigt";

  el("liste").innerHTML = "";
  if (punkte.length === 0) {
    el("liste").textContent = "Noch keine Punkte. Füge unten den ersten hinzu.";
    return;
  }

  for (const p of punkte) {
    const spaet = !p.erledigt && p.frist && p.frist < heute;
    const schritt = document.createElement("div");
    schritt.className = "schritt" + (p.erledigt ? " fertig" : "") + (spaet ? " spaet" : "");

    const knoten = document.createElement("button");
    knoten.className = "knoten";
    knoten.textContent = p.erledigt ? "✓" : "";
    knoten.setAttribute("aria-label", p.erledigt ? "Haken entfernen" : "Als erledigt markieren");
    knoten.addEventListener("click", () => punktUmschalten(p.id));

    const titel = document.createElement("button");
    titel.className = "schritt-text";
    titel.textContent = p.text;
    titel.addEventListener("click", () => punktBearbeiten(p.id));

    const frist = document.createElement("span");
    frist.className = "schritt-frist";
    frist.textContent = spaet ? "überfällig" : (p.frist ? datumDeutsch(p.frist) : "ohne Frist");

    const kopf = document.createElement("div");
    kopf.className = "schritt-kopf";
    kopf.append(titel, frist);
    schritt.append(knoten, kopf);

    for (const n of notizen.filter((x) => x.punktId === p.id)) {
      const zeile = document.createElement("div");
      zeile.className = "schritt-notiz";
      zeile.textContent = n.zeit + " " + n.text;
      schritt.appendChild(zeile);
    }

    el("liste").appendChild(schritt);
  }
}

// Neuen Punkt hinzufügen
function punktNeu() {
  const text = el("neu_text").value.trim();
  if (text === "") {
    meldung("Bitte einen Text eingeben.");
    return;
  }
  meldung("");
  const punkte = holen("punkte");
  punkte.push({
    id: Date.now(),
    text: text,
    frist: el("neu_frist").value,
    erledigt: false
  });
  speichern("punkte", punkte);
  el("neu_text").value = "";
  el("neu_frist").value = "";
  listeAnzeigen();
}

// Haken setzen oder entfernen
function punktUmschalten(id) {
  const punkte = holen("punkte");
  for (const p of punkte) {
    if (p.id === id) {
      p.erledigt = !p.erledigt;
    }
  }
  speichern("punkte", punkte);
  listeAnzeigen();
}

// Punkt löschen
function punktLoeschen(id) {
  if (!bestaetigt.has(id)) {
    frageStellen("Punkt löschen?", "Der Punkt verschwindet aus dem Plan.", "Löschen", () => {
      bestaetigt.add(id);
      punktLoeschen(id);
      bestaetigt.delete(id);
    });
    return;
  }
  const punkte = holen("punkte").filter((p) => p.id !== id);
  speichern("punkte", punkte);
  listeAnzeigen();
}

// Brief in der Dateiliste speichern
// - gleicher Brief wird nur aktualisiert
// Demo-Daten
// - füllt alles, was man für die Vorführung braucht
// - damit vor Publikum nichts getippt werden muss und die Demo auch
//   läuft, wenn das Mikrofon im lauten Raum streikt
const DEMO_PROTOKOLL = [
  "Baubesprechung Nr. 14, 21.11.2026, 09:00 Uhr, Baubüro",
  "Anwesend: Bauleitung Hartmann, Architekt Weber, Bauherr Lerchenfeld",
  "",
  "1. Estrich 2. OG: Einbringen konnte erst um 14 Uhr beginnen, die Lieferung",
  "   kam verspätet. Nachholen am Montag vorgesehen.",
  "2. Architekt Weber liefert den Detailplan Treppenhaus bis Mittwoch.",
  "3. Bemusterung Bad: Fliesen wie am 10.11. festgelegt, bleibt dabei.",
  "4. Fenster: Lieferzeit derzeit 8 Wochen, Termin Rohbau Ende kritisch.",
  "5. Elektro meldet Mehraufwand durch geänderte Steckdosenpositionen im EG."
].join("\n");

function demoFoto() {
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 600;
  const g = c.getContext("2d");
  g.fillStyle = "#cfc7bb";
  g.fillRect(0, 0, 900, 600);
  g.fillStyle = "#b9b0a2";
  for (let y = 0; y < 600; y += 150) {
    g.fillRect(0, y, 900, 4);
  }
  g.strokeStyle = "#3a332b";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(120, 90);
  g.lineTo(300, 300);
  g.lineTo(250, 380);
  g.lineTo(420, 560);
  g.stroke();
  g.fillStyle = "#3a332b";
  g.font = "28px sans-serif";
  g.fillText("Beispielfoto", 620, 560);
  return c.toDataURL("image/jpeg", 0.6).split(",")[1];
}

// Zeitpunkt der ersten Aufforderung, für die Sicherheitsabfrage ohne Dialog
let demoGefragt = 0;

function demoDatenLaden() {
  // Bewusst kein window.confirm: als App vom Startbildschirm unterdrücken
  // manche Browser solche Dialoge, dann passiert beim Tippen gar nichts.
  // Stattdessen zweimal tippen, wenn schon etwas da ist.
  const schonDa = holen("notizen").length > 0 || holen("fotos").length > 0;
  const jetzt = Date.now();
  if (schonDa && jetzt - demoGefragt > 8000) {
    demoGefragt = jetzt;
    meldung("Ersetzt vorhandene Notizen und Fotos. Zum Bestätigen nochmal tippen.");
    el("meldung").className = "";
    return;
  }
  demoGefragt = 0;
  const tag = new Date().toLocaleDateString("sv-SE");
  beispieleLaden();
  speichern("waechter_aus", holen("waechter_aus").filter((k) => !["n1", "n2", "n3", "n4"].includes(k)));

  speichern("notizen", [
    { id: 1, tag: tag, zeit: "07:40", text: "Kolonne Rohbau vollzählig, Wetter trocken, 6 Grad." },
    { id: 2, tag: tag, zeit: "10:15", text: "Estrichlieferung für das 2. OG ist nicht angekommen, Spedition meldet Panne." },
    { id: 3, tag: tag, zeit: "14:30", text: "Estrich kam um 14 Uhr, nur ein Teil der Fläche geschafft." },
    { id: 4, tag: tag, zeit: "15:20", text: "Riss in der Trennwand im 2. OG entdeckt und fotografiert." }
  ].map((n) => Object.assign(n, { demo: true })));

  speichern("fotos", [
    { id: Date.now(), tag: tag, zeit: "15:20", media_type: "image/jpeg", data: demoFoto(), offen: true, demo: true }
  ]);

  const vorgestern = new Date(Date.now() - 2 * 86400000).toLocaleDateString("sv-SE");
  const naechsteWoche = new Date(Date.now() + 6 * 86400000).toLocaleDateString("sv-SE");
  speichern("punkte", [
    { id: 11, text: "Heizung liefern lassen", frist: vorgestern, erledigt: false, demo: true },
    { id: 12, text: "Kran prüfen und freigeben", frist: tag, erledigt: true, demo: true },
    { id: 13, text: "Leitungsplan vom Bauherrn anfordern", frist: naechsteWoche, erledigt: false, demo: true },
    { id: 14, text: "Trennwand im 2. OG begutachten", frist: "", erledigt: false, demo: true }
  ]);

  el("text").value = "Riss in der Trennwand im zweiten Obergeschoss entdeckt, Achse C, geht über die ganze Höhe";
  el("z_text").value = DEMO_PROTOKOLL;
  el("z_quelle").value = "protokoll";
  el("s_notizen").value = "Estrichlieferung kam erst um 14 Uhr statt 7 Uhr, Spedition hatte eine Panne. Kran war den ganzen Tag verfügbar.";
  el("s_schwelle").value = "15";
  el("s_zeilen").innerHTML = "";
  sollZeileNeu({ gewerk: "Estrich", taetigkeit: "Estrich einbringen 2. OG", einheit: "m²", soll: 400, ist: 150 });
  sollZeileNeu({ gewerk: "Trockenbau", taetigkeit: "Ständerwerk stellen", einheit: "m²", soll: 200, ist: 195 });
  sollZeileNeu({ gewerk: "Elektro", taetigkeit: "Leerrohre verlegen", einheit: "m", soll: 300, ist: 340 });

  fotoStandAnzeigen();
  zeigeSeite("seite_start");
  meldung("Demo-Daten geladen: Notizen, ein Foto, Zahlen und ein Protokoll.");
  el("meldung").className = "ok";
}

// Firmen: eigener Briefkopf und Empfängerliste
// - alles im Browser, nichts verlässt das Handy ausser mit dem Brief
const FIRMA_LEER = {
  firma: "", anschrift: "", unterzeichner: "", bauvorhaben: "", ort: "",
  kosten_personal: "", kosten_geraete: ""
};
const FIRMA_FELDER = Object.keys(FIRMA_LEER);

const BEISPIEL_FIRMA = {
  firma: "Bauunternehmung Hartmann GmbH",
  anschrift: "Gewerbering 14, 85375 Neufahrn",
  unterzeichner: "F. Ramaj (Bauleitung)",
  bauvorhaben: "Neubau Wohnanlage Lerchenfeld, München",
  ort: "München",
  kosten_personal: "2400",
  kosten_geraete: "650"
};

const BEISPIEL_EMPFAENGER = [
  { id: 1, name: "Wohnbau Lerchenfeld GmbH & Co. KG", anschrift: "Maximilianstraße 22, 80539 München", mail: "bauleitung@example.de", gewerk: "" },
  { id: 2, name: "Estrich Vogl KG", anschrift: "Am Moosfeld 3, 81829 München", mail: "buero@example.de", gewerk: "Estrich" },
  { id: 3, name: "Trockenbau Seidl GmbH", anschrift: "Industriestraße 7, 82194 Gröbenzell", mail: "info@example.de", gewerk: "Trockenbau" },
  { id: 4, name: "Elektro Brandl GmbH", anschrift: "Hansastraße 51, 80686 München", mail: "technik@example.de", gewerk: "Elektro" },
  { id: 5, name: "Rohbau Stadler GmbH", anschrift: "Ziegeleiweg 9, 85435 Erding", mail: "bau@example.de", gewerk: "Rohbau" }
];

function firmaHolen() {
  try {
    return Object.assign({}, FIRMA_LEER, JSON.parse(localStorage.getItem("firma")) || {});
  } catch (fehler) {
    return Object.assign({}, FIRMA_LEER);
  }
}

function firmaAnzeigen() {
  const f = firmaHolen();
  for (const name of FIRMA_FELDER) {
    el("f_" + name).value = f[name] || "";
  }
  empfaengerListeAnzeigen();
}

function firmaSpeichern() {
  const f = {};
  for (const name of FIRMA_FELDER) {
    f[name] = el("f_" + name).value.trim();
  }
  localStorage.setItem("firma", JSON.stringify(f));
  meldung("Briefkopf gespeichert.");
  el("meldung").className = "ok";
}

function empfaengerListeAnzeigen() {
  const liste = holen("empfaenger");
  el("f_liste").innerHTML = "";
  if (liste.length === 0) {
    el("f_liste").textContent = "Noch keine Empfänger. Lade unten die Beispielfirmen.";
    return;
  }
  for (const e of liste) {
    const zeile = document.createElement("div");
    zeile.className = "notiz";
    const kopf = document.createElement("strong");
    kopf.textContent = e.name + (e.gewerk ? " · " + e.gewerk : "");
    const detail = document.createElement("small");
    detail.textContent = [e.anschrift, e.mail].filter(Boolean).join(" · ");
    const weg = document.createElement("button");
    weg.className = "weg";
    weg.textContent = "×";
    weg.addEventListener("click", () => {
      speichern("empfaenger", holen("empfaenger").filter((x) => x.id !== e.id));
      empfaengerListeAnzeigen();
    });
    zeile.append(kopf, detail, weg);
    el("f_liste").appendChild(zeile);
  }
}

function empfaengerNeu() {
  const name = el("f_neu_name").value.trim();
  if (name === "") {
    meldung("Bitte einen Namen eingeben.");
    return;
  }
  const liste = holen("empfaenger");
  liste.push({
    id: Date.now(),
    name: name,
    anschrift: el("f_neu_anschrift").value.trim(),
    mail: el("f_neu_mail").value.trim(),
    gewerk: el("f_neu_gewerk").value.trim()
  });
  speichern("empfaenger", liste);
  for (const feld of ["f_neu_name", "f_neu_anschrift", "f_neu_mail", "f_neu_gewerk"]) {
    el(feld).value = "";
  }
  empfaengerListeAnzeigen();
  meldung("Empfänger hinzugefügt.");
  el("meldung").className = "ok";
}

function beispieleLaden() {
  localStorage.setItem("firma", JSON.stringify(BEISPIEL_FIRMA));
  speichern("empfaenger", BEISPIEL_EMPFAENGER.slice());
  firmaAnzeigen();
  meldung("Beispielfirmen geladen.");
  el("meldung").className = "ok";
}

// Auswahl auf der Prüfen-Seite füllen
// - passt das Gewerk zu einem Nachunternehmer, wird der vorgeschlagen
function empfaengerAuswahlFuellen() {
  const liste = holen("empfaenger");
  const wahl = el("empfaenger_wahl");
  wahl.innerHTML = "";
  if (liste.length === 0) {
    const leer = document.createElement("option");
    leer.value = "";
    leer.textContent = "Standard (keine Firmen hinterlegt)";
    wahl.appendChild(leer);
    freienEmpfaengerAnbieten(wahl);
    kopieListeFuellen();
    return;
  }
  for (const e of liste) {
    const o = document.createElement("option");
    o.value = String(e.id);
    o.textContent = e.name + (e.gewerk ? " · " + e.gewerk : "");
    wahl.appendChild(o);
  }
  const gewerk = (ereignis && ereignis.gewerk || "").toLowerCase();
  const passend = liste.find((e) => e.gewerk && gewerk.includes(e.gewerk.toLowerCase()));
  wahl.value = String((passend || liste[0]).id);
  freienEmpfaengerAnbieten(wahl);
  kopieListeFuellen();
}

// Eintrag für einen Empfänger, der nicht in der Liste steht
function freienEmpfaengerAnbieten(wahl) {
  const frei = document.createElement("option");
  frei.value = "frei";
  frei.textContent = "Anderer Empfänger …";
  wahl.appendChild(frei);
  el("empfaenger_frei").hidden = wahl.value !== "frei";
}

// Kopie an Dritte
// - jeder gespeicherte Empfaenger, der nicht der Hauptempfaenger ist,
//   kann angehakt werden (typisch: Bauherr, Architekt)
function kopieListeFuellen() {
  const ziel = el("kopie_liste");
  const vorher = kopieGewaehlte();          // Haken ueberleben einen Wechsel
  const haupt = el("empfaenger_wahl").value;
  ziel.innerHTML = "";
  const liste = holen("empfaenger").filter((e) => String(e.id) !== haupt);
  for (const e of liste) {
    const zeile = document.createElement("label");
    zeile.className = "schalter";
    const kasten = document.createElement("input");
    kasten.type = "checkbox";
    kasten.value = e.name;
    kasten.checked = vorher.includes(e.name);
    const text = document.createElement("span");
    text.textContent = e.name + (e.gewerk ? " · " + e.gewerk : "");
    zeile.append(kasten, text);
    ziel.appendChild(zeile);
  }
  if (liste.length === 0) {
    const leer = document.createElement("p");
    leer.className = "klein";
    leer.textContent = "Keine weiteren Firmen hinterlegt.";
    ziel.appendChild(leer);
  }
}

// Angehakte Namen plus das freie Feld
function kopieGewaehlte() {
  const kaesten = el("kopie_liste").querySelectorAll("input:checked");
  const namen = Array.from(kaesten).map((k) => k.value);
  const frei = el("kopie_frei").value.trim();
  if (frei) {
    for (const name of frei.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!namen.includes(name)) {
        namen.push(name);
      }
    }
  }
  return namen;
}

// Stammdaten für das Backend zusammensetzen
function stammdatenBauen() {
  const f = firmaHolen();
  const daten = {};
  if (f.firma) { daten.absender_firma = f.firma; }
  if (f.anschrift) { daten.absender_anschrift = f.anschrift; }
  if (f.unterzeichner) { daten.absender_unterzeichner = f.unterzeichner; }
  if (f.bauvorhaben) { daten.bauvorhaben = f.bauvorhaben; }
  if (f.ort) { daten.ort = f.ort; }
  if (Number(f.kosten_personal) > 0) { daten.kosten_personal_tag = Number(f.kosten_personal); }
  if (Number(f.kosten_geraete) > 0) { daten.kosten_geraete_tag = Number(f.kosten_geraete); }
  daten.kopie_an = kopieGewaehlte();
  if (el("empfaenger_wahl").value === "frei") {
    const name = el("ef_name").value.trim();
    if (name) {
      daten.empfaenger_name = name;
      daten.empfaenger_anschrift = el("ef_anschrift").value.trim();
    }
    briefMail = el("ef_mail").value.trim();
    return daten;
  }
  const gewaehlt = holen("empfaenger").find((e) => String(e.id) === el("empfaenger_wahl").value);
  if (gewaehlt) {
    daten.empfaenger_name = gewaehlt.name;
    daten.empfaenger_anschrift = gewaehlt.anschrift;
    briefMail = gewaehlt.mail || "";
  } else {
    briefMail = "";
  }
  return daten;
}

// Soll-Ist-Vergleich
// - Rechnen macht das Backend nachvollziehbar im Code
// - bewerten und Schreiben vorschlagen macht Claude
let analyse = null;

// Eine Position als Karte mit Schieberegler
// - Einheit und Soll stehen fest, sobald die Position angelegt ist
// - der Regler zeigt, wie weit die Leistung ist; ueber dem Soll geht er auch
function sollZeileNeu(werte) {
  const w = werte || {};
  const soll = Number(w.soll) || 0;
  if (soll <= 0) {
    return;                      // ohne Soll gibt es keine 100 Prozent
  }
  const grenze = Math.round(soll * 1.5);   // bis 150 Prozent laesst sich schieben
  const ist = w.ist === undefined || w.ist === "" ? 0 : Number(w.ist);

  const zeile = document.createElement("div");
  zeile.className = "sollzeile";
  zeile.dataset.gewerk = w.gewerk || "";
  zeile.dataset.taetigkeit = w.taetigkeit || "";
  zeile.dataset.einheit = w.einheit || "";
  zeile.dataset.soll = String(soll);

  const kopf = document.createElement("strong");
  kopf.className = "sollkopf";
  kopf.textContent = (w.gewerk || "") + (w.taetigkeit ? " · " + w.taetigkeit : "");

  // Der Regler, darueber eine Marke an der Stelle, die dem Soll entspricht
  const bahn = document.createElement("div");
  bahn.className = "sollbahn";
  const regler = document.createElement("input");
  regler.type = "range";
  regler.min = "0";
  regler.max = String(grenze);
  // Stueckzahlen kennen keine halben Schritte
  const ganz = ["Stück", "Paletten", "Wohnungen", "Räume", "Tage"].includes(w.einheit);
  regler.step = String(ganz || soll > 20 ? (soll > 2000 ? 10 : 1) : 0.5);
  regler.value = String(Math.min(ist, grenze));
  regler.setAttribute("aria-label", "Geschafft in " + (w.einheit || "Einheiten"));
  const marke = document.createElement("span");
  marke.className = "sollmarke";
  marke.style.left = (soll / grenze * 100) + "%";
  bahn.append(regler, marke);

  const stand = document.createElement("small");
  stand.className = "sollstand";

  const auffrischen = () => {
    const jetzt = Number(regler.value);
    const anteil = Math.round(jetzt / soll * 100);
    const einheit = w.einheit ? " " + w.einheit : "";
    let zusatz = anteil + " % vom Plan";
    if (anteil > 100) {
      zusatz = (anteil - 100) + " % über Plan";
    } else if (anteil < 100) {
      zusatz = (100 - anteil) + " % unter Plan";
    }
    stand.textContent = zahl(jetzt) + " von " + zahl(soll) + einheit + " · " + zusatz;
    regler.style.setProperty("--fort", (jetzt / grenze * 100) + "%");
    zeile.classList.toggle("ueber", anteil > 100);
  };
  regler.addEventListener("input", auffrischen);
  auffrischen();

  const weg = document.createElement("button");
  weg.className = "weg";
  weg.textContent = "Position entfernen";
  weg.addEventListener("click", () => zeile.remove());

  zeile.append(kopf, bahn, stand, weg);
  el("s_zeilen").appendChild(zeile);
}

// 1.5 statt 1,5000000001 und 400 statt 400,0
function zahl(wert) {
  return Number(wert).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

function sollZeilenLesen() {
  const zeilen = [];
  for (const zeile of el("s_zeilen").querySelectorAll(".sollzeile")) {
    const regler = zeile.querySelector("input[type=range]");
    zeilen.push({
      gewerk: zeile.dataset.gewerk,
      taetigkeit: zeile.dataset.taetigkeit,
      einheit: zeile.dataset.einheit,
      soll: Number(zeile.dataset.soll),
      ist: Number(regler.value)
    });
  }
  return zeilen;
}

// Dialog zum Anlegen
function sollNeuOeffnen() {
  for (const feld of ["sn_gewerk", "sn_taetigkeit", "sn_soll"]) {
    el(feld).value = "";
  }
  el("s_neu").hidden = false;
  el("sn_gewerk").focus();
}

function sollNeuSchliessen() {
  el("s_neu").hidden = true;
}

function sollNeuSpeichern() {
  const gewerk = el("sn_gewerk").value.trim();
  const soll = Number(el("sn_soll").value);
  if (gewerk === "") {
    meldung("Bitte ein Gewerk eingeben.");
    return;
  }
  if (!(soll > 0)) {
    meldung("Bitte ein Soll größer als null eingeben.");
    return;
  }
  meldung("");
  sollZeileNeu({
    gewerk: gewerk,
    taetigkeit: el("sn_taetigkeit").value.trim(),
    einheit: el("sn_einheit").value,
    soll: soll,
    ist: 0
  });
  sollNeuSchliessen();
}

async function sollAuswerten(mitBewertung) {
  const leistungen = sollZeilenLesen();
  if (leistungen.length === 0) {
    meldung("Bitte mindestens eine Zeile mit Gewerk, Soll und Ist ausfüllen.");
    return;
  }
  if (leistungen.some((l) => l.soll <= 0)) {
    meldung("Soll muss größer als null sein, sonst lässt sich keine Abweichung rechnen.");
    return;
  }
  meldung("");
  const knopf = mitBewertung ? el("s_bewerten") : el("s_start");
  laden(knopf, true, mitBewertung ? "Claude bewertet …" : "Rechne …");
  try {
    const antwort = await anfrage("/tagesbericht/analyse", {
      datum: new Date().toLocaleDateString("de-DE"),
      leistungen: leistungen,
      notizen: el("s_notizen").value.trim(),
      schwelle_prozent: Number(el("s_schwelle").value) || 15,
      mit_bewertung: mitBewertung === true
    });
    analyse = await antwort.json();
    analyseAnzeigen();
    if (!mitBewertung) {
      const kritische = (analyse.abweichungen || []).filter((a) => a.kritisch).length;
      meldung(kritische === 0
        ? "Gerechnet. Keine kritische Abweichung."
        : kritische + " kritische Abweichung(en). Für Bewertung und Schreiben unten tippen.");
      el("meldung").className = kritische === 0 ? "ok" : "";
    }
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(knopf, false, mitBewertung ? "Bewerten und Schreiben vorschlagen" : "Ausrechnen");
}

function analyseAnzeigen() {
  const ziel = el("s_ergebnis");
  ziel.innerHTML = "";

  for (const a of analyse.abweichungen || []) {
    const karte = document.createElement("div");
    karte.className = a.kritisch ? "abweichung kritisch" : "abweichung";

    const name = document.createElement("strong");
    name.textContent = a.gewerk + (a.taetigkeit ? " · " + a.taetigkeit : "");

    // Klartext statt nackter Zahlen
    const satz = document.createElement("div");
    satz.className = "satz";
    satz.textContent = a.ist + " von " + a.soll + " " + a.einheit + " geschafft";

    const luecke = Math.round((a.soll - a.ist) * 10) / 10;
    const unterschied = document.createElement("div");
    unterschied.className = "unterschied";
    const prozent = Math.abs(a.abweichung_prozent);
    if (luecke > 0) {
      unterschied.textContent = luecke + " " + a.einheit + " fehlen · " + prozent + " % unter Plan";
    } else if (luecke < 0) {
      unterschied.textContent = (-luecke) + " " + a.einheit + " mehr · " + prozent + " % über Plan";
    } else {
      unterschied.textContent = "genau im Plan";
    }

    // Balken: wie viel vom Soll ist geschafft
    const balken = document.createElement("div");
    balken.className = "balken";
    const fuellung = document.createElement("span");
    fuellung.style.width = Math.max(0, Math.min(100, a.soll ? (a.ist / a.soll) * 100 : 0)) + "%";
    balken.appendChild(fuellung);

    karte.append(name, satz, balken, unterschied);
    if (a.kritisch) {
      const marke = document.createElement("div");
      marke.className = "marke";
      marke.textContent = "kritisch";
      karte.appendChild(marke);
    }
    ziel.appendChild(karte);
  }

  if (analyse.bewertung) {
    const h = document.createElement("h2");
    h.textContent = "Bewertung";
    const p = document.createElement("p");
    p.className = "klein";
    p.textContent = analyse.bewertung;
    ziel.append(h, p);
  }

  if ((analyse.vorschlaege || []).length > 0) {
    const h = document.createElement("h2");
    h.textContent = "Vorgeschlagene Schreiben";
    ziel.appendChild(h);
    for (const v of analyse.vorschlaege) {
      const knopf = document.createElement("button");
      knopf.className = "haupt";
      knopf.textContent = (BRIEFNAMEN[v.brieftyp] || v.brieftyp) + " erzeugen";
      const warum = document.createElement("small");
      warum.className = "warum";
      warum.textContent = v.begruendung;
      knopf.addEventListener("click", () => vorschlagOeffnen(v));
      ziel.append(knopf, warum);
    }
  }
  el("s_pdf").hidden = false;
  el("s_bewerten").hidden = false;
}

async function analyseExport() {
  const zeilen = (analyse.abweichungen || []).map((a) =>
    "- " + a.gewerk + (a.taetigkeit ? " / " + a.taetigkeit : "") +
    ": Soll " + a.soll + " " + a.einheit + ", Ist " + a.ist + " " + a.einheit +
    ", " + (a.abweichung_prozent > 0 ? "+" : "") + a.abweichung_prozent + " %" +
    (a.kritisch ? "  (kritisch)" : ""));
  const abschnitte = [{ ueberschrift: "Soll-Ist-Vergleich", text: zeilen.join("\n") || "-" }];
  if (analyse.bewertung) {
    abschnitte.push({ ueberschrift: "Bewertung", text: analyse.bewertung });
  }
  if (el("s_notizen").value.trim()) {
    abschnitte.push({ ueberschrift: "Notizen des Bauleiters", text: el("s_notizen").value.trim() });
  }
  meldung("PDF wird erzeugt …");
  try {
    const antwort = await anfrage("/export/bericht/pdf", {
      bericht: {
        titel: "Soll-Ist-Auswertung",
        untertitel: QUELLNAMEN[el("z_quelle").value] + " vom "
          + new Date().toLocaleDateString("de-DE"),
        abschnitte: abschnitte,
        hinweis: "Mit KI-Unterstützung erstellt. Vor Verwendung prüfen."
      }
    });
    const datei = await antwort.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(datei);
    link.download = "Soll-Ist_" + new Date().toISOString().slice(0, 10) + ".pdf";
    link.click();
    meldung("PDF fertig.");
    el("meldung").className = "ok";
  } catch (fehler) {
    meldung(fehler.message);
  }
}

// Zusammenfassung von Protokoll, Mail oder Bautagebuch
// - letzte Antwort merken, damit Punkte und PDF darauf zugreifen
let zusammenfassung = null;

async function zusammenfassen() {
  const text = el("z_text").value.trim();
  if (text === "") {
    meldung("Bitte erst einen Text einfügen.");
    return;
  }
  meldung("");
  laden(el("z_start"), true, "Claude liest …");
  try {
    const antwort = await anfrage("/zusammenfassung", {
      text: text,
      quelle: el("z_quelle").value
    });
    zusammenfassung = await antwort.json();
    zusammenfassungAnzeigen();
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(el("z_start"), false, "Protokoll erstellen");
}

// Ergebnis darstellen
function zusammenfassungAnzeigen() {
  const z = zusammenfassung;
  const ziel = el("z_ergebnis");
  ziel.innerHTML = "";

  const block = (ueberschrift, zeilen) => {
    if (!zeilen || zeilen.length === 0) {
      return;
    }
    const h = document.createElement("h2");
    h.textContent = ueberschrift;
    ziel.appendChild(h);
    const ul = document.createElement("ul");
    for (const zeile of zeilen) {
      const li = document.createElement("li");
      li.textContent = zeile;
      ul.appendChild(li);
    }
    ziel.appendChild(ul);
  };

  // Kopf: Thema und Teilnehmer, so wie es in einem Protokoll oben steht
  if (z.titel) {
    const t = document.createElement("h2");
    t.textContent = z.titel;
    ziel.appendChild(t);
  }
  if ((z.teilnehmer || []).length > 0) {
    const p = document.createElement("p");
    p.className = "klein";
    p.textContent = "Teilnehmer: " + z.teilnehmer.join(", ");
    ziel.appendChild(p);
  }

  const kurz = document.createElement("p");
  kurz.className = "klein";
  kurz.textContent = z.kurzfassung || "";
  ziel.appendChild(kurz);

  block("Beschlüsse", z.entscheidungen);
  block("Offene Punkte", (z.offene_punkte || []).map(punktText));
  block("Risiken", z.risiken);

  // Schreibvorschläge: direkt in den Briefweg springen
  if ((z.vorschlaege || []).length > 0) {
    const h = document.createElement("h2");
    h.textContent = "Vorgeschlagene Schreiben";
    ziel.appendChild(h);
    for (const v of z.vorschlaege) {
      const knopf = document.createElement("button");
      knopf.className = "neben";
      knopf.textContent = (BRIEFNAMEN[v.brieftyp] || v.brieftyp) + ": " + v.begruendung;
      knopf.addEventListener("click", () => vorschlagOeffnen(v));
      ziel.appendChild(knopf);
    }
  }

  el("z_punkte").hidden = (z.offene_punkte || []).length === 0;
  el("z_pdf").hidden = false;
}

// Ein offener Punkt als eine Zeile
function punktText(p) {
  const teile = [p.punkt];
  if (p.verantwortlich) {
    teile.push(p.verantwortlich);
  }
  if (p.frist) {
    teile.push(p.frist);
  }
  return teile.join(" · ");
}

// Offene Punkte in die Plan-Seite übernehmen
function punkteUebernehmen() {
  const offen = zusammenfassung.offene_punkte || [];
  const vorhanden = holen("punkte");
  const neueTexte = offen
    .map(punktText)
    .filter((t) => !vorhanden.some((v) => v.text === t));
  if (neueTexte.length === 0) {
    meldung("Alle Punkte stehen schon im Plan.");
    el("meldung").className = "ok";
    return;
  }
  frageStellen(
    neueTexte.length === 1 ? "1 Punkt übernehmen?" : neueTexte.length + " Punkte übernehmen?",
    neueTexte.map((t) => "• " + t).join("\n"),
    "In den Plan",
    punkteSchreiben
  );
}

function punkteSchreiben() {
  const punkte = holen("punkte");
  let neue = 0;
  for (const p of zusammenfassung.offene_punkte || []) {
    const text = punktText(p);
    if (punkte.some((vorhanden) => vorhanden.text === text)) {
      continue;  // nicht doppelt anlegen
    }
    punkte.push({ id: Date.now() + neue, text: text, frist: "", erledigt: false });
    neue++;
  }
  speichern("punkte", punkte);
  meldung(neue === 0 ? "Alle Punkte stehen schon im Plan." : neue + " Punkt(e) in den Plan übernommen.");
  el("meldung").className = "ok";
}

// Zusammenfassung als PDF
async function zusammenfassungExport() {
  const z = zusammenfassung;
  const abschnitte = [];
  if ((z.teilnehmer || []).length > 0) {
    abschnitte.push({ ueberschrift: "Teilnehmer", text: z.teilnehmer.join(", ") });
  }
  abschnitte.push({ ueberschrift: "Kurzfassung", text: z.kurzfassung || "-" });
  const anhaengen = (titel, zeilen) => {
    if (zeilen && zeilen.length > 0) {
      abschnitte.push({ ueberschrift: titel, text: zeilen.map((x) => "- " + x).join("\n") });
    }
  };
  anhaengen("Beschlüsse", z.entscheidungen);
  anhaengen("Offene Punkte", (z.offene_punkte || []).map(punktText));
  anhaengen("Risiken", z.risiken);
  meldung("PDF wird erzeugt …");
  try {
    const antwort = await anfrage("/export/bericht/pdf", {
      bericht: {
        titel: z.titel || "Besprechungsprotokoll",
        untertitel: QUELLNAMEN[el("z_quelle").value] + " vom "
          + new Date().toLocaleDateString("de-DE"),
        abschnitte: abschnitte,
        hinweis: "Mit KI-Unterstützung erstellt. Vor Verwendung prüfen."
      }
    });
    const datei = await antwort.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(datei);
    link.download = "Protokoll_" + new Date().toISOString().slice(0, 10) + ".pdf";
    link.click();
    meldung("PDF fertig.");
    el("meldung").className = "ok";
  } catch (fehler) {
    meldung(fehler.message);
  }
}

// Brief als reiner Text, zum Einfügen in eine E-Mail
function briefAlsText() {
  briefLesen();
  const teile = [briefDaten.anrede || "", ""];
  for (const absatz of briefDaten.absaetze || []) {
    teile.push(absatz, "");
  }
  teile.push(briefDaten.gruss || "", "", briefDaten.unterzeichner || "");
  if (briefDaten.hinweis) {
    teile.push("", "--", briefDaten.hinweis);
  }
  return teile.join("\n");
}

async function briefKopieren() {
  const text = briefAlsText();
  try {
    await navigator.clipboard.writeText(text);
    meldung("Brieftext kopiert. Jetzt E-Mail öffnen und einfügen.");
    el("meldung").className = "ok";
  } catch (fehler) {
    // Aeltere Browser oder fehlende Freigabe: Umweg über ein Textfeld
    const hilfsfeld = document.createElement("textarea");
    hilfsfeld.value = text;
    hilfsfeld.style.position = "fixed";
    hilfsfeld.style.opacity = "0";
    document.body.appendChild(hilfsfeld);
    hilfsfeld.select();
    const geklappt = document.execCommand && document.execCommand("copy");
    hilfsfeld.remove();
    meldung(geklappt ? "Brieftext kopiert." : "Kopieren hat nicht geklappt. Text bitte von Hand markieren.");
    el("meldung").className = geklappt ? "ok" : "";
  }
}

// E-Mail öffnen
// - nur Empfänger und Betreff, der Text wird eingefügt
// - mailto kann keine Datei anhängen, das PDF kommt von Hand dazu
function briefMailOeffnen() {
  const betreff = encodeURIComponent(briefDaten.betreff || "Schreiben von der Baustelle");
  window.location.href = "mailto:" + encodeURIComponent(briefMail) + "?subject=" + betreff;
  meldung(briefMail
    ? "E-Mail geöffnet. Text einfügen, PDF anhängen."
    : "E-Mail geöffnet. Für diesen Empfänger ist keine Adresse hinterlegt.");
}

// Aus einem Schreibvorschlag direkt in den Briefweg
function vorschlagOeffnen(vorschlag) {
  ereignis = vorschlag.ereignis;
  felderAnzeigen();
  el("brieftyp").value = vorschlag.brieftyp;
  zeigeSeite("seite_felder");
}

// Tagesbericht in die Dateiliste legen
// - OHNE die Bilddaten: die würden den Speicher sprengen
// - gespeichert wird nur der Tag, die Fotos kommen beim erneuten
//   Herunterladen frisch aus dem Fotospeicher dazu
function berichtSpeichern(tag, bericht) {
  const ohneFotos = Object.assign({}, bericht);
  delete ohneFotos.fotos;
  const eintrag = {
    id: "bericht-" + tag,
    datum: datumDeutsch(tag),
    titel: bericht.titel || "Bautagesbericht",
    art: "bericht",
    tag: tag,
    daten: ohneFotos
  };
  const rest = holen("briefe").filter((b) => b.id !== eintrag.id);
  rest.unshift(eintrag);
  try {
    speichern("briefe", rest);
  } catch (fehler) {
    meldung("Bericht konnte nicht in die Dateiliste gelegt werden (Speicher voll).");
  }
}

// Gespeicherten Tagesbericht erneut herunterladen
// - die Fotos des Tages werden wieder angehängt
async function berichtErneutLaden(eintrag) {
  meldung("PDF wird erzeugt …");
  try {
    const fotos = fotosDesTages(eintrag.tag);
    const antwort = await anfrage("/export/bericht/pdf", {
      bericht: Object.assign({}, eintrag.daten, { fotos: fotos })
    });
    const datei = await antwort.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(datei);
    link.download = "Bautagesbericht_" + eintrag.tag + ".pdf";
    link.click();
    meldung(fotos.length > 0
      ? "PDF fertig, mit " + fotos.length + " Foto(s) im Anhang."
      : "PDF fertig. Für diesen Tag sind keine Fotos mehr gespeichert.");
    el("meldung").className = "ok";
  } catch (fehler) {
    meldung(fehler.message);
  }
}

function briefSpeichern() {
  const eintrag = {
    id: briefId || Date.now(),
    datum: new Date().toLocaleDateString("de-DE"),
    titel: briefDaten.betreff || briefDaten.brieftyp,
    art: "brief",
    fotoIds: briefFotoIds,
    daten: briefDaten
  };
  briefId = eintrag.id;
  const rest = holen("briefe").filter((b) => b.id !== eintrag.id);
  rest.unshift(eintrag);
  speichern("briefe", rest);
  vorgangAngezeigt(eintrag.id);
}

// Dateiliste anzeigen
function dateienAnzeigen() {
  const briefe = holen("briefe");
  el("dateiliste").innerHTML = "";
  if (briefe.length === 0) {
    el("dateiliste").textContent = "Noch keine Briefe. Sie erscheinen hier nach dem Download.";
  }
  for (const b of briefe) {
    const knopf = document.createElement("button");
    knopf.className = "datei";
    knopf.textContent = (b.art === "bericht" ? "📋 " : "✉️ ") + b.titel + " (" + b.datum + ")";
    knopf.addEventListener("click", () => {
      if (b.art === "bericht") {
        berichtErneutLaden(b);
      } else {
        briefOeffnen(b);
      }
    });
    el("dateiliste").appendChild(knopf);
  }
}

// Gespeicherten Brief wieder öffnen
function briefOeffnen(eintrag) {
  briefDaten = eintrag.daten;
  briefId = eintrag.id;
  briefFotoIds = eintrag.fotoIds || [];
  ereignis = null;
  vorgangId = null;
  briefAnzeigen();
  zeigeSeite("seite_brief");
}

// Menü und Seiten verbinden
el("menue_knopf").addEventListener("click", () => zeigeSeite("seite_menue"));
el("menue_zu").addEventListener("click", () => zeigeSeite("seite_start"));
el("gehe_start").addEventListener("click", () => zeigeSeite("seite_start"));
el("gehe_plan").addEventListener("click", () => {
  listeAnzeigen();
  zeigeSeite("seite_plan");
});
el("gehe_dateien").addEventListener("click", () => {
  dateienAnzeigen();
  zeigeSeite("seite_dateien");
});
el("punkt_neu").addEventListener("click", punktNeu);

// Menü-Knopf beim Tippen unsichtbar machen
// - verhindert versehentliches Antippen
// - visibility, damit nichts verrutscht
el("text").addEventListener("focus", () => {
  el("menue_knopf").style.visibility = "hidden";
});
el("text").addEventListener("blur", () => {
  el("menue_knopf").style.visibility = "visible";
});

// Auswahl vor dem Erstellen
// - Notiz oder offizielles Dokument
// - kommt jedes Mal (Mensch entscheidet)
function wahlZeigen() {
  if (erkennung !== null) {
    meldung("Bitte warte, bis die Aufnahme zu Ende ist.");
    return;
  }
  if (el("text").value.trim() === "") {
    meldung("Bitte erst sprechen oder tippen.");
    return;
  }
  meldung("");
  el("wahl").hidden = false;
}

function wahlSchliessen() {
  el("wahl").hidden = true;
}

// Gesprochenes direkt als Aufgabe in den Plan
// - Claude holt die Aufgabe heraus, das Datum rechnet das Backend im Code
// - "neue Rigips-Lieferung uebermorgen" wird zu einem Punkt mit Datum
async function alsPunktSpeichern() {
  const text = el("text").value.trim();
  if (text === "") {
    return;
  }
  wahlSchliessen();
  meldung("Lese Aufgabe und Termin …");
  let aufgabe = text;
  let frist = "";
  try {
    const antwort = await anfrage("/analyze", { text: text });
    const erkannt = await antwort.json();
    aufgabe = (erkannt.aufgabe || "").trim() || text;
    frist = erkannt.termin || "";
  } catch (fehler) {
    meldung("Ohne Server nur der Text, ohne Datum: " + fehler.message);
  }

  const punkte = holen("punkte");
  punkte.push({ id: Date.now(), text: aufgabe, frist: frist, erledigt: false });
  speichern("punkte", punkte);

  el("text").value = "";
  entwurfSpeichern();
  listeAnzeigen();
  zeigeSeite("seite_plan");
  meldung(frist
    ? "Im Plan: " + aufgabe + " am " + datumLesbar(frist)
    : "Im Plan: " + aufgabe + ". Kein Datum erkannt, trag es unten nach.");
  el("meldung").className = frist ? "ok" : "";
}

// Server-Adresse speichern und sofort ausprobieren
async function serverPruefen() {
  const eingabe = el("sv_adresse").value.trim().replace(/\/+$/, "");
  if (eingabe !== "" && !/^https?:\/\//.test(eingabe)) {
    serverStand("Die Adresse muss mit https:// anfangen.");
    return;
  }
  if (eingabe === "") {
    localStorage.removeItem("server");
  } else {
    localStorage.setItem("server", eingabe);
  }
  serverStand("Prüfe die Verbindung …");
  try {
    const antwort = await fetch(serverBasis() + "/health", { cache: "no-store" });
    if (!antwort.ok) {
      throw new Error("Der Server antwortet mit " + antwort.status + ".");
    }
    const stand = await antwort.json();
    serverStand(stand.claude_aktiv
      ? "Verbunden. Claude ist aktiv (" + (stand.modell || "") + ")."
      : "Verbunden, aber ohne API-Schlüssel. Nur Demo-Antworten.", true);
  } catch (fehler) {
    serverStand("Keine Verbindung: " + fehler.message
      + " Prüfe die Adresse und ob der Tunnel läuft.");
  }
}

function serverStand(text, gut) {
  const feld = el("sv_stand");
  feld.textContent = text;
  feld.className = gut ? "hinweis gut" : "hinweis";
  feld.hidden = text === "";
}

// 2026-11-24 -> 24.11.2026
function datumLesbar(iso) {
  const teile = (iso || "").split("-");
  return teile.length === 3 ? teile[2] + "." + teile[1] + "." + teile[0] : iso;
}

// Fotos
// - werden im Browser verkleinert, sonst sprengen sie den Speicher
// - max. 1280 px lange Kante, JPEG 60 %
const FOTO_KANTE = 1280;
const FOTO_GUETE = 0.6;
const FOTOS_PRO_TAG = 6;

function verkleinern(datei) {
  return new Promise((fertig, fehler) => {
    const leser = new FileReader();
    leser.onerror = () => fehler(new Error("Foto konnte nicht gelesen werden."));
    leser.onload = () => {
      const bild = new Image();
      bild.onerror = () => fehler(new Error("Foto konnte nicht geöffnet werden."));
      bild.onload = () => {
        const faktor = Math.min(1, FOTO_KANTE / Math.max(bild.width, bild.height));
        const flaeche = document.createElement("canvas");
        flaeche.width = Math.round(bild.width * faktor);
        flaeche.height = Math.round(bild.height * faktor);
        flaeche.getContext("2d").drawImage(bild, 0, 0, flaeche.width, flaeche.height);
        const url = flaeche.toDataURL("image/jpeg", FOTO_GUETE);
        fertig({ media_type: "image/jpeg", data: url.split(",")[1], beschreibung: "" });
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  });
}

async function fotosHinzufuegen(dateien) {
  const jetzt = new Date();
  const tag = jetzt.toLocaleDateString("sv-SE");
  const fotos = holen("fotos");
  const schonHeute = fotos.filter((f) => f.tag === tag).length;
  let platz = FOTOS_PRO_TAG - schonHeute;
  if (platz <= 0) {
    meldung("Für heute sind schon " + FOTOS_PRO_TAG + " Fotos da. Das reicht für den Bericht.");
    return;
  }
  meldung("Foto wird verkleinert …");
  for (const datei of Array.from(dateien).slice(0, platz)) {
    try {
      const klein = await verkleinern(datei);
      fotos.push({
        id: Date.now() + Math.random(),
        tag: tag,
        zeit: jetzt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        media_type: klein.media_type,
        data: klein.data,
        offen: true   // noch keinem Brief zugeordnet
      });
    } catch (fehler) {
      meldung(fehler.message);
      return;
    }
  }
  try {
    speichern("fotos", fotos);
  } catch (fehler) {
    meldung("Speicher voll. Erzeuge den Tagesbericht, danach ist wieder Platz.");
    return;
  }
  fotoStandAnzeigen();
  meldung(fotosOffen().length + " Foto(s) aufgenommen. Kommen an den nächsten Brief.");
  el("meldung").className = "ok";
}

// Fotos, die noch zu keinem Brief gehören
// - das sind die, die der Bauleiter gerade aufgenommen hat
function fotosOffen() {
  return holen("fotos").filter((f) => f.offen);
}

// Fotos zu einer Liste von Ids, in Backend-Form
function fotosNachIds(ids) {
  const gesucht = new Set(ids || []);
  return holen("fotos")
    .filter((f) => gesucht.has(f.id))
    .map((f) => ({ media_type: f.media_type, data: f.data, beschreibung: f.beschreibung || "" }));
}

// Fotos einem Brief zuordnen, damit sie nicht im nächsten wieder auftauchen
function fotosZuordnen(ids) {
  const gesucht = new Set(ids || []);
  const alle = holen("fotos").map((f) => gesucht.has(f.id) ? Object.assign({}, f, { offen: false }) : f);
  speichern("fotos", alle);
}

// Fotos eines Tages in der Form, die das Backend erwartet
function fotosDesTages(tag) {
  return holen("fotos")
    .filter((f) => f.tag === tag)
    .map((f) => ({ media_type: f.media_type, data: f.data, beschreibung: f.beschreibung || "" }));
}

function fotoStandAnzeigen() {
  const anzahl = fotosOffen().length;
  el("foto_stand").hidden = anzahl === 0;
  el("foto_stand").textContent = anzahl === 1
    ? "1 Foto aufgenommen. Kommt an den nächsten Brief."
    : anzahl + " Fotos aufgenommen. Kommen an den nächsten Brief.";
}

// Tagesbericht mit Claude
// - Notizen und Fotos des Tages gehen ans Backend
// - zurück kommt ein gegliederter Bericht, die Fotos sind im Anhang
async function tagesberichtErzeugen(tag, knopf) {
  const notizen = holen("notizen").filter((n) => n.tag === tag);
  notizen.sort((a, b) => a.zeit.localeCompare(b.zeit));
  const fotos = fotosDesTages(tag);
  if (notizen.length === 0 && fotos.length === 0) {
    meldung("Für diesen Tag gibt es nichts.");
    return;
  }
  laden(knopf, true, "Claude schreibt …");
  meldung("Claude schreibt den Bericht. Das dauert mit Fotos bis zu einer Minute.");
  try {
    const antwort = await anfrage("/tagesbericht/entwurf", {
      datum: datumDeutsch(tag),
      bauvorhaben: localStorage.getItem("bauvorhaben") || "",
      notizen: notizen.map((n) => n.zeit + " Uhr: " + n.text).join("\n"),
      termine: "",
      fotos: fotos
    });
    const bericht = await antwort.json();
    berichtSpeichern(tag, bericht);
    const pdf = await anfrage("/export/bericht/pdf", { bericht: bericht });
    const datei = await pdf.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(datei);
    link.download = "Bautagesbericht_" + tag + ".pdf";
    link.click();
    meldung("Tagesbericht fertig, mit " + fotos.length + " Foto(s) im Anhang.");
    el("meldung").className = "ok";
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(knopf, false, "Tagesbericht (KI)");
}

// Notiz speichern
// - nur im Browser, kein Backend
// - mit Tag und Uhrzeit
function notizSpeichern() {
  const jetzt = new Date();
  const text = el("text").value.trim();
  const neueId = Date.now();
  const notizen = holen("notizen");
  notizen.push({
    id: neueId,
    tag: jetzt.toLocaleDateString("sv-SE"),
    zeit: jetzt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    text: text
  });
  speichern("notizen", notizen);
  el("text").value = "";
  entwurfSpeichern();
  wahlSchliessen();

  const treffer = passenderPunkt(text);
  if (treffer) {
    frageStellen(
      "Punkt erledigt?",
      "Notiz: „" + text + "“\n\nPunkt im Plan: " + treffer.text,
      "Abhaken",
      () => punktAbhaken(treffer.id, neueId)
    );
    return;
  }
  meldung("Notiz gespeichert.");
  el("meldung").className = "ok";
}

// Notizen anzeigen
// - gruppiert nach Tag, neuester Tag oben
// - pro Tag ein PDF-Knopf
function notizenAnzeigen() {
  const notizen = holen("notizen");
  el("notizliste").innerHTML = "";
  if (notizen.length === 0) {
    el("notizliste").textContent = "Noch keine Notizen. Wähle beim Senden „Nur eine Notiz“.";
    return;
  }
  const tage = Array.from(new Set(notizen.map((n) => n.tag))).sort().reverse();
  for (const tag of tage) {
    const gruppe = document.createElement("div");
    gruppe.className = "tag";

    const kopf = document.createElement("div");
    kopf.className = "tag-kopf";
    const titel = document.createElement("h2");
    titel.textContent = datumDeutsch(tag);
    const pdf = document.createElement("button");
    pdf.className = "neben";
    pdf.textContent = "Als PDF";
    pdf.addEventListener("click", () => notizenExportieren(tag));
    const ki = document.createElement("button");
    ki.className = "neben";
    ki.textContent = "Tagesbericht (KI)";
    ki.addEventListener("click", () => tagesberichtErzeugen(tag, ki));
    kopf.append(titel, pdf, ki);
    gruppe.appendChild(kopf);

    const tagesNotizen = notizen.filter((n) => n.tag === tag);
    tagesNotizen.sort((a, b) => a.zeit.localeCompare(b.zeit));
    for (const n of tagesNotizen) {
      const zeile = document.createElement("div");
      zeile.className = "notiz";
      const zeit = document.createElement("span");
      zeit.className = "klein";
      zeit.textContent = n.zeit + " Uhr";
      const text = document.createElement("button");
      text.className = "notiz-text";
      text.textContent = n.text;
      text.addEventListener("click", () => notizBearbeiten(n.id));
      const weg = document.createElement("button");
      weg.className = "weg";
      weg.textContent = "Löschen";
      weg.addEventListener("click", () => notizLoeschen(n.id));
      zeile.append(zeit, text, weg);
      gruppe.appendChild(zeile);
    }
    el("notizliste").appendChild(gruppe);
  }
}

function notizLoeschen(id) {
  if (!bestaetigt.has(id)) {
    frageStellen("Notiz löschen?", "Die Notiz wird gelöscht.", "Löschen", () => {
      bestaetigt.add(id);
      notizLoeschen(id);
      bestaetigt.delete(id);
    });
    return;
  }
  speichern("notizen", holen("notizen").filter((n) => n.id !== id));
  notizenAnzeigen();
}

// Notizen eines Tages als PDF
// - nutzt den Bericht-Export vom Backend
async function notizenExportieren(tag) {
  const notizen = holen("notizen").filter((n) => n.tag === tag);
  notizen.sort((a, b) => a.zeit.localeCompare(b.zeit));
  meldung("");
  try {
    const antwort = await anfrage("/export/bericht/pdf", {
      bericht: {
        titel: "Notizen vom " + datumDeutsch(tag),
        untertitel: "Polier.ai",
        abschnitte: notizen.map((n) => ({
          ueberschrift: n.zeit + " Uhr",
          text: n.text
        })),
        hinweis: "",
        fotos: fotosDesTages(tag)
      }
    });
    const datei = await antwort.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(datei);
    link.download = "Notizen_" + tag + ".pdf";
    link.click();
  } catch (fehler) {
    meldung(fehler.message);
  }
}

el("wahl_dokument").addEventListener("click", () => {
  wahlSchliessen();
  analysieren();
});
el("wahl_plan").addEventListener("click", alsPunktSpeichern);
el("wahl_notiz").addEventListener("click", notizSpeichern);
el("wahl_zu").addEventListener("click", wahlSchliessen);
el("wahl").addEventListener("click", (e) => {
  if (e.target === el("wahl")) {
    wahlSchliessen();
  }
});
el("gehe_notizen").addEventListener("click", () => {
  notizenAnzeigen();
  zeigeSeite("seite_notizen");
});

el("gehe_zusammen").addEventListener("click", () => zeigeSeite("seite_zusammen"));
el("empfaenger_wahl").addEventListener("change", () => {
  el("empfaenger_frei").hidden = el("empfaenger_wahl").value !== "frei";
  kopieListeFuellen();   // der Hauptempfaenger faellt aus der Kopie-Liste raus
});

el("gehe_demo").addEventListener("click", demoUmschalten);
el("gehe_server").addEventListener("click", () => {
  el("sv_adresse").value = localStorage.getItem("server") || "";
  serverStand("");
  zeigeSeite("seite_server");
});
el("sv_pruefen").addEventListener("click", serverPruefen);
el("sv_leeren").addEventListener("click", () => {
  localStorage.removeItem("server");
  el("sv_adresse").value = "";
  serverStand("Zurückgesetzt. Die App spricht wieder mit dem Server, der sie ausliefert.", true);
});
el("gehe_firmen").addEventListener("click", () => {
  firmaAnzeigen();
  zeigeSeite("seite_firmen");
});
el("f_speichern").addEventListener("click", firmaSpeichern);
el("f_neu").addEventListener("click", empfaengerNeu);
el("f_beispiele").addEventListener("click", beispieleLaden);

el("gehe_soll").addEventListener("click", () => zeigeSeite("seite_soll"));
el("s_zeile_neu").addEventListener("click", sollNeuOeffnen);
el("sn_ok").addEventListener("click", sollNeuSpeichern);
el("sn_zu").addEventListener("click", sollNeuSchliessen);
el("s_neu").addEventListener("click", (klick) => {
  if (klick.target === el("s_neu")) {
    sollNeuSchliessen();
  }
});
el("s_start").addEventListener("click", () => sollAuswerten(false));
el("s_bewerten").addEventListener("click", () => sollAuswerten(true));
el("s_pdf").addEventListener("click", analyseExport);
el("z_start").addEventListener("click", zusammenfassen);
el("z_punkte").addEventListener("click", punkteUebernehmen);
el("z_pdf").addEventListener("click", zusammenfassungExport);

el("foto").addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length > 0) {
    fotosHinzufuegen(e.target.files);
  }
  e.target.value = "";  // damit dasselbe Foto erneut gewaehlt werden kann
});
fotoStandAnzeigen();

// Sichtbare Höhe des Fensters
// - beim Start der App ist 100vh oft größer als das, was man sieht
// - deshalb die echte Höhe messen und in CSS verwenden
function hoeheSetzen() {
  const hoehe = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--hoehe", hoehe + "px");
}
hoeheSetzen();
window.addEventListener("resize", hoeheSetzen);
window.addEventListener("orientationchange", hoeheSetzen);
window.addEventListener("pageshow", hoeheSetzen);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", hoeheSetzen);
}
setTimeout(hoeheSetzen, 300);

// Entwurf im Textfeld
// - geht nicht verloren, wenn die App neu startet
function entwurfSpeichern() {
  try {
    localStorage.setItem("entwurf", el("text").value);
  } catch (fehler) {
    // Speicher voll oder gesperrt: dann eben ohne Entwurf
  }
}

try {
  el("text").value = localStorage.getItem("entwurf") || "";
} catch (fehler) {
  el("text").value = "";
}
el("text").addEventListener("input", entwurfSpeichern);

// Offline-Hinweis
window.addEventListener("offline", () => {
  meldung("Du bist offline. Notizen gehen weiter, Briefe brauchen Internet.");
});
window.addEventListener("online", () => meldung(""));

// Link "Notizen" auf der Startseite
el("start_notizen").addEventListener("click", () => el("gehe_notizen").click());

// Gespräch aufnehmen (Jour fixe)
// - läuft weiter, bis man den Knopf noch einmal drückt
// - Chrome hört nach Pausen von selbst auf, wir starten dann neu
let gespraech = null;
let gespraechLaeuft = false;
let gespraechBisher = "";
let gespraechStart = 0;
let gespraechUhr = null;

function gespraechStandAnzeigen() {
  const sekunden = Math.floor((Date.now() - gespraechStart) / 1000);
  const min = String(Math.floor(sekunden / 60)).padStart(2, "0");
  const sek = String(sekunden % 60).padStart(2, "0");
  el("z_stand").textContent = "Aufnahme läuft … " + min + ":" + sek;
}

function gespraechHoeren() {
  const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;
  gespraech = new Erkennung();
  gespraech.lang = spracheHolen();
  gespraech.continuous = true;
  gespraech.interimResults = true;
  gespraech.onresult = (ereignisSprache) => {
    let text = "";
    for (const ergebnis of ereignisSprache.results) {
      text += ergebnis[0].transcript + " ";
    }
    el("z_text").value = (gespraechBisher + " " + text).trim();
  };
  gespraech.onerror = (fehler) => {
    if (fehler.error === "not-allowed" || fehler.error === "service-not-allowed") {
      gespraechLaeuft = false;
      meldung("Das Mikrofon ist nicht erlaubt. Erlaube es in den Browser-Einstellungen.");
    } else if (fehler.error === "audio-capture") {
      gespraechLaeuft = false;
      meldung("Kein Mikrofon gefunden.");
    }
  };
  gespraech.onend = () => {
    if (gespraechLaeuft) {
      gespraechBisher = el("z_text").value;
      gespraechHoeren();
    } else {
      gespraechBeenden();
    }
  };
  try {
    gespraech.start();
  } catch (fehler) {
    gespraechLaeuft = false;
    gespraechBeenden();
  }
}

function gespraechBeenden() {
  gespraech = null;
  clearInterval(gespraechUhr);
  el("z_stand").hidden = true;
  el("z_mikro_text").innerHTML = "Tippen zum<br>Aufnehmen";
  el("z_mikro").classList.remove("aktiv");
  if (el("z_text").value.trim() !== "") {
    el("z_quelle").value = "protokoll";
    zusammenfassen();
  }
}

function gespraechUmschalten() {
  if (gespraechLaeuft) {
    gespraechLaeuft = false;
    if (gespraech !== null) {
      gespraech.stop();
    }
    return;
  }
  const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Erkennung) {
    meldung("Aufnehmen geht hier nicht. Bitte den Text einfügen.");
    return;
  }
  meldung("");
  gespraechLaeuft = true;
  gespraechBisher = el("z_text").value;
  gespraechStart = Date.now();
  el("z_mikro_text").innerHTML = "Tippen zum<br>Beenden";
  el("z_mikro").classList.add("aktiv");
  el("z_stand").hidden = false;
  gespraechStandAnzeigen();
  gespraechUhr = setInterval(gespraechStandAnzeigen, 1000);
  gespraechHoeren();
}

el("z_mikro").addEventListener("click", gespraechUmschalten);

// Demo-Daten
// - nur hier werden Beispiel-Notizen und das Beispielfoto angelegt
// - "demo: true" macht sie wieder vollständig entfernbar
function demoAn() {
  return holen("notizen").some((n) => n.demo)
    || holen("fotos").some((f) => f.demo)
    || holen("punkte").some((p) => p.demo);
}

function demoEntfernen() {
  speichern("notizen", holen("notizen").filter((n) => !n.demo && n.id > 4));
  speichern("fotos", holen("fotos").filter((f) => !f.demo && f.zeit !== "15:20"));
  speichern("punkte", holen("punkte").filter((p) => !p.demo));
  el("text").value = "";
  el("z_text").value = "";
  el("s_notizen").value = "";
  entwurfSpeichern();
  fotoStandAnzeigen();
  demoKnopfAnzeigen();
}

function demoKnopfAnzeigen() {
  el("gehe_demo").innerHTML = demoAn()
    ? "Demo-Daten entfernen<small>Notizen, Foto und Zahlen löschen</small>"
    : "Demo-Daten laden<small>Notizen, Foto, Zahlen, Protokoll</small>";
}

function demoUmschalten() {
  if (demoAn()) {
    demoEntfernen();
    meldung("Demo-Daten entfernt.");
    el("meldung").className = "ok";
    zeigeSeite("seite_start");
    return;
  }
  demoDatenLaden();
  demoKnopfAnzeigen();
}

// Einmalig aufräumen: alte Demo-Daten aus früheren Versionen
if (localStorage.getItem("demo_bereinigt") === null) {
  try {
    localStorage.setItem("demo_bereinigt", "1");
    demoEntfernen();
  } catch (fehler) {
    // ohne Speicher einfach weitermachen
  }
}
demoKnopfAnzeigen();

// Rückfrage-Blatt
// - ersetzt window.confirm, das in der installierten App unterdrückt werden kann
const bestaetigt = new Set();
let frageAktion = null;

function frageStellen(titel, text, knopf, aktion) {
  el("frage_titel").textContent = titel;
  el("frage_text").textContent = text;
  el("frage_text").hidden = text === "";
  el("frage_ja").textContent = knopf;
  frageAktion = aktion;
  el("frage").hidden = false;
}

function frageSchliessen() {
  el("frage").hidden = true;
  frageAktion = null;
}

el("frage_ja").addEventListener("click", () => {
  const aktion = frageAktion;
  frageSchliessen();
  if (aktion) {
    aktion();
  }
});
el("frage_nein").addEventListener("click", frageSchliessen);
el("frage").addEventListener("click", (ereignisKlick) => {
  if (ereignisKlick.target === el("frage")) {
    frageSchliessen();
  }
});

// Einen Punkt bearbeiten
let punktOffen = null;

function punktBearbeiten(id) {
  const p = holen("punkte").find((x) => x.id === id);
  if (!p) {
    return;
  }
  punktOffen = id;
  el("p_text").value = p.text;
  el("p_frist").value = p.frist || "";
  el("p_erledigt").checked = p.erledigt === true;
  el("punkt_blatt").hidden = false;
}

function punktBlattZu() {
  el("punkt_blatt").hidden = true;
  punktOffen = null;
}

function punktSpeichern() {
  const text = el("p_text").value.trim();
  if (text === "") {
    meldung("Bitte einen Text eingeben.");
    return;
  }
  const neu = {
    text: text,
    frist: el("p_frist").value,
    erledigt: el("p_erledigt").checked
  };
  speichern("punkte", holen("punkte").map((p) => p.id === punktOffen ? Object.assign({}, p, neu) : p));
  punktBlattZu();
  listeAnzeigen();
  meldung("Punkt gespeichert.");
  el("meldung").className = "ok";
}

el("p_speichern").addEventListener("click", punktSpeichern);
el("p_zu").addEventListener("click", punktBlattZu);
el("punkt_blatt").addEventListener("click", (ereignisKlick) => {
  if (ereignisKlick.target === el("punkt_blatt")) {
    punktBlattZu();
  }
});
el("p_loeschen").addEventListener("click", () => {
  const id = punktOffen;
  punktBlattZu();
  punktLoeschen(id);
});

// Notiz mit einem offenen Punkt abgleichen
// - braucht ein Erledigt-Wort und ein gemeinsames Stichwort
const ERLEDIGT_WOERTER = [
  "geliefert", "angeliefert", "angekommen", "gekommen", "fertig", "erledigt",
  "montiert", "eingebaut", "installiert", "verlegt", "eingebracht", "abgenommen",
  "abgeschlossen", "repariert", "behoben", "freigegeben", "geklärt", "geklaert",
  "bestätigt", "bestaetigt", "aufgebaut", "gestellt", "abgeholt", "besichtigt",
  "begutachtet", "geprüft", "geprueft", "kontrolliert", "unterschrieben",
  "ist da", "war da", "waren da", "war hier", "waren hier", "ist durch",
  "hat geklappt", "ist fertig", "erfolgt"
];

const FUELLWOERTER = new Set([
  "wurde", "worden", "heute", "haben", "nicht", "noch", "auch", "schon",
  "werden", "wird", "muss", "soll", "kann", "ohne", "beim", "diese", "dieser",
  "eine", "einen", "einem", "oder", "aber", "dann", "jetzt", "lassen", "wegen",
  "alles", "wieder", "sind", "ist", "war"
]);

function stichwoerter(text) {
  return text.toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "s")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !FUELLWOERTER.has(w));
}

// Zwei Wörter zählen als gleich, wenn sie vorne übereinstimmen
// - fängt Tippfehler und Mehrzahl ab (Trennwand / Trennwant / Trennwände)
function aehnlich(a, b) {
  let gleich = 0;
  while (gleich < a.length && gleich < b.length && a[gleich] === b[gleich]) {
    gleich++;
  }
  return gleich >= 5 || (gleich >= 4 && gleich === a.length && gleich === b.length);
}

function passenderPunkt(text) {
  const klein = text.toLowerCase();
  if (!ERLEDIGT_WOERTER.some((w) => klein.includes(w))) {
    return null;
  }
  const ausNotiz = new Set(stichwoerter(text));
  let bester = null;
  let treffer = 0;
  for (const p of holen("punkte")) {
    if (p.erledigt) {
      continue;
    }
    const gemeinsam = stichwoerter(p.text)
      .filter((w) => Array.from(ausNotiz).some((n) => aehnlich(w, n))).length;
    if (gemeinsam > treffer) {
      treffer = gemeinsam;
      bester = p;
    }
  }
  return treffer > 0 ? bester : null;
}

function punktAbhaken(punktId, notizId) {
  speichern("punkte", holen("punkte").map((p) => p.id === punktId ? Object.assign({}, p, { erledigt: true }) : p));
  speichern("notizen", holen("notizen").map((n) => n.id === notizId ? Object.assign({}, n, { punktId: punktId }) : n));
  meldung("Punkt abgehakt, Notiz hängt jetzt daran.");
  el("meldung").className = "ok";
}

// Eine Notiz bearbeiten
let notizOffen = null;

function notizBearbeiten(id) {
  const n = holen("notizen").find((x) => x.id === id);
  if (!n) {
    return;
  }
  notizOffen = id;
  el("n_text").value = n.text;
  el("notiz_blatt").hidden = false;
}

function notizBlattZu() {
  el("notiz_blatt").hidden = true;
  notizOffen = null;
}

function notizTextSpeichern() {
  const text = el("n_text").value.trim();
  if (text === "") {
    meldung("Bitte einen Text eingeben.");
    return;
  }
  speichern("notizen", holen("notizen").map((n) => n.id === notizOffen ? Object.assign({}, n, { text: text }) : n));
  notizBlattZu();
  notizenAnzeigen();
  meldung("Notiz gespeichert.");
  el("meldung").className = "ok";
}

el("n_speichern").addEventListener("click", notizTextSpeichern);
el("n_zu").addEventListener("click", notizBlattZu);
el("notiz_blatt").addEventListener("click", (ereignisKlick) => {
  if (ereignisKlick.target === el("notiz_blatt")) {
    notizBlattZu();
  }
});
el("n_loeschen").addEventListener("click", () => {
  const id = notizOffen;
  notizBlattZu();
  notizLoeschen(id);
});

// Version anzeigen
// - damit man sieht, ob wirklich die neueste Fassung läuft
const VERSION = "v54";
el("version").textContent = "Polier.ai " + VERSION;

// Sprachwahl am Mikrofon
el("sprache").addEventListener("change", () => {
  localStorage.setItem("sprache", el("sprache").value);
  spracheAnzeigen();
});
spracheAnzeigen();

// Fristenwaechter
// - merkt sich jede Behinderung, Bedenken, Mehrkosten oder jeden Mangel,
//   zu dem noch kein Schreiben rausgegangen ist
// - Quellen: Analysen auf dem Dokument-Weg und, per Stichwort, die Notizen
// - laeuft nur im Browser, kostet keine Tokens
const MELDEPFLICHT = {
  behinderung: {
    name: "Behinderung",
    regel: "Behinderungen sind nach § 6 Abs. 1 VOB/B unverzüglich schriftlich anzuzeigen.",
    woerter: ["steht still", "stehen still", "stillstand", "kam nicht", "nicht gekommen",
      "nicht angekommen", "nicht geliefert", "verzug", "verzögert", "verspätet", "verspätung",
      "ausgefallen", "warten auf", "wartet auf", "behindert", "behinderung", "blockiert",
      "gesperrt", "kein zugang", "fehlt noch", "fehlen noch", "fehlender", "fehlende"]
  },
  bedenken: {
    name: "Bedenken",
    regel: "Bedenken sind nach § 4 Abs. 3 VOB/B unverzüglich, möglichst vor Beginn der Arbeiten, schriftlich mitzuteilen.",
    woerter: ["bedenken", "nicht fachgerecht", "falsch geplant", "passt nicht",
      "nicht ausführbar", "widerspricht"]
  },
  mehrkosten: {
    name: "Mehrkosten",
    regel: "Mehrvergütung nach § 2 Abs. 6 VOB/B ist vor Beginn der Ausführung anzukündigen.",
    woerter: ["zusätzlich", "zusatzleistung", "mehraufwand", "nachtrag",
      "geänderte ausführung", "auf anordnung"]
  },
  mangel: {
    name: "Mangel",
    regel: "Mängel während der Ausführung werden nach § 4 Abs. 7 VOB/B schriftlich angezeigt.",
    woerter: ["riss", "risse", "beschädigt", "undicht", "mangel", "mängel", "schaden",
      "schimmel", "feuchtigkeit"]
  }
};

// Ganzes Wort suchen; \b kennt keine Umlaute, darum von Hand
function wortDrin(text, wort) {
  const t = " " + text.toLowerCase() + " ";
  let ab = 0;
  while (true) {
    const stelle = t.indexOf(wort, ab);
    if (stelle < 0) {
      return false;
    }
    const vor = t[stelle - 1];
    const nach = t[stelle + wort.length];
    if (!/[a-zäöüß]/.test(vor) && !/[a-zäöüß]/.test(nach)) {
      return true;
    }
    ab = stelle + 1;
  }
}

// Welche Anzeige koennte eine Notiz brauchen?
function notizArt(text) {
  for (const art of ["behinderung", "bedenken", "mehrkosten", "mangel"]) {
    if (MELDEPFLICHT[art].woerter.some((w) => wortDrin(text, w))) {
      return art;
    }
  }
  return null;
}

// Volle Kalendertage seit einem Datum JJJJ-MM-TT
function tageSeit(tag) {
  const heute = new Date(new Date().toLocaleDateString("sv-SE") + "T00:00:00");
  const dann = new Date(tag + "T00:00:00");
  return Math.max(0, Math.round((heute - dann) / 86400000));
}

function seitText(tage) {
  if (tage === 0) {
    return "seit heute";
  }
  return tage === 1 ? "seit gestern" : "seit " + tage + " Tagen";
}

// Vorgang aus einer Analyse merken (Dokument-Weg)

function vorgangMerken(erkannt, text) {
  if (!MELDEPFLICHT[erkannt.art]) {
    vorgangId = null;
    return;
  }
  const liste = holen("vorgaenge");
  const neu = {
    id: Date.now(),
    tag: new Date().toLocaleDateString("sv-SE"),
    art: erkannt.art,
    gewerk: erkannt.gewerk || "",
    text: text,
    ereignis: erkannt,
    briefId: null,
    erledigt: false
  };
  liste.push(neu);
  speichern("vorgaenge", liste);
  vorgangId = neu.id;
}

// Nach dem Export: Vorgang gilt als angezeigt
function vorgangAngezeigt(briefNummer) {
  if (vorgangId === null) {
    return;
  }
  const liste = holen("vorgaenge");
  for (const v of liste) {
    if (v.id === vorgangId) {
      v.briefId = briefNummer;
    }
  }
  speichern("vorgaenge", liste);
}

// Alles, was noch offen ist, neueste zuerst
function offeneVorgaenge() {
  const offen = [];
  for (const v of holen("vorgaenge")) {
    if (!v.erledigt && v.briefId === null) {
      offen.push({ schluessel: "v" + v.id, quelle: "analyse", art: v.art, tag: v.tag,
        gewerk: v.gewerk, text: v.text, vorgang: v });
    }
  }
  const aus = holen("waechter_aus");
  for (const n of holen("notizen")) {
    if (aus.includes("n" + n.id) || tageSeit(n.tag) > 14) {
      continue;
    }
    const art = notizArt(n.text || "");
    if (art) {
      offen.push({ schluessel: "n" + n.id, quelle: "notiz", art: art, tag: n.tag,
        zeit: n.zeit, gewerk: "", text: n.text, notiz: n });
    }
  }
  return offen.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

// Streifen auf der Startseite
function waechterAnzeigen() {
  const knopf = el("waechter");
  const offen = offeneVorgaenge();
  if (offen.length === 0) {
    knopf.hidden = true;
    return;
  }
  const aeltester = Math.max(...offen.map((o) => tageSeit(o.tag)));
  knopf.className = "waechter" + (aeltester >= 1 ? " dringend" : "");
  knopf.innerHTML = "";
  const titel = document.createElement("strong");
  const zeile = document.createElement("small");
  if (offen.length === 1) {
    const o = offen[0];
    titel.textContent = MELDEPFLICHT[o.art].name + (o.gewerk ? " " + o.gewerk : "")
      + " " + seitText(tageSeit(o.tag)) + " ohne Anzeige";
    zeile.textContent = "Antippen, um das Schreiben vorzubereiten";
  } else {
    titel.textContent = offen.length + " Vorgänge ohne Anzeige";
    zeile.textContent = "Der älteste " + seitText(aeltester) + ". Antippen für die Liste";
  }
  knopf.append(titel, zeile);
  knopf.hidden = false;
}

// Liste mit allen offenen Vorgaengen
function waechterOeffnen() {
  const ziel = el("waechter_liste");
  ziel.innerHTML = "";
  const offen = offeneVorgaenge();
  if (offen.length === 0) {
    el("waechter_blatt").hidden = true;
    waechterAnzeigen();
    return;
  }
  for (const o of offen) {
    const eintrag = document.createElement("div");
    eintrag.className = "waechter-eintrag";
    const kopf = document.createElement("strong");
    kopf.textContent = MELDEPFLICHT[o.art].name + (o.gewerk ? " · " + o.gewerk : "");
    const wann = document.createElement("small");
    wann.textContent = seitText(tageSeit(o.tag))
      + (o.quelle === "notiz" ? " · aus einer Notiz" + (o.zeit ? " von " + o.zeit : "") : "");
    const zitat = document.createElement("p");
    zitat.textContent = "„" + (o.text || "").slice(0, 160) + ((o.text || "").length > 160 ? " …" : "") + "“";
    const regel = document.createElement("small");
    regel.className = "regel";
    regel.textContent = MELDEPFLICHT[o.art].regel;
    const schreiben = document.createElement("button");
    schreiben.className = "haupt";
    schreiben.textContent = "Schreiben vorbereiten";
    schreiben.addEventListener("click", () => vorgangAufnehmen(o));
    const weg = document.createElement("button");
    weg.className = "neben";
    weg.textContent = "Keine Anzeige nötig";
    weg.addEventListener("click", () => {
      vorgangAblegen(o);
      waechterOeffnen();
    });
    eintrag.append(kopf, wann, zitat, regel, schreiben, weg);
    ziel.appendChild(eintrag);
  }
  el("waechter_blatt").hidden = false;
}

function vorgangAblegen(o) {
  if (o.quelle === "analyse") {
    const liste = holen("vorgaenge");
    for (const v of liste) {
      if ("v" + v.id === o.schluessel) {
        v.erledigt = true;
      }
    }
    speichern("vorgaenge", liste);
  } else {
    const aus = holen("waechter_aus");
    aus.push(o.schluessel);
    speichern("waechter_aus", aus);
  }
}

// Vom Waechter direkt in den Briefweg
function vorgangAufnehmen(o) {
  el("waechter_blatt").hidden = true;
  if (o.quelle === "analyse") {
    ereignis = Object.assign({}, o.vorgang.ereignis);
    vorgangId = o.vorgang.id;
    felderAnzeigen();
    if (MELDEPFLICHT[o.art]) {
      el("brieftyp").value = o.art;
    }
    zeigeSeite("seite_felder");
    return;
  }
  // Notiz: erst analysieren, das legt einen echten Vorgang an
  vorgangAblegen(o);
  el("text").value = o.text;
  zeigeSeite("seite_start");
  analysieren();
}

el("waechter").addEventListener("click", waechterOeffnen);
el("waechter_zu").addEventListener("click", () => {
  el("waechter_blatt").hidden = true;
});
el("waechter_blatt").addEventListener("click", (klick) => {
  if (klick.target === el("waechter_blatt")) {
    el("waechter_blatt").hidden = true;
  }
});
waechterBereit = true;
waechterAnzeigen();

// Nachtragsakte
// - sammelt zu einem Stichwort alle Notizen, Schreiben, Tagesberichte,
//   Plan-Punkte und die Fotos dazu
// - ordnet alles nach Datum und Uhrzeit und gibt es als ein Dokument aus
// - reiner Code im Browser; der Export nutzt den vorhandenen Bericht-Export
const AKTE_FOTO_FENSTER = 20;   // Minuten um eine passende Notiz herum
const AKTE_MAX_FOTOS = 10;

function enthaelt(text, wort) {
  return (text || "").toLowerCase().includes(wort);
}

// Zeitpunkt in Minuten seit 1970, fuer Sortierung und Foto-Fenster
function zeitpunkt(tag, zeit) {
  const d = new Date(tag + "T" + (zeit || "00:00") + ":00");
  return isNaN(d) ? 0 : Math.round(d.getTime() / 60000);
}

// Brief-Eintraege tragen das Datum deutsch, die Id ist meist ein Zeitstempel
function briefZeit(b) {
  if (typeof b.id === "number" && b.id > 1e12) {
    const d = new Date(b.id);
    return { tag: d.toLocaleDateString("sv-SE"),
      zeit: d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) };
  }
  if (b.tag) {
    return { tag: b.tag, zeit: "" };
  }
  const teile = (b.datum || "").split(".");
  return teile.length === 3 ? { tag: teile[2] + "-" + teile[1] + "-" + teile[0], zeit: "" } : { tag: "", zeit: "" };
}

function akteSammeln(wortRoh) {
  const wort = wortRoh.trim().toLowerCase();
  const ergebnis = { wort: wortRoh.trim(), eintraege: [], briefe: [], punkte: [], fotos: [] };
  if (wort.length < 3) {
    return ergebnis;
  }

  // Notizen
  const notizZeiten = [];
  for (const n of holen("notizen")) {
    if (enthaelt(n.text, wort)) {
      ergebnis.eintraege.push({ tag: n.tag, zeit: n.zeit || "", art: "Notiz", text: n.text,
        sort: zeitpunkt(n.tag, n.zeit) });
      notizZeiten.push({ tag: n.tag, minuten: zeitpunkt(n.tag, n.zeit), text: n.text });
    }
  }

  // Schreiben und Tagesberichte
  const fotoIds = new Set();
  for (const b of holen("briefe")) {
    const d = b.daten || {};
    const volltext = [b.titel, d.betreff, d.empfaenger, (d.absaetze || []).join(" "),
      (d.abschnitte || []).map((a) => a.ueberschrift + " " + a.text).join(" ")].join(" ");
    if (!enthaelt(volltext, wort)) {
      continue;
    }
    const z = briefZeit(b);
    if (b.art === "bericht") {
      ergebnis.eintraege.push({ tag: z.tag, zeit: z.zeit, art: "Tagesbericht",
        text: b.titel || "Bautagesbericht", sort: zeitpunkt(z.tag, z.zeit || "23:59") });
    } else {
      ergebnis.eintraege.push({ tag: z.tag, zeit: z.zeit, art: "Schreiben",
        text: (d.betreff || b.titel) + (d.empfaenger ? ", an " + d.empfaenger.split("\n")[0] : ""),
        sort: zeitpunkt(z.tag, z.zeit || "23:59") });
      ergebnis.briefe.push({ ...z, daten: d });
      for (const id of b.fotoIds || []) {
        fotoIds.add(id);
      }
    }
  }

  // Fotos: die zu passenden Schreiben und die kurz vor oder nach einer passenden Notiz
  for (const f of holen("fotos")) {
    const minuten = zeitpunkt(f.tag, f.zeit);
    const naheNotiz = notizZeiten.find((n) => n.tag === f.tag
      && Math.abs(n.minuten - minuten) <= AKTE_FOTO_FENSTER);
    if (fotoIds.has(f.id) || naheNotiz) {
      ergebnis.fotos.push({ foto: f, bezug: naheNotiz ? naheNotiz.text : "" });
    }
  }
  ergebnis.fotos.sort((a, b) => zeitpunkt(a.foto.tag, a.foto.zeit) - zeitpunkt(b.foto.tag, b.foto.zeit));
  for (const { foto } of ergebnis.fotos) {
    ergebnis.eintraege.push({ tag: foto.tag, zeit: foto.zeit || "", art: "Foto",
      text: "Foto aufgenommen", sort: zeitpunkt(foto.tag, foto.zeit) });
  }

  // Plan-Punkte (ohne Datum der Erfassung, darum eigener Abschnitt)
  for (const p of holen("punkte")) {
    if (enthaelt(p.text, wort)) {
      ergebnis.punkte.push(p);
    }
  }

  ergebnis.eintraege.sort((a, b) => a.sort - b.sort);
  return ergebnis;
}

// Kurze Zusammenfassung, nur gezaehlt, nichts erfunden
function akteUeberblick(a) {
  const zahl = (art) => a.eintraege.filter((e) => e.art === art).length;
  const teile = [];
  const n = zahl("Notiz");
  if (n) teile.push(n + (n === 1 ? " Notiz" : " Notizen"));
  if (a.briefe.length) teile.push(a.briefe.length + (a.briefe.length === 1 ? " Schreiben" : " Schreiben"));
  const t = zahl("Tagesbericht");
  if (t) teile.push(t + (t === 1 ? " Tagesbericht" : " Tagesberichte"));
  if (a.fotos.length) teile.push(a.fotos.length + (a.fotos.length === 1 ? " Foto" : " Fotos"));
  if (a.punkte.length) teile.push(a.punkte.length + (a.punkte.length === 1 ? " Plan-Punkt" : " Plan-Punkte"));
  const tage = a.eintraege.map((e) => e.tag).filter(Boolean).sort();
  let zeitraum = "";
  if (tage.length) {
    zeitraum = tage[0] === tage[tage.length - 1]
      ? " am " + datumDeutsch(tage[0])
      : " vom " + datumDeutsch(tage[0]) + " bis " + datumDeutsch(tage[tage.length - 1]);
  }
  return teile.length ? teile.join(", ") + zeitraum + "." : "";
}

function akteAnzeigen() {
  const a = akteSammeln(el("a_wort").value);
  const ziel = el("a_vorschau");
  ziel.innerHTML = "";
  const etwas = a.eintraege.length > 0 || a.punkte.length > 0;
  el("a_pdf").hidden = !etwas;
  el("a_docx").hidden = !etwas;
  if (el("a_wort").value.trim().length < 3) {
    return;
  }
  if (!etwas) {
    ziel.textContent = "Zu „" + a.wort + "“ ist nichts gespeichert.";
    return;
  }
  const kopf = document.createElement("p");
  kopf.className = "hinweis";
  kopf.textContent = akteUeberblick(a);
  ziel.appendChild(kopf);

  let letzterTag = "";
  for (const e of a.eintraege) {
    if (e.tag !== letzterTag) {
      const h = document.createElement("h2");
      h.textContent = e.tag ? datumDeutsch(e.tag) : "Ohne Datum";
      ziel.appendChild(h);
      letzterTag = e.tag;
    }
    const zeile = document.createElement("div");
    zeile.className = "akte-zeile";
    const zeit = document.createElement("small");
    zeit.textContent = (e.zeit || "–") + " · " + e.art;
    const text = document.createElement("span");
    text.textContent = e.text;
    zeile.append(zeit, text);
    ziel.appendChild(zeile);
  }
  if (a.punkte.length) {
    const h = document.createElement("h2");
    h.textContent = "Plan";
    ziel.appendChild(h);
    for (const p of a.punkte) {
      const zeile = document.createElement("div");
      zeile.className = "akte-zeile";
      const zeit = document.createElement("small");
      zeit.textContent = (p.erledigt ? "erledigt" : "offen") + (p.frist ? " · bis " + datumDeutsch(p.frist) : "");
      const text = document.createElement("span");
      text.textContent = p.text;
      zeile.append(zeit, text);
      ziel.appendChild(zeile);
    }
  }
}

// Vorschlaege: Gewerke, die schon vorkommen
function akteVorschlaege() {
  const namen = new Set();
  for (const v of holen("vorgaenge")) {
    if (v.gewerk) namen.add(v.gewerk);
  }
  for (const b of holen("briefe")) {
    const betreff = (b.daten && b.daten.betreff) || "";
    const teil = betreff.split(" - ")[1];
    if (teil && teil !== "Bauleistung") namen.add(teil.trim());
  }
  for (const e of holen("empfaenger")) {
    if (e.gewerk) namen.add(e.gewerk);
  }
  const ziel = el("a_vorschlaege");
  ziel.innerHTML = "";
  for (const name of Array.from(namen).slice(0, 6)) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = name;
    chip.addEventListener("click", () => {
      el("a_wort").value = name;
      akteAnzeigen();
    });
    ziel.appendChild(chip);
  }
}

// Akte als Dokument fuer den Bericht-Export
function akteBericht(a) {
  const firma = firmaHolen();
  const abschnitte = [{ ueberschrift: "Überblick", text: akteUeberblick(a) }];

  // Chronologie, ein Abschnitt pro Tag
  const proTag = new Map();
  for (const e of a.eintraege) {
    const tag = e.tag || "";
    if (!proTag.has(tag)) proTag.set(tag, []);
    proTag.get(tag).push((e.zeit ? e.zeit + " Uhr" : "ohne Uhrzeit") + " · " + e.art + ": " + e.text);
  }
  for (const [tag, zeilen] of proTag) {
    abschnitte.push({ ueberschrift: tag ? "Chronologie " + datumDeutsch(tag) : "Chronologie ohne Datum",
      text: zeilen.join("\n") });
  }

  // Die Schreiben im Wortlaut
  for (const b of a.briefe) {
    const d = b.daten;
    const kopf = [
      b.tag ? "Datum: " + datumDeutsch(b.tag) : "",
      d.empfaenger ? "An: " + d.empfaenger.replace(/\n/g, ", ") : "",
      (d.kopie_an || []).length ? "Kopie an: " + d.kopie_an.join(", ") : "",
      d.rechtsgrundlage ? "Grundlage: " + d.rechtsgrundlage : ""
    ].filter(Boolean).join("\n");
    abschnitte.push({ ueberschrift: "Schreiben: " + (d.betreff || d.brieftyp || "ohne Betreff"),
      text: kopf + "\n\n" + (d.absaetze || []).join("\n\n") });
  }

  if (a.punkte.length) {
    abschnitte.push({ ueberschrift: "Punkte im Plan", text: a.punkte.map((p) =>
      "- " + p.text + (p.frist ? " (bis " + datumDeutsch(p.frist) + ")" : "")
      + (p.erledigt ? ", erledigt" : ", offen")).join("\n") });
  }

  abschnitte.push({ ueberschrift: "Vollständigkeit",
    text: "Diese Akte enthält alle in Polier.ai gespeicherten Einträge, in denen „" + a.wort
      + "“ vorkommt, sowie Fotos, die bis " + AKTE_FOTO_FENSTER + " Minuten vor oder nach einer dieser Notizen aufgenommen "
      + "oder einem dieser Schreiben angehängt wurden. Einträge ohne dieses Stichwort fehlen. "
      + "Bitte vor der Weitergabe auf Vollständigkeit prüfen." });

  const fotos = a.fotos.slice(0, AKTE_MAX_FOTOS).map(({ foto, bezug }) => ({
    media_type: foto.media_type || "image/jpeg",
    data: foto.data,
    beschreibung: (foto.tag ? datumDeutsch(foto.tag) : "") + (foto.zeit ? ", " + foto.zeit + " Uhr" : "")
      + (bezug ? " · zur Notiz: " + bezug.slice(0, 90) : "")
  }));

  return {
    titel: "Nachtragsakte: " + a.wort,
    untertitel: [firma.bauvorhaben ? "Bauvorhaben: " + firma.bauvorhaben : "",
      firma.firma || "", "erstellt am " + new Date().toLocaleDateString("de-DE")].filter(Boolean).join(" · "),
    abschnitte: abschnitte,
    hinweis: "Mit Polier.ai zusammengestellt. Keine Rechtsberatung. Inhalte vor Verwendung prüfen.",
    fotos: fotos
  };
}

async function akteExport(art) {
  const a = akteSammeln(el("a_wort").value);
  if (a.eintraege.length === 0 && a.punkte.length === 0) {
    return;
  }
  const knopf = el(art === "pdf" ? "a_pdf" : "a_docx");
  const text = art === "pdf" ? "Akte als PDF" : "Akte als Word";
  laden(knopf, true, art === "pdf" ? "Erzeuge PDF …" : "Erzeuge Word …");
  meldung("");
  try {
    const antwort = await anfrage("/export/bericht/" + art, { bericht: akteBericht(a) });
    const datei = await antwort.blob();
    const name = "Nachtragsakte_" + a.wort.replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, "_") + "_"
      + new Date().toISOString().slice(0, 10) + "." + art;
    herunterladen(datei, name);
    meldung(a.fotos.length > AKTE_MAX_FOTOS
      ? "Akte fertig. " + AKTE_MAX_FOTOS + " von " + a.fotos.length + " Fotos sind angehängt."
      : "Akte fertig.");
    el("meldung").className = "ok";
  } catch (fehler) {
    meldung(fehler.message);
  }
  laden(knopf, false, text);
}

el("gehe_akte").addEventListener("click", () => {
  akteVorschlaege();
  akteAnzeigen();
  zeigeSeite("seite_akte");
});
el("a_wort").addEventListener("input", akteAnzeigen);
el("a_pdf").addEventListener("click", () => akteExport("pdf"));
el("a_docx").addEventListener("click", () => akteExport("docx"));

// Kostenfolge mitrechnen, sobald Dauer oder Brieftyp sich aendern
el("dauer").addEventListener("input", kostenHinweisAnzeigen);
el("brieftyp").addEventListener("change", kostenHinweisAnzeigen);
