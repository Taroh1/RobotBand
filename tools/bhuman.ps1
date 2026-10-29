param(
    [ValidateSet('Configure', 'Build', 'Run')]
    [string]$Action = 'Run',
    [ValidateSet('Debug', 'Develop', 'Release')]
    [string]$Configuration = 'Develop',
    [ValidateSet('K1', 'Band')]
    [string]$Scene = 'K1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'external/BHumanCodeRelease'
$buildRoot = Join-Path $sourceRoot 'Build/Windows/CMake'
$cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
$cmakePath = if ($cmakeCommand) { $cmakeCommand.Source } else { 'C:/Program Files/CMake/bin/cmake.exe' }
if (!(Test-Path -LiteralPath $cmakePath)) { throw 'CMake fehlt. Siehe docs/k1-setup.md.' }
if (!(Test-Path -LiteralPath (Join-Path $sourceRoot 'Util/SimRobot/Make/CMake/SimRobot.cmake'))) {
    throw 'B-Human oder seine Submodule fehlen. Siehe docs/k1-setup.md.'
}

function Invoke-CMake {
    param([string[]]$CMakeArguments)
    & $cmakePath @CMakeArguments
    if ($LASTEXITCODE -ne 0) { throw "CMake fehlgeschlagen (Exit $LASTEXITCODE)." }
}

function Initialize-Simulator {
    # Same runtime version as the upstream downloader; only the Windows target
    # is needed for this simulator. Do not configure the robot cross-compiler.
    $runtimeVersion = '1.22.0'
    $runtimeRoot = Join-Path $sourceRoot 'Util/onnxruntime/lib/Windows'
    $versionFile = Join-Path $runtimeRoot 'installed_version'
    $installedVersion = if (Test-Path -LiteralPath $versionFile) { (Get-Content -LiteralPath $versionFile -Raw).Trim() } else { '' }
    if ($installedVersion -ne $runtimeVersion -or !(Test-Path -LiteralPath (Join-Path $runtimeRoot 'onnxruntime.dll'))) {
        $downloadRoot = Join-Path $projectRoot 'out/bhuman-downloads'
        New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
        $archiveName = "onnxruntime-win-x64-$runtimeVersion"
        $archivePath = Join-Path $downloadRoot "$archiveName.zip"
        if (!(Test-Path -LiteralPath $archivePath)) {
            $partialPath = "$archivePath.partial"
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/microsoft/onnxruntime/releases/download/v$runtimeVersion/$archiveName.zip" -OutFile $partialPath
            Move-Item -LiteralPath $partialPath -Destination $archivePath -Force
        }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $downloadRoot -Force
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $downloadRoot "$archiveName/lib") -File |
            Where-Object { $_.Extension -in '.dll', '.lib' } |
            Copy-Item -Destination $runtimeRoot -Force
        [System.IO.File]::WriteAllText($versionFile, $runtimeVersion)
    }
    Invoke-CMake -CMakeArguments @('-G', 'Visual Studio 18 2026', '-A', 'x64', '-S', (Join-Path $sourceRoot 'Make/CMake'), '-B', $buildRoot)
}

function Initialize-Band {
    Invoke-CMake -CMakeArguments @('-G', 'Visual Studio 18 2026', '-A', 'x64',
        '-S', (Join-Path $projectRoot 'simulations/robot-band'),
        '-B', (Join-Path $projectRoot 'out/simrobot-band'), "-DBHUMAN_ROOT=$sourceRoot")
}

if ($Action -eq 'Configure') {
    Initialize-Simulator
    if ($Scene -eq 'Band') { Initialize-Band }
} elseif ($Action -eq 'Build') {
    $simulatorPath = Join-Path $sourceRoot "Build/Windows/SimRobot/$Configuration/SimRobot.exe"
    if ($Scene -eq 'K1' -or !(Test-Path -LiteralPath $simulatorPath)) {
        if (!(Test-Path -LiteralPath (Join-Path $buildRoot 'CMakeCache.txt'))) { Initialize-Simulator }
        Invoke-CMake -CMakeArguments @('--build', $buildRoot, '--config', $Configuration, '--target', 'SimRobot', '--parallel', '4')
    }
    if ($Scene -eq 'Band') {
        Initialize-Band
        Invoke-CMake -CMakeArguments @('--build', (Join-Path $projectRoot 'out/simrobot-band'), '--config', $Configuration, '--target', 'RobotBandController', 'RobotBandBridgeProbe', '--parallel', '4')
    }
} else {
    $simulatorPath = Join-Path $sourceRoot "Build/Windows/SimRobot/$Configuration/SimRobot.exe"
    if (!(Test-Path -LiteralPath $simulatorPath)) { throw 'Simulator fehlt. Zuerst tools/bhuman.ps1 -Action Build ausfuehren.' }
    $scenePath = Join-Path $sourceRoot 'Config/Scenes/K1/RobotFast.ros3'
    if ($Scene -eq 'Band') {
        $scenePath = Join-Path $projectRoot 'simulations/robot-band/RobotBand.ros3'
        if (!(Test-Path -LiteralPath (Join-Path (Split-Path -Parent $simulatorPath) 'RobotBandController.dll'))) {
            throw 'Band-Controller fehlt. Zuerst tools/bhuman.ps1 -Action Build -Scene Band ausfuehren.'
        }
    }
    Start-Process -FilePath $simulatorPath -ArgumentList ('"' + $scenePath + '"') -WorkingDirectory $sourceRoot
}
