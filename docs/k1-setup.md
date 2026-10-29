# Booster K1: PC und SimRobot

Diese Einrichtung verwendet den B-Human Code Release 2026 als eigenständige
C++-Umgebung neben dem Robot-Band-Webstudio.

## Starten

Für die eigene Bühne mit drei K1 in VS Code **K1: Robot Band** auswählen.
Details und Steuerung: [Robot-Band-Szene](../simulations/robot-band/README.md).

In VS Code unter **Ausführen und Debuggen** die Konfiguration
**K1: SimRobot (Develop)** auswählen und F5 drücken. Das baut den Simulator
und öffnet `Config/Scenes/K1/RobotFast.ros3`.

Alternativ im Projektordner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/bhuman.ps1 -Action Build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/bhuman.ps1 -Action Run
```

Die Ausführungsrichtlinie gilt nur für diesen PowerShell-Prozess.

In SimRobot **RoboCup** doppelt anklicken, um die 3D-Ansicht zu öffnen.
**Console** öffnet die Meldungen und Eingabe für Simulatorbefehle.
`RobotFast` ist die mitgelieferte K1-Szene für einen einzelnen simulierten
aktiven Roboter und mehrere Dummies mit vereinfachter Wahrnehmung. Die normale Szene `K1/Robot.ros3`
kann über File > Open geöffnet werden.

Für C++-Arbeit mit den vollständigen B-Human-Konfigurationen den mitgelieferten
Workspace `external/BHumanCodeRelease/Make/Windows/B-Human.code-workspace`
öffnen und die Konfiguration **Windows/x86 SimRobot Develop** auswählen.

## Werkzeuge und Quellcode

- Windows 11 x64.
- Visual Studio Community 2026, ausgewählt über winget 18.4.3, mit
  Desktop-C++, MSVC x64/x86, ATL und Windows 11 SDK 26100.
- Separates CMake 4.2.3.
- VS-Code-Erweiterungen `ms-vscode.cpptools`,
  `matepek.vscode-catch2-test-adapter` und
  `streetsidesoftware.code-spell-checker`.
- Vorhandenes Ubuntu 24.04 unter WSL2 mit astyle, ccache, clang, cmake,
  llvm, mold, net-tools, ninja-build, rsync, unzip und curl.
- Offizielles Repository mit allen drei Submodulen unter
  `external/BHumanCodeRelease`, Stand
  `2e3374ba896da8288607f9a1881b876642fe18b8`.
- ONNX Runtime 1.22.0 für Windows wird vom Projekthelfer aus dem offiziellen
  Microsoft-Release geladen. Qt und die weiteren Simulatorbibliotheken
  werden mit dem B-Human-Repository geliefert.

`external/` und `out/` sind vom RobotBand-Git ausgeschlossen. Der Quellcode
unter `external/BHumanCodeRelease` besitzt sein eigenes Git-Repository.
Es wurden keine Git-Hooks installiert.

Geprüft am 29.10.2026: CMake-Konfiguration und vollständiger Develop-Build des
Targets `SimRobot` erfolgreich; `K1/RobotFast.ros3` geöffnet, 3D-Ansicht sichtbar,
Simulation mit 500 Schritten/s aktiv und keine Startfehler in der geöffneten
Konsole. PowerShell-Syntax, VS-Code-JSON und `git diff --check` ebenfalls geprüft.

## Auf einem weiteren Windows-PC vorbereiten

Die Entwicklungswerkzeuge installieren:

```powershell
winget install --id Microsoft.VisualStudio.Community --exact --source winget --version 18.4.3 --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.ATL --add Microsoft.VisualStudio.Component.Windows11SDK.26100"
winget install --id Kitware.CMake --exact --source winget --version 4.2.3
code --install-extension ms-vscode.cpptools --install-extension matepek.vscode-catch2-test-adapter --install-extension streetsidesoftware.code-spell-checker
```

Im RobotBand-Projekt den Quellcode mit Submodulen laden:

```powershell
git clone --recursive https://github.com/bhuman/BHumanCodeRelease.git external/BHumanCodeRelease
git -C external/BHumanCodeRelease checkout 2e3374ba896da8288607f9a1881b876642fe18b8
git -C external/BHumanCodeRelease submodule update --init --recursive
```

Danach die Build- und Startbefehle oben ausführen. VS Code nach der Installation
neu starten, damit es neue Erweiterungen und den aktualisierten PATH übernimmt.

## Umfang und spätere Roboteranbindung

Die offizielle Windows-Anleitung empfiehlt für den vollständigen Workflow
Ubuntu 24.04 als WSL1 mit root als Standardbenutzer. Hier bleibt das vorhandene
Ubuntu als WSL2 mit seinem bisherigen Standardbenutzer erhalten. Der Helfer
konfiguriert gezielt den nativen Windows-Simulator. Zusätzlich wurden mit
`installer/Setup-Wsl.ps1` die Linux-Buildwerkzeuge, die Booster-Laufzeit und
die drei Cross-Build-Konfigurationen Debug, Develop und Release vorbereitet.

Die Firmware-, Netzwerk- und Deployment-Einrichtung echter K1-Roboter ist ein
eigener nächster Schritt. B-Human dokumentiert Firmware 1.7.1 als getestete
Basis. Die Band-Bridge steuert jetzt die eigene SimRobot-Szene live. Der
Mock-Empfänger bleibt als Diagnosewerkzeug erhalten. Ein Adapter zu physischen
K1-Robotern bzw. deren SDK ist weiterhin nicht eingerichtet.

Komplettes übertragbares Laptop-Setup: [Installer-Anleitung](../installer/README.md).

Quellen: [Initial Setup](https://docs.b-human.de/master/getting-started/initial-setup/),
[SimRobot](https://docs.b-human.de/master/getting-started/working-with-simrobot/),
[Roboter einrichten](https://docs.b-human.de/master/getting-started/setting-up-robot/).
