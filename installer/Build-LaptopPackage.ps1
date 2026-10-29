param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'out/dist' }
$stage = Join-Path $projectRoot ('out/laptop-package-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $stage 'payload'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($folder in @('src','public','tools','test','simulations','examples','docs','installer')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination $payload -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $payload '.vscode') -Force | Out-Null
foreach ($file in @('launch.json','tasks.json')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ".vscode/$file") -Destination (Join-Path $payload '.vscode')
}
foreach ($file in @('package.json','README.md','.gitignore','.dockerignore','Dockerfile','compose.yaml','compose.debug.yaml')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $payload
}
New-Item -ItemType Directory -Path (Join-Path $payload 'chat-transfer') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'chat-transfer/README.md') -Destination (Join-Path $payload 'chat-transfer')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Setup.cmd') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Setup-RobotBand.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $stage 'LIESMICH.md')
$manifest = @{}
foreach ($file in Get-ChildItem -LiteralPath $payload -Recurse -File) {
    $relative = $file.FullName.Substring($payload.Length + 1).Replace('\','/')
    $manifest[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
[IO.File]::WriteAllText((Join-Path $stage 'SHA256SUMS.json'), ($manifest | ConvertTo-Json))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$archivePath = Join-Path $OutputDirectory "RobotBand-Laptop-$version.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archivePath -Force
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archivePath + '.sha256'), "$hash  $([IO.Path]::GetFileName($archivePath))`n")
Write-Host "Paket: $archivePath`nSHA256: $hash`nDateien: $($manifest.Count)"
