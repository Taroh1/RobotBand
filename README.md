# Robot Band · Chord & Loop Studio

Den vorhandenen lokalen Codex-Chat auf einem zweiten Gerät weiterführen: [verschlüsseltes Übertragungspaket und Importanleitung](chat-transfer/README.md). Der Schlüssel wird separat aufbewahrt.

Lokales Musikstudio für Launchpad X und eine Band mit **drei Bots**. Melodische Pads spielen vollständige Akkorde; Schlagzeug-Pads einzelne Sounds. Mit vier Loop-Spuren kannst du Beats, Akkorde und synthetische Gesangsharmonien übereinanderlegen. Musikrollen und physische Roboter sind getrennt: Eine zusätzliche Audiospur benötigt keinen vierten Bot.

## Drei Bots

Bestätigte Zuordnung:

| Roboter | Musikrolle |
| --- | --- |
| bot-1 | Schlagzeug |
| bot-2 | Gitarre |
| bot-3 | Keyboard |
| Kein Roboter | Gesangsharmonien, nur Audio |

Die Bühne zeigt genau drei Roboter. Alle vier Pad-Bereiche, Akkorde und vorhandenen Song-Dateien bleiben nutzbar. Die Zuordnung steht in `public/robots.js`; dort kann ein Bot auch mehrere Musikrollen bekommen. Der Server begrenzt Bewegungstrigger und Ablaufzeiten pro Bot, damit verschiedene Rollen auf demselben Gerät keine veralteten Bewegungen starten. Eine Rolle ohne Zuordnung erscheint nur im gemeinsamen Signalstream und wird an keinen Bot gestreamt.

## Einen Song bauen

1. **Beispiel-Song** lädt und startet einen Zweitakt-Loop mit Cm → Ab → Eb → Bb. Die Audiovorschau wird dabei eingeschaltet. Ein bestehender Song lässt sich mit **Rückgängig** zurückholen.
2. Für einen eigenen Song **Alle Spuren leeren**, Tempo und 1/2/4/8 Takte auswählen. Das Tempo lässt sich im Stopp ändern.
3. Optional **Klick an**, dann **Aufnehmen** drücken und Pads spielen. Die Uhr startet sofort, ohne separaten Vorzähler. Maus, Touch und USB-Launchpad verwenden denselben Aufnahmeweg.
4. Pads loslassen, damit ihre Länge übernommen wird. Start und Ende werden auf das nächste 16tel-Raster gerundet. Die Aufnahme läuft über Loop-Grenzen weiter; neue Durchgänge ergänzen vorhandene Noten als Overdub. Dieselbe Pad-/Schritt-Kombination wird ersetzt.
5. **Aufnahme beenden** lässt den Loop weiterspielen. Für eine weitere Schicht erneut **Aufnehmen** drücken.
6. Rollennamen schalten Loop-Spuren stumm. **×** leert eine einzelne Spur. **Rückgängig** tauscht zwischen dem Stand vor und nach der letzten Aufnahme/Löschaktion.
7. **Song speichern** exportiert eine wieder ladbare JSON-Datei. Der letzte Stand wird zusätzlich lokal im Browser gespeichert. **Song laden** ersetzt den aktuellen Song nach Prüfung; Wiedergabe startet erst mit **Loop starten**.

Die drei melodischen Quadranten bieten dieselbe Akkordpalette: Cm, Ab, Eb, Bb, Fm, Gm sowie Septakkorde, Bbadd9 und Csus2. Die beiden untersten Reihen sind einfache Dreiklänge, die oberen Reihen enthalten Erweiterungen. Die Notation folgt internationalen Akkordnamen (Bb = deutsches B).

Der Looper verwendet 4/4 und 16tel mit maximal 512 Pad-Ereignissen. Die Dauer melodischer Loop-Noten folgt der aufgenommenen Haltedauer, maximal einer Loop-Länge. Schlagzeug klingt unabhängig von der Haltedauer als kurzer Schlag aus. Der Synthesizer begrenzt gleichzeitige Stimmen. Das ist ein Loop-Skizzenbuch; es gibt noch keine mehrteilige Arrangement-Zeitleiste oder WAV-/MP3-Aufnahme. **Song speichern** speichert Noten, Tempo, Länge und Mutes; **Signale exportieren** speichert die separate Roboter-Diagnose.

Die Wiedergabe plant Audio mit kurzem Vorlauf auf der AudioContext-Uhr. Benutzeroberfläche und Roboter-HTTP-Kommandos folgen zur Spielzeit, sind aber keine harte Echtzeitsteuerung. Beim Verlassen des Tabs, Fokusverlust, USB-Abbruch oder Software-Stopp endet der Transport; aufgenommene Noten bleiben erhalten. Nur eine Controller-Seite gleichzeitig verwenden.

## Starten

Node.js 22 oder neuer; keine zusätzlichen Pakete, kein npm install erforderlich.

```powershell
npm.cmd start
```

Danach http://127.0.0.1:3210 in Chrome oder Edge öffnen. npm.cmd funktioniert auch bei gesperrten PowerShell-Skripten. In anderen Shells funktioniert npm start. Anderer Port: vor dem Start die Umgebungsvariable PORT setzen.

1. Pads per Maus, Touch oder mit Tab und Leertaste spielen.
2. Über **Ton einschalten** den Demo-Synthesizer aktivieren. Gesang ist ein synthetischer Ton, keine Gesangsaufnahme.
3. BPM und Simulator-Anschlag einstellen. MIDI-Eingaben verwenden die Anschlagstärke des Geräts.
4. **Beispiel-Song** spielt alle Rollen. **Alles stoppen** oder Escape beendet Transport, Ton und Demo-Bewegungen.
5. Rechts erscheinen Signal und Bridge-Empfangsbestätigung. **Signale exportieren** speichert die letzten maximal 2000 empfangenen Pad-Ereignisse plus Software-Stopps aus dem Arbeitsspeicher dieser Seite. Dieser Diagnoseexport ist kein Wiedergabeformat; dafür **Song speichern** verwenden.

## Launchpad X per USB

- **Launchpad starten** fordert Browser-MIDI inklusive SysEx an, wählt bevorzugt die zweite Launchpad-X-Schnittstelle und aktiviert den Programmer-Modus samt LEDs. Bei verweigertem SysEx wird ein normaler MIDI-Zugriff versucht.
- Eingangs- und Ausgangsport können manuell gewählt werden. Auf dem angeschlossenen Windows-System heißen die Eingänge LPX MIDI und MIDIIN2 (LPX MIDI); die zweite Schnittstelle wird bevorzugt. **Programmer-Modus aktivieren** wiederholt den Moduswechsel bei Bedarf.
- Die MIDI-Diagnose zählt alle Pakete und zeigt die letzten Bytes, auch bei ignorierten Noten oder Randtasten. 0 Pakete deutet auf fehlenden Eingang hin; Noten außerhalb des Pad-Rasters auf einen anderen Modus. Ein Rücklesebefehl prüft den Modus; nur ein empfangener Rücklesewert wird als Gerätebestätigung angezeigt.
- Alternativ den Programmer-Modus am Gerät manuell einstellen. Andere Layouts passen nicht zur festen Demo-Pad-Zuordnung.
- **Trennen / Live-Modus** löscht die Demo-LEDs und sendet den Live-Modus-Schalter. Nach USB-Verlust oder Browserabbruch den Modus gegebenenfalls am Gerät wiederherstellen beziehungsweise neu verbinden.
- Es wird genau ein ausgewählter Eingang gelesen. Poly-Pressure, Kanal-Aftertouch, Randtasten und MIDI-Clock lösen keine Bewegungen aus. Tempo wird manuell gesetzt.

USB-Hardware und K1 wurden hier nicht getestet. Web MIDI benötigt einen unterstützten Browser und einen sicheren Kontext; localhost wird dafür genutzt. Die Browseroberfläche verwendet keine externen Bibliotheken oder Assets.

## Rollen und Reaktion

| Bereich | Rolle | Reaktion |
| --- | --- | --- |
| Oben links | Schlagzeug | Kick, Snare, Hi-Hat, Tom oder Becken |
| Oben rechts | Gitarre | Akkord mit Anschlag nach Tonbereich |
| Unten links | Keyboard | Akkord mit tiefem, mittlerem oder hohem Tastenbereich |
| Unten rechts | Gesang | Synthetischer Harmonie-Akkord und Gesangsgeste |

Die Programmer-Pad-Adresse ist nicht die klingende Tonhöhe. Links unten ist Adresse 11, rechts oben 88. Die unterste Reihe eines melodischen Quadranten enthält Cm, Ab, Eb und Bb. Velocity bestimmt Intensität, BPM die Bewegungsdauer. Der Server begrenzt Bewegungstrigger pro Bot auf einen alle 120 ms. Zusätzliche Akkorde und Schläge bleiben hörbar und werden aufgenommen; nur ihre Bewegung kann verworfen werden. Die Bewegungsvorschau zeigt Gesten, keine K1-Gelenkstellungen.

## Signal-Bridge und virtueller Bot

In einem zweiten Terminal im Repository:

```powershell
npm.cmd run robot -- bot-3
```

Der Mock empfängt die Signale für Bot 3 und druckt sie aus. Er steuert keine Hardware. Gültige Ziele sind bot-1, bot-2, bot-3. Die bisherigen Namen drums, guitar und keyboard funktionieren als Aliase für den jeweils zugeordneten Bot; Gesang hat vorläufig keinen eigenen Bot.

| Route | Zweck |
| --- | --- |
| GET /api/status | Simulationsmodus, drei Bots und vier Musikrollen mit Zuordnung |
| POST /api/command | Pad-Ereignis an die Bridge |
| POST /api/stop | JSON {}: Software-Stopp der drei Bots |
| GET /api/robots/bot-3/events | Physischer Bot-Stream ohne Wiederholung alter Ereignisse |
| GET /api/events | Letzte 200 Bridge-Ereignisse inklusive TTL-Stopps |
| GET /api/stream | Gemeinsamer Browser-SSE-Stream für alle Rollen; eine Verbindung pro Seite |

Eingabe für POST /api/command:

```json
{"note":11,"velocity":100,"bpm":120,"type":"on","source":"simulator"}
```

Erlaubte Eingabetypen sind on/off, Quellen simulator/launchpad/demo/loop. Der Server bestimmt Rolle, Akkord, Tonhöhen und Animation aus der Pad-Adresse selbst. Beispiel eines empfangenen Signals:

```json
{
  "schema_version": 1,
  "type": "trigger",
  "scope": "role",
  "robot": "keyboard",
  "role": "keyboard",
  "robot_id": "bot-3",
  "animation": "keys_low",
  "pad_note": 11,
  "pitch": 48,
  "chord": "Cm",
  "pitches": [48, 51, 55],
  "velocity": 100,
  "intensity": 0.787,
  "bpm": 120,
  "duration_ms": 500,
  "timestamp_ms": 1790000000000,
  "source": "simulator",
  "sequence": 1,
  "received_at": "2026-10-28T12:00:00.000Z"
}
```

Server-Zeitstempel sind Unix-Millisekunden; die Vorschau vor dem Senden verwendet relative Sitzungszeit.

`role` benennt die musikalische Rolle, `robot_id` das physische Ziel oder null bei reinen Audiospuren. Das bisherige Feld `robot` bleibt als Alias für die musikalische Rolle erhalten, damit der Synthesizer und ältere Diagnosedaten weiter funktionieren. Adapter verwenden `robot_id`. Die Serverbestätigung hat bei Audiospuren ohne Bot `delivery: "audio_only"`.

Bewegungen sind einmalige Gesten mit Ablaufzeit. Neue Trigger ersetzen laufende Gesten desselben Bots. **release mit scope pad** beendet nur die angegebene Pad-Note; ein Adapter darf daraus keinen globalen Bot-Stopp ableiten. Nach der Dauer folgt ein stop mit Grund expired, auch wenn das Pad schon losgelassen wurde. So beeinflusst das Loslassen eines Akkordtons keine neuere Geste. Ein echter Adapter muss Ablaufzeiten und Verbindungsüberwachung zusätzlich selbst durchsetzen.

Die Bridge bindet nur an 127.0.0.1. Andere Rechner und Roboter können sie in dieser Demo nicht übers Netzwerk erreichen. Ein künftiger lokaler K1-Adapter konsumiert den Rollenstream und übersetzt die Animationen in SDK-Aufrufe. Noch keine K1-Anbindung, Gelenkregelung, Lautsprecherausgabe am Bot oder Bestätigung physischer Bewegung. **Bridge empfangen** bestätigt nur den Server. **Alles stoppen ist kein Hardware-Not-Aus.** Nur eine Controller-Seite gleichzeitig verwenden; Stopps gelten für die gesamte lokale Demo.

## Dateien und Tests

- public/engine.js: gemeinsame Pad-Zuordnung und MIDI-Dekodierung.
- public/robots.js: genau drei physische Bots und davon unabhängige Musikrollen-Zuordnung.
- public/looper.js, transport.js: Aufnahme-/Song-Datenmodell und Planung auf der Audio-Uhr.
- public/starter-song.js: ladbarer Beispiel-Song.
- public/app.js, audio.js, style.css, index.html: Simulator, MIDI/LED-Verbindung, lokale Töne und Bewegungsvorschau.
- src/server.js: lokaler HTTP-Server, Validierung, Begrenzung und Rollenstreams.
- src/mock-robot.js: Beispiel eines Rollenempfängers.
- test/: Engine- und HTTP/SSE-Integrationstests.

```powershell
npm.cmd test
```

Die alte MIDI-Dateipipeline wurde entfernt; ihr Stand bleibt im Git-Basiscommit erhalten.

Protokollgrundlage: [Novation MIDI](https://userguides.novationmusic.com/hc/en-gb/articles/24001489325330-MIDI-on-Launchpad-X), [Novation Surface Control](https://userguides.novationmusic.com/hc/en-gb/articles/24001475492498-Controlling-the-Launchpad-X-surface), [Web MIDI](https://www.w3.org/TR/webmidi/).
