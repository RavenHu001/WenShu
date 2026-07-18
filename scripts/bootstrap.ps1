[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$versionFile = Join-Path $projectRoot '.node-version'
$toolsDirectory = Join-Path $projectRoot '.tools'
$downloadsDirectory = Join-Path $toolsDirectory '.downloads'

if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) {
    throw "Missing Node.js version file: $versionFile"
}

$nodeVersion = (Get-Content -Raw -LiteralPath $versionFile).Trim()
if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid Node.js version in .node-version: $nodeVersion"
}

# Task 1 targets Windows 10/11. Keep architecture selection explicit so a wrong binary is never used silently.
$runtimeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$nodeArchitecture = switch ($runtimeArchitecture) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw "Unsupported Windows architecture: $runtimeArchitecture" }
}

$archiveName = "node-v$nodeVersion-win-$nodeArchitecture.zip"
$nodeDirectory = Join-Path $toolsDirectory "node-v$nodeVersion-win-$nodeArchitecture"
$nodeExecutable = Join-Path $nodeDirectory 'node.exe'
$npmExecutable = Join-Path $nodeDirectory 'npm.cmd'

if ((Test-Path -LiteralPath $nodeExecutable -PathType Leaf) -and
    (Test-Path -LiteralPath $npmExecutable -PathType Leaf)) {
    $installedVersion = (& $nodeExecutable --version).TrimStart('v')
    if ($installedVersion -ne $nodeVersion) {
        throw "Local Node.js version mismatch: expected $nodeVersion, found $installedVersion"
    }

    Write-Host "Local Node.js v$installedVersion is already ready."
    Write-Host "npm $(& $npmExecutable --version)"
    exit 0
}

if (Test-Path -LiteralPath $nodeDirectory) {
    throw "Incomplete local toolchain found at $nodeDirectory. Remove that directory and run bootstrap again."
}

$officialReleaseBaseUrl = "https://nodejs.org/download/release/v$nodeVersion"
$distributionRoot = if ([string]::IsNullOrWhiteSpace($env:WENSHU_NODE_DIST_URL)) {
    'https://nodejs.org/download/release'
}
else {
    $env:WENSHU_NODE_DIST_URL.TrimEnd('/')
}
$archiveUrl = "$distributionRoot/v$nodeVersion/$archiveName"
$checksumsUrl = "$officialReleaseBaseUrl/SHASUMS256.txt"
$archivePath = Join-Path $downloadsDirectory $archiveName
$checksumsPath = Join-Path $downloadsDirectory "SHASUMS256-v$nodeVersion.txt"

New-Item -ItemType Directory -Force -Path $downloadsDirectory | Out-Null

Write-Host "Downloading the official checksum manifest for Node.js v$nodeVersion..."
Invoke-WebRequest -UseBasicParsing -Uri $checksumsUrl -OutFile $checksumsPath
Write-Host "Downloading Node.js for Windows $nodeArchitecture from $archiveUrl..."
Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath

# The checksum always comes from Node.js. A configured mirror can supply bytes but cannot change the pinned hash.
$escapedArchiveName = [regex]::Escape($archiveName)
$checksumLine = Get-Content -LiteralPath $checksumsPath |
    Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+$escapedArchiveName$" } |
    Select-Object -First 1

if (-not $checksumLine) {
    throw "The official checksum manifest does not contain $archiveName"
}

$expectedHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()

if ($actualHash -ne $expectedHash) {
    throw "Node.js archive checksum mismatch. Expected $expectedHash, received $actualHash"
}

Write-Host 'Checksum verified. Extracting the project-local toolchain...'
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDirectory

if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw "Node.js extraction completed without the expected executable: $nodeExecutable"
}

$installedVersion = (& $nodeExecutable --version).TrimStart('v')
if ($installedVersion -ne $nodeVersion) {
    throw "Extracted Node.js version mismatch: expected $nodeVersion, found $installedVersion"
}

Write-Host "Local Node.js v$installedVersion installed at $nodeDirectory"
Write-Host "npm $(& $npmExecutable --version)"
Write-Host 'Next: .\scripts\npm.cmd ci'
