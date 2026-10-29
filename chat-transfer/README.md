# Diesen Codex-Chat per Git mitnehmen

`robotband-chat.enc.json` enthält einen **verschlüsselten Schnappschuss des sichtbaren Gesprächsverlaufs**. Die Chat-ID bleibt erhalten. Der Schlüssel gehört nicht ins Git-Repository und wird separat auf das zweite Gerät kopiert.

Das ist ein manuelles Übertragungswerkzeug für lokale Codex-Verläufe, **keine offizielle Synchronisierungsfunktion**. Es wurde mit der mitgelieferten Codex-Version `0.164.0-alpha.11.1` in einem getrennten Profil geprüft: 63 Nachrichten, 17 Runden, sämtliche Nachrichtentexte erkannt und `thread/resume` erfolgreich. Unterschiedliche Codex-Versionen können andere Speicherformate verwenden. Das Werkzeug prüft den Import mit der installierten Codex-Version und bricht bei einer unvollständigen Wiederherstellung ab.

## Auf dem zweiten Gerät

1. Node.js 24 und die Codex-Erweiterung installieren. Einmal mit dem eigenen Konto in Codex anmelden.
2. `Taroh1/RobotBand` klonen oder `git pull` ausführen.
3. Die Datei **robotband.chat-key** vom ersten Gerät separat übertragen, etwa per USB. Außerhalb des Repository-Ordners speichern. Schlüssel und Paket zusammen ermöglichen das Lesen des Verlaufs; der Schlüssel darf nicht mit eingecheckt werden.
4. VS Code, die ChatGPT/Codex-Desktop-App und laufende Codex-CLI-Sitzungen schließen.
5. Ein separates PowerShell-Fenster öffnen, in den Repository-Ordner wechseln und ausführen; den Schlüsselpfad anpassen:

```powershell
node --disable-warning=ExperimentalWarning tools/chat-transfer.mjs import --key-file "C:\Users\DEINNAME\Downloads\robotband.chat-key"
```

6. VS Code mit diesem Repository öffnen. In Codex die bisherigen Chats öffnen und **Roboter-Band-Idee testen** auswählen. Falls die Liste nach Projekt filtert, das aktuelle Repository auswählen oder alle Chats anzeigen.

Der Import setzt den Arbeitsordner auf dieses Repository. Er übernimmt die Berechtigungsstandards der Zielinstallation. Zugangsdaten, andere Chats, laufende Prozesse und Geräteverbindungen werden nicht übertragen. Gespeichert werden sichtbare Benutzer- und Assistentennachrichten; interne Laufzeit-/Modellzustände werden nicht identisch kopiert. Das ist ein fortsetzbarer Verlauf, kein bitidentisches Abbild einer laufenden Sitzung.

## Erst in einem Testprofil prüfen

Dieser Befehl verändert das echte Codex-Profil nicht und funktioniert auch bei geöffnetem VS Code:

```powershell
node --disable-warning=ExperimentalWarning tools/chat-transfer.mjs verify --key-file "C:\Users\DEINNAME\Downloads\robotband.chat-key"
```

Er erstellt ein eigenes temporäres Profil und kontrolliert Chat-ID, Nachrichtenanzahl, Nachrichtentexte und natives Resume. `native_resume: true` und identische Zahlen für `messages`/`native_messages` zeigen den erfolgreichen Test an. Es wird kein Modellturn gestartet.

## Später den neuesten Stand übertragen

Nach dem Arbeiten auf dem jeweiligen Gerät exportieren; denselben Schlüssel verwenden:

```powershell
node --disable-warning=ExperimentalWarning tools/chat-transfer.mjs export --key-file "C:\Users\DEINNAME\Downloads\robotband.chat-key"
git add chat-transfer/robotband-chat.enc.json
git commit -m "Update encrypted Codex chat snapshot"
git push
```

Der Export liest nur diese Chat-ID und schreibt weder die Quelldatenbank noch den aktiven Chat um. Erst abgeschlossene beziehungsweise bereits gespeicherte Inhalte sind im Schnappschuss verfügbar.

**Konflikte werden nicht automatisch zusammengeführt.** Wenn dieselbe Chat-ID auf dem Zielgerät schon existiert, stoppt der Import, um dort keinen neueren Verlauf zu überschreiben. Für wiederholtes Wechseln mit bereits vorhandenen Verläufen ist dieses Werkzeug deshalb noch kein beidseitiger Sync. Nicht auf beiden Geräten unabhängig denselben Chat weiterführen und danach eine automatische Zusammenführung erwarten.

Bei einem fehlgeschlagenen Import bleiben andere Chats unverändert. Das Werkzeug entfernt seinen neu angelegten Verlauf, wenn die native Inhaltsprüfung fehlschlägt. Import-Metadaten stehen im Zielprofil unter `chat-transfer-backups/`; sie enthalten keine Kopie anderer Gespräche.

Verschlüsselung: zufälliger 256-Bit-Schlüssel, AES-256-GCM mit frischem Nonce und authentifiziertem Format, gzip vor der Verschlüsselung. Die Schlüsseldatei liegt separat; das Repository enthält ausschließlich das verschlüsselte Archiv und die Werkzeuge.

Protokollgrundlage: [OpenAI App Server](https://learn.chatgpt.com/docs/app-server), [Lokale Codex-Sitzungen fortsetzen](https://learn.chatgpt.com/docs/cli/reference#codex-resume).
