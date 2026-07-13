# Wettbuch 🎲

Eine einfache App, um private Wetten unter Freunden zu verwalten – mit Quoten, automatischer Gewinnberechnung, Haus-Provision und Rundung. Reines HTML/CSS/JavaScript, **keine Installation, kein Server, kein Konto**. Alle Daten bleiben lokal auf deinem Gerät.

👉 **Live:** https://mrsyver.github.io/betting-book/

## Auf dem iPhone benutzen

1. Öffne die Live-URL in **Safari**.
2. Tippe auf **Teilen** → **Zum Home-Bildschirm**.
3. Starte die App künftig über das Icon – sie läuft im Vollbild wie eine echte App.

## Funktionen

- **Neue Wette** über **+**: Titel, Beschreibung und **beliebig viele Ausgänge** mit **frei wählbarem Text** (z. B. Namen oder „Unentschieden“).
- **Gewinnmodell pro Wette umschaltbar:**
  - **Feste Quote:** Jeder Einsatz friert die Quote zum Zeitpunkt des Wettens ein. Gewinn = Einsatz × eingefrorene Quote. Die Quote wird transparent als Bruch angezeigt (`Pool ÷ Einsatz auf den Ausgang`).
  - **Pool-Aufteilung (parimutuel):** Der gesamte Pool wird am Ende proportional zum Einsatz unter den Gewinnern aufgeteilt.
- **Einsätze** hinzufügen (Person + Betrag + Ausgang). Die **Quote zum Zeitpunkt der Wette** wird gespeichert.
- **Ergebnis eintragen:** Gewinner-Ausgang wählen → **Gewinn wird automatisch berechnet**. Danach:
  - **Provision des Hauses (%)** einbehalten (bei 0 % wird alles ausgeschüttet),
  - Auszahlung auf **glatte Euro runden** (abrunden / kaufmännisch / aufrunden).
  - Anzeige in der Reihenfolge **exakt → nach Provision → gerundet**.

## Daten & Backup

- Alle Wetten werden im Browser gespeichert (`localStorage`) und bleiben nach dem Schließen erhalten.
- iOS kann lokale Website-Daten nach längerer Nichtnutzung löschen. Sichere daher regelmäßig über das **⋯-Menü → Backup exportieren** (lädt eine JSON-Datei). Mit **Backup importieren** stellst du den Stand wieder her – auch auf einem anderen Gerät.

## Lokal ausprobieren

Es reicht, `index.html` in einem Browser zu öffnen. Alternativ ein kleiner Webserver:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Keine Abhängigkeiten, kein Build-Schritt.
