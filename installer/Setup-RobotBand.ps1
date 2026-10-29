param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'RobotBand-Lab'),
    [switch]$DesktopOnly,
    [switch]$CheckOnly,
    [switch]$VerifyPackage
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$bhumanCommit = '2e3374ba896da8288607f9a1881b876642fe18b8'
$payloadRoot = Join-Path $PSScriptRoot 'payload'
$vswherePath = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { throw "$Program fehlgeschlagen (Exit $LASTEXITCODE)." }
}
function Install-Package {
    param([string]$Id, [string]$Version = '', [string]$Override = '')
    $wingetArguments = @('install','--id',$Id,'--exact','--source','winget','--accept-package-agreements','--accept-source-agreements','--silent','--disable-interactivity')
    if ($Version) { $wingetArguments += @('--version',$Version) }
    if ($Override) { $wingetArguments += @('--override',$Override) }
    Invoke-Checked -Program 'winget.exe' -Arguments $wingetArguments
    Refresh-Path
}
function Find-CppToolchain {
    if (Test-Path -LiteralPath $vswherePath) {
        return (& $vswherePath -latest -version '[18.0,19.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATL Microsoft.VisualStudio.Component.Windows11SDK.26100 -property installationPath)
    }
}
function Get-Report {
    [pscustomobject]@{
        Windows = [Environment]::OSVersion.Version.ToString()
        Git = [bool](Get-Command git.exe -ErrorAction SilentlyContinue)
        Node = [bool](Get-Command node.exe -ErrorAction SilentlyContinue)
        CMake = (Test-Path -LiteralPath 'C:/Program Files/CMake/bin/cmake.exe')
        CppToolchain = [string](Find-CppToolchain)
        Winget = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
        Destination = $Destination
        BHumanCommit = $bhumanCommit
        PayloadPresent = (Test-Path -LiteralPath (Join-Path $payloadRoot 'package.json'))
    }
}
function Assert-PayloadIntegrity {
    $manifestPath = Join-Path $PSScriptRoot 'SHA256SUMS.json'
    if (!(Test-Path -LiteralPath $manifestPath)) { throw 'SHA256SUMS.json fehlt. Das vollstaendige Installer-ZIP entpacken.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $payloadPrefix = [IO.Path]::GetFullPath($payloadRoot).TrimEnd('\') + '\'
    $count = 0
    foreach ($entry in $manifest.PSObject.Properties) {
        $filePath = [IO.Path]::GetFullPath((Join-Path $payloadRoot $entry.Name))
        if (!$filePath.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ungueltiger Paketpfad.' }
        if (!(Test-Path -LiteralPath $filePath) -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) {
            throw "Paketdatei fehlt oder ist beschaedigt: $($entry.Name). ZIP erneut vollstaendig entpacken."
        }
        $count++
    }
    if ($count -lt 20) { throw 'Paketmanifest unvollstaendig.' }
    Write-Host "Paketintegritaet OK: $count Dateien."
}
if ($CheckOnly) { Get-Report | ConvertTo-Json; exit 0 }
if ($VerifyPackage) { Assert-PayloadIntegrity; exit 0 }
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'Dieser Installer unterstuetzt Windows 11 x64, nicht Windows ARM.'
}
if ([Environment]::OSVersion.Version.Build -lt 22000) { throw 'Windows 11 x64 ist erforderlich.' }
if (!(Test-Path -LiteralPath (Join-Path $payloadRoot 'package.json'))) { throw 'payload fehlt. Das komplette ZIP zuerst entpacken.' }
Assert-PayloadIntegrity
if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Microsoft App Installer (winget) aus dem Microsoft Store installieren, dann Setup erneut starten.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $setupArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Destination "' + $Destination + '"'
    if ($DesktopOnly) { $setupArguments += ' -DesktopOnly' }
    # Visible because this is the interactive installer the user launched.
    $elevated = Start-Process powershell.exe -Verb RunAs -ArgumentList $setupArguments -WindowStyle Normal -PassThru -Wait
    exit $elevated.ExitCode
}

$Destination = [IO.Path]::GetFullPath($Destination)
$markerPath = Join-Path $Destination '.robotband-install.json'
if ((Test-Path -LiteralPath $Destination) -and !(Test-Path -LiteralPath $markerPath) -and (Get-ChildItem -LiteralPath $Destination -Force | Select-Object -First 1)) {
    throw 'Zielordner ist nicht leer. Anderen -Destination-Pfad waehlen. Bestehende Projekte werden nicht ueberschrieben.'
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$logPath = Join-Path $Destination 'install.log'
Start-Transcript -Path $logPath -Append
try {
    if (!(Test-Path -LiteralPath $markerPath)) {
        Get-ChildItem -LiteralPath $payloadRoot -Force | Copy-Item -Destination $Destination -Recurse -Force
        [IO.File]::WriteAllText($markerPath, (@{ created_at = [DateTime]::UtcNow.ToString('o'); bhuman_commit = $bhumanCommit; complete = $false } | ConvertTo-Json))
    }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    $marker.complete = $false
    [IO.File]::WriteAllText($markerPath, ($marker | ConvertTo-Json))
    Write-Host '1/7 Entwicklungswerkzeuge installieren'
    if (!(Get-Command git.exe -ErrorAction SilentlyContinue)) { Install-Package -Id 'Git.Git' }
    $nodeReady = $false
    if (Get-Command node.exe -ErrorAction SilentlyContinue) { $nodeReady = [int]((& node.exe --version).TrimStart('v').Split('.')[0]) -ge 24 }
    if (!$nodeReady) { Install-Package -Id 'OpenJS.NodeJS.LTS' }
    $cmakeReady = $false
    if (Get-Command cmake.exe -ErrorAction SilentlyContinue) {
        $cmakeVersion = [version](((& cmake.exe --version)[0] -replace '^cmake version ','').Trim())
        $cmakeReady = $cmakeVersion -ge [version]'4.2.0' -and $cmakeVersion.Major -eq 4
    }
    if (!$cmakeReady) { Install-Package -Id 'Kitware.CMake' -Version '4.2.3' }
    if (!(Find-CppToolchain)) {
        $existingVs = if (Test-Path -LiteralPath $vswherePath) { & $vswherePath -latest -version '[18.0,19.0)' -products '*' -property installationPath } else { $null }
        if ($existingVs) {
            $modifyArguments = 'modify --installPath "' + $existingVs + '" --quiet --norestart --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.ATL --add Microsoft.VisualStudio.Component.Windows11SDK.26100'
            $modified = Start-Process -FilePath 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/setup.exe' -ArgumentList $modifyArguments -WindowStyle Hidden -PassThru -Wait
            if ($modified.ExitCode -notin @(0,3010)) { throw "Visual-Studio-Aenderung fehlgeschlagen: $($modified.ExitCode)" }
        } else {
            Install-Package -Id 'Microsoft.VisualStudio.Community' -Version '18.4.3' -Override '--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.ATL --add Microsoft.VisualStudio.Component.Windows11SDK.26100'
        }
    }
    if (!(Find-CppToolchain)) { throw 'C++/ATL/SDK fehlen noch. Windows ggf. neu starten und Setup erneut ausfuehren.' }
    $codePath = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/bin/code.cmd'
    if (!(Get-Command code.cmd -ErrorAction SilentlyContinue) -and !(Test-Path -LiteralPath $codePath)) { Install-Package -Id 'Microsoft.VisualStudioCode' }

    Write-Host '2/7 B-Human mit allen Submodulen laden'
    $sourceRoot = Join-Path $Destination 'external/BHumanCodeRelease'
    if (!(Test-Path -LiteralPath (Join-Path $sourceRoot '.git'))) {
        Invoke-Checked -Program 'git.exe' -Arguments @('clone','--recursive','https://github.com/bhuman/BHumanCodeRelease.git',$sourceRoot)
        Invoke-Checked -Program 'git.exe' -Arguments @('-C',$sourceRoot,'checkout',$bhumanCommit)
    }
    $actualCommit = (& git.exe -C $sourceRoot rev-parse HEAD).Trim()
    if ($actualCommit -ne $bhumanCommit) { throw 'B-Human wurde lokal geaendert oder auf einen anderen Stand gesetzt. Setup ueberschreibt diesen Stand nicht.' }
    Invoke-Checked -Program 'git.exe' -Arguments @('-C',$sourceRoot,'submodule','update','--init','--recursive')

    Write-Host '3/7 VS-Code-Erweiterungen installieren'
    if (Get-Command code.cmd -ErrorAction SilentlyContinue) { $codePath = (Get-Command code.cmd).Source }
    Invoke-Checked -Program $codePath -Arguments @('--install-extension','ms-vscode.cpptools','--install-extension','matepek.vscode-catch2-test-adapter','--install-extension','streetsidesoftware.code-spell-checker')

    Write-Host '4/7 Windows-Simulator und Band-Bridge bauen'
    Invoke-Checked -Program 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Destination 'tools/bhuman.ps1'),'-Action','Build','-Scene','Band')

    if (!$DesktopOnly) {
        Write-Host '5/7 Ubuntu fuer den vollstaendigen B-Human-Cross-Build vorbereiten'
        Invoke-Checked -Program 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Destination 'installer/Setup-Wsl.ps1'),'-SourceRoot',$sourceRoot)
    } else { Write-Host '5/7 WSL nach -DesktopOnly uebersprungen' }

    Write-Host '6/7 Projekt und native Live-Bridge testen'
    Push-Location $Destination
    try { Invoke-Checked -Program 'node.exe' -Arguments @('--test','test/*.test.js') } finally { Pop-Location }

    Write-Host '7/7 Desktop-Verknuepfungen erstellen'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shellObject = New-Object -ComObject WScript.Shell
    $shortcut = $shellObject.CreateShortcut((Join-Path $desktop 'Robot Band.lnk'))
    $shortcut.TargetPath = Join-Path $Destination 'tools/start-band.cmd'
    $shortcut.WorkingDirectory = $Destination
    $shortcut.IconLocation = Join-Path $sourceRoot 'Build/Windows/SimRobot/Develop/SimRobot.exe'
    $shortcut.Save()
    $workspaceLink = $shellObject.CreateShortcut((Join-Path $desktop 'B-Human Entwicklung.lnk'))
    $workspaceLink.TargetPath = Join-Path $sourceRoot 'Make/Windows/B-Human.code-workspace'
    $workspaceLink.Save()
    [IO.File]::WriteAllText($markerPath, (@{ completed_at = [DateTime]::UtcNow.ToString('o'); bhuman_commit = $bhumanCommit; complete = $true; desktop_only = [bool]$DesktopOnly } | ConvertTo-Json))
    Write-Host "Fertig: $Destination`nDesktop: Robot Band oder B-Human Entwicklung.`nProtokoll: $logPath" -ForegroundColor Green
} catch {
    Write-Host "Installation nicht abgeschlossen: $($_.Exception.Message)`nSetup nach Beheben des Problems erneut starten. Vorhandene Projektdateien bleiben erhalten.`nProtokoll: $logPath" -ForegroundColor Red
    throw
} finally { Stop-Transcript }
