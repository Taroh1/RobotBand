param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outRoot = Join-Path $projectRoot 'out'
New-Item -ItemType Directory -Path $outRoot -Force | Out-Null
$base = 'http://127.0.0.1:3210'
$status = $null
try { $status = Invoke-RestMethod "$base/api/status" -TimeoutSec 2 } catch {}
if (!$status) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { 'C:/Program Files/nodejs/node.exe' }
    if (!(Test-Path -LiteralPath $nodePath)) { throw 'Node.js fehlt. Zuerst den Laptop-Installer ausfuehren.' }
    $serverPath = Join-Path $projectRoot 'src/server.js'
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outRoot 'website.log') -RedirectStandardError (Join-Path $outRoot 'website-errors.log') -PassThru
    [IO.File]::WriteAllText((Join-Path $outRoot 'website.pid'), [string]$serverProcess.Id)
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { $status = Invoke-RestMethod "$base/api/status" -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 150 }
    }
}
if (!$status -or $status.service -ne 'robot-band' -or $null -eq $status.simrobot) {
    throw 'Port 3210 ist nicht mit der aktuellen Robot-Band-Bridge erreichbar. Alte Serverinstanz schliessen; siehe out/website-errors.log.'
}
$existingBand = Get-Process -Name SimRobot -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'RobotBand - SimRobot' }
if (!$existingBand) {
    & (Join-Path $PSScriptRoot 'bhuman.ps1') -Action Run -Scene Band
}
if (!$NoBrowser) { Start-Process $base }
Write-Host 'Robot Band: Website und SimRobot bereit. Im Simulator ist Live standardmaessig aktiv.'
