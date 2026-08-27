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
  - **Pool-Aufteilung (parimutuel):** Der gesamte Pool wird am Ende proportional zum Einsatz unter den Gewinnern aufgeteilt. Die eingefrorenen Quoten spielen für die Auszahlung keine Rolle (jeder Gewinner erhält dieselbe End-Quote).
  - **Feste Quote:** Jeder Einsatz friert die Quote zum Zeitpunkt des Wettens ein. Gewinn = Einsatz × eingefrorene Quote. Die Quote wird transparent als Bruch angezeigt (`Pool ÷ Einsatz auf den Ausgang`). Die Summe der Auszahlungen kann vom Pool abweichen – der Rest bleibt beim Haus (bzw. muss zugeschossen werden).
  - **Quoten-Pool (voll ausgeschüttet):** Kombiniert beides – die eingefrorenen Quoten werden als Gewichtung berücksichtigt, aber auf den Pool normiert, sodass **exakt der ganze Pool** ausgezahlt wird. Auszahlung = `Pool × (Einsatz × Quote) ÷ Σ(Einsatz × Quote über alle Gewinner)`.
- **Provision – Bezugsgröße pro Wette wählbar** (beim Anlegen):
  - **Auszahlung:** Die Provision wird vom gesamten Auszahlungsbetrag (Einsatz + Gewinn) abgezogen.
  - **nur Gewinn:** Reine Gewinnbeteiligung – der Einsatz kommt voll zurück, nur der Gewinn wird gekürzt.
- **Einsätze** hinzufügen (Person + Betrag + Ausgang). Die **Quote zum Zeitpunkt der Wette** wird gespeichert.
- **PayPal-QR pro Einsatz:** Beim Hinzufügen eines Einsatzes erzeugt ein Button einen **QR-Code mit exakt diesem Betrag**, den der Wettende direkt scannt, um sofort zu bezahlen. Der QR-Code wird **lokal auf dem Gerät** erzeugt (funktioniert offline, kein externer Dienst). Empfänger ist standardmäßig der PayPal.Me-Name **Moritz975**; im **⋯-Menü → PayPal-Empfänger** änderbar – entweder ein anderer **PayPal.Me-Benutzername** oder eine **PayPal-E-Mail** (dann klassischer PayPal-Bezahllink mit vorausgefülltem Betrag).
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
