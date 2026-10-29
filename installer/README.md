# Robot Band / B-Human: Laptop-Installer

Für **Windows 11 x64** mit Internetzugang und Administratorrechten.
Der Installer lädt mehrere GB Entwicklungswerkzeuge. Empfohlen sind 25 GB
freier Platz. Windows ARM wird von diesem Paket nicht unterstützt.

## Auf dem Laptop

1. Das komplette `RobotBand-Laptop-0.4.0.zip` in einen normalen Ordner entpacken.
2. **Setup.cmd** doppelt anklicken und die Windows-Administratorabfrage selbst
   bestätigen. Das Setup nicht innerhalb der ZIP-Datei starten.
3. Downloads, Installation, Kompilierung und Tests abwarten. Ein erforderlicher
   Windows-Neustart wird nicht automatisch ausgelöst: neu starten und danach
   dieselbe **Setup.cmd** erneut ausführen.
4. Nach erfolgreichem Abschluss auf dem Desktop **Robot Band** starten.
   Das öffnet Website und Simulator. SimRobot startet im **Live-Modus**.
5. Auf der Webseite Pads per Maus testen oder das Launchpad X verbinden.
   **Beispiel-Song** spielt einen Loop und steuert die simulierte Band.
   **Alles stoppen** beendet die Bewegungen.

Standardziel: `%USERPROFILE%\RobotBand-Lab`. Bestehende andere Projekte werden
nicht überschrieben. Beim erneuten Setup werden bereits kopierte Projektdateien
erhalten und die restlichen Installations- und Buildschritte erneut geprüft.
Für ein Update mit einem neueren Paket einen neuen Zielordner wählen oder die
eigenen Änderungen vorher bewusst übertragen.

Das Protokoll liegt als `install.log` im Zielordner. Bei einem Fehler bleibt
die Installation unvollständig; erst nach erfolgreichen Tests steht dort
`complete: true` in `.robotband-install.json`.

Alternativer Zielordner oder nur Windows-Simulator ohne WSL:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Setup-RobotBand.ps1 -Destination C:\RobotBand-Lab
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Setup-RobotBand.ps1 -DesktopOnly
```

## Was eingerichtet wird

- Git, Node.js ab Version 24, separates CMake 4.2.x.
- Visual Studio Community 2026 mit C++-Desktopwerkzeugen, ATL und Windows-SDK.
- VS Code mit den B-Human-Erweiterungen für C++, Tests und Rechtschreibung.
- Der aktuelle mitgelieferte RobotBand-Quellstand einschließlich Band-Szene und
  nativer Live-Bridge; er benötigt keinen bereits aktualisierten GitHub-Stand.
- Das vollständige offizielle B-Human-Repository mit allen Submodulen,
  festgelegt auf Commit `2e3374ba896da8288607f9a1881b876642fe18b8`.
- ONNX Runtime 1.22.0 sowie der selbst gebaute Windows-Simulator und die
  Band-Bridge. Die native Bridge wird gegen den echten Node-Server getestet.
- Standardmäßig Ubuntu 24.04 mit Linux-Buildwerkzeugen und den drei
  Konfigurationen Debug, Develop und Release für den Booster-Cross-Build.
- Desktop-Verknüpfungen **Robot Band** und **B-Human Entwicklung**.

Eine vorhandene Ubuntu-24.04-Installation wird wiederverwendet. Ihre WSL-Version
und der Standardbenutzer bleiben erhalten. Für die originalen B-Human-Windows-
Buildaufgaben wird dieses Ubuntu als WSL-Standarddistribution ausgewählt.
Die offizielle Anleitung empfiehlt WSL1; dieses Paket unterstützt auch das
bereits verwendete WSL2, dessen Windows-Dateizugriff langsamer sein kann.

Der Installer konfiguriert den Cross-Build, führt aber keine Installation,
Firmwareänderung oder Bewegung auf physischen Robotern aus. Für echte K1 sind
Firmwarestand, Netzwerk, Kalibrierung und ein Hardwareadapter getrennt nötig.

## Entwicklungsarbeit und Tests

**B-Human Entwicklung** öffnet den originalen Windows-Workspace. Für die
Band-Bridge den RobotBand-Lab-Ordner in VS Code öffnen und **K1: Robot Band**
auswählen. Die ursprüngliche Fußballsimulation bleibt über
**K1: SimRobot (Develop)** verfügbar.

```powershell
cd $env:USERPROFILE\RobotBand-Lab
npm.cmd test
```

Das ZIP enthält keine Zugangsdaten, Schlüssel, Codex-Verläufe, `.git`-Daten oder
rechnerspezifischen Buildausgaben. B-Human wird aus seiner offiziellen Quelle
geladen. Vor dem Kopieren überprüft das Setup alle enthaltenen Quelldateien
gegen `SHA256SUMS.json`.

## Paket neu erzeugen

Im ursprünglichen RobotBand-Projekt:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/Build-LaptopPackage.ps1
```

Die ZIP und ihre SHA256-Prüfsumme liegen danach in `out/dist/`.

Quellen: [B-Human Initial Setup](https://docs.b-human.de/master/getting-started/initial-setup/),
[Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).
