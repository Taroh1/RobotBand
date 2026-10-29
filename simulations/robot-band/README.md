# Robot Band in SimRobot

Eigene K1-Bandbühne mit drei Robotern, Schlagzeug, Gitarre, Keyboard,
Lautsprechern, Monitoren und Lichttraverse. Die Zuordnung entspricht dem
Band-Studio: bot-1 Schlagzeug, bot-2 Gitarre, bot-3 Keyboard.

## Starten

In VS Code **K1: Robot Band** auswählen und F5 drücken. Oder im Projektordner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/bhuman.ps1 -Action Build -Scene Band
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/bhuman.ps1 -Action Run -Scene Band
```

Website und Szene gemeinsam starten: `npm.cmd run band` oder
`tools/start-band.cmd`. Die Szene und die **Bandsteuerung** öffnen automatisch.
**Live von Launchpad-Webseite** ist standardmäßig aktiv. Im Panel erscheint
**Website verbunden**, sobald die lokale Bridge erreichbar ist. Auf der
Website erscheint **SimRobot verbunden** (Statusaktualisierung alle 5 Sekunden).

Spiele Pads mit Maus oder USB-Launchpad oder starte den **Beispiel-Song**.
Die drei K1 erhalten die zur Rolle gehörenden Gesten, mit Anschlagstärke und
Dauer aus dem Ereignis. Audio bleibt im Browser. **Alles stoppen** auf der
Website stoppt die Bewegungen; auslaufende Gesten enden auch ohne Release.
Ein einzelnes Pad-Release beendet keine andere laufende Geste desselben Bots.

**Live pausieren** sperrt Bewegungen im Simulator, ohne die Website zu stoppen.
Die Rollenschalter schalten einzelne Figuren ruhig. SimRobots Start/Pause
hält die gesamte Simulation an; inzwischen abgelaufene Signale werden beim
Fortsetzen verworfen. Bei Serververlust gehen die Figuren in Ruhe; die
Verbindung wird automatisch ohne Wiederholung alter Ereignisse aufgebaut.

Wenn du **Live von Launchpad-Webseite** ausschaltest, läuft die eigenständige
Demo mit 40 bis 240 BPM und der Beispielakkordfolge Cm → Ab → Eb → Bb.

## Was die Demo zeigt

Die originalen K1-Modelle bewegen ihre Gelenke im SimRobot-Puppet-Modus:
abwechselnde Trommelschläge, Gitarrenanschläge und Keyboardgesten. Die
Körperpositionen sind fixiert, Schwerkraft und Kollisionen der Figuren sind
deaktiviert. Diese Umgebung ist eine animierte Vorschau für die Band-Idee;
sie prüft weder Gleichgewicht noch echte Instrumentkontakte und ist kein
Programm für physische K1-Roboter.

Audio, Launchpad-Eingaben und Loop-Aufnahme bleiben im vorhandenen
Webstudio. Die native Bridge empfängt dessen `/api/stream` über Windows
WinHTTP auf einem Hintergrundthread. Sie benötigt keinen zusätzlichen
Relay-Prozess. Der Server sendet jede Sekunde einen Heartbeat; ausgelaufene
Signale werden anhand ihres Zeitstempels verworfen. Maximal 128 Ereignisse
werden gepuffert. Beim Verbindungswechsel wird der Puffer geleert.

Für einen anderen lokalen Website-Port vor dem Simulatorstart
`$env:ROBOTBAND_BRIDGE_PORT = '3215'` setzen und den Server entsprechend mit
`$env:PORT = '3215'` starten. Die Bridge bleibt auf `127.0.0.1` beschränkt.

Das Tempo folgt einer monotonen Echtzeituhr und bleibt von der langsameren
Simulationsuhr unter Windows unabhängig. Die Objektliste lässt sich über
**Scene Graph** in der Toolbar ausblenden, um mehr Platz für die Bühne zu haben.

## Bearbeiten

- `RobotBandController.cpp`: Gesten, Tempo, Panel und Startkamera.
- `BandBridge.h/.cpp`: nativer SSE-Empfänger, Validierung und Gestenlaufzeiten.
- `BridgeProbe.cpp`: Integrationstest desselben nativen Empfängers ohne GUI.
- `generate-scene.mjs`: Maße und Positionen von Bühne und Instrumenten;
  `node simulations/robot-band/generate-scene.mjs` regeneriert die Szene.
- `RobotBand.ros3`: generierte, direkt in SimRobot ladbare Szene.
- `assets/`: Bühnenschilder. `create-signs.py` erzeugt sie mit Pillow neu.
- `CMakeLists.txt`: eigenständiger Plugin-Build gegen die vorhandenen
  SimRobot- und Qt-Schnittstellen; der B-Human-Quellcode wird nicht geändert.

Vor Änderungen am Controller die Band-Simulation schließen, damit Windows
die Plugin-DLL zum Neubauen freigibt. Alle Band-Quelldateien und Schilder
liegen im RobotBand-Repository; `external/` und `out/` bleiben lokale
Abhängigkeiten bzw. Buildausgaben.

Voraussetzungen und Basisinstallation: [K1-Einrichtung](../../docs/k1-setup.md).

Geprüft am 29.10.2026: Plugin-Build erfolgreich, Szene ohne Ladefehler geöffnet,
alle drei K1 in der 3D-Ansicht sichtbar, Demo-Pause mit unverändertem Beat und
Tempowechsel von 120 auf 90 BPM geprüft. Anschließend mit 120 BPM neu geöffnet.
Szenen-XML, Zuordnung bot-1/2/3, VS-Code-Konfigurationen und PowerShell-Syntax geprüft.

Live-Bridge: nativer Test gegen den echten Node-Server für alle drei Rollen,
fremde Pad-Releases, Ablaufzeiten, Stop-All, Verbindungsabbruch und erneutes
Verbinden nach Serverneustart erfolgreich. Insgesamt 83 Projekttests grün.
