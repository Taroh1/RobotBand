param([Parameter(Mandatory = $true)][string]$SourceRoot)
$ErrorActionPreference = 'Stop'
function Run-Wsl {
    param([string[]]$WslArguments)
    & wsl.exe @WslArguments
    if ($LASTEXITCODE -ne 0) { throw "WSL-Schritt fehlgeschlagen (Exit $LASTEXITCODE). Bei neuer WSL-Installation Windows neu starten und Setup erneut ausfuehren." }
}
$distro = $null
$names = @((& wsl.exe --list --quiet 2>$null) -replace "`0", '' | Where-Object { $_.Trim() })
foreach ($candidate in $names) {
    if ($candidate -notmatch '^Ubuntu') { continue }
    $release = & wsl.exe -d $candidate -u root -- cat /etc/os-release
    if (($release -join "`n") -match 'VERSION_ID="24\.04"') { $distro = $candidate.Trim(); break }
}
if (!$distro) {
    Run-Wsl -WslArguments @('--install','-d','Ubuntu-24.04','--no-launch','--web-download')
    $distro = 'Ubuntu-24.04'
}
$release = & wsl.exe -d $distro -u root -- cat /etc/os-release
if ($LASTEXITCODE -ne 0 -or ($release -join "`n") -notmatch 'VERSION_ID="24\.04"') {
    throw 'Ubuntu 24.04 ist noch nicht bereit. Windows neu starten, Ubuntu einmal starten und Setup erneut ausfuehren.'
}
Run-Wsl -WslArguments @('-d',$distro,'-u','root','--','apt-get','update')
Run-Wsl -WslArguments @('-d',$distro,'-u','root','--','env','DEBIAN_FRONTEND=noninteractive','apt-get','-y','install','astyle','ccache','clang','cmake','llvm','mold','net-tools','ninja-build','rsync','unzip','curl')
Run-Wsl -WslArguments @('-d',$distro,'-u','root','--cd',$SourceRoot,'--','bash','Make/Common/pullONNXRuntime')
foreach ($configuration in @('Debug','Develop','Release')) {
    Run-Wsl -WslArguments @('-d',$distro,'-u','root','--cd',$SourceRoot,'--','cmake',"-DCMAKE_BUILD_TYPE=$configuration",'-DBUILD_BOOSTER=ON','-G','Ninja','-S','Make/CMake','-B',"Build/Linux/CMake/$configuration/Booster-prefix")
}
# Upstream Windows tasks invoke `bash` without a distro argument. Make that
# resolve to this Ubuntu, while preserving its existing WSL version and user.
Run-Wsl -WslArguments @('--set-default',$distro)
Write-Host "B-Human-Cross-Build vorbereitet: $distro. Bestehende WSL-Version und Benutzer unveraendert."
