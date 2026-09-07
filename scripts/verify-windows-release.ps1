[CmdletBinding()]
param(
    [ValidateSet('Unsigned', 'Trusted')]
    [string]$SignatureLevel = 'Unsigned',

    [string]$ExpectedPublisher,

    [switch]$GenerateManifest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDirectory = Join-Path $projectRoot 'release'
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = $package.version
$artifactNames = @(
    "WenShu-$version-portable-x64.exe",
    "WenShu-$version-setup-x64.exe"
)

if ($SignatureLevel -eq 'Trusted' -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
    throw 'Trusted verification requires -ExpectedPublisher with the exact certificate subject.'
}

$results = foreach ($artifactName in $artifactNames) {
    $artifactPath = Join-Path $releaseDirectory $artifactName
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        throw "Missing release artifact: $artifactName"
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
    if ($SignatureLevel -eq 'Unsigned') {
        if ($signature.Status -ne 'NotSigned') {
            throw "$artifactName was expected to be unsigned but status is $($signature.Status)."
        }
    }
    else {
        if ($signature.Status -ne 'Valid') {
            throw "$artifactName Authenticode status is $($signature.Status), expected Valid."
        }
        if ($null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -ne $ExpectedPublisher) {
            throw "$artifactName publisher does not match the approved certificate subject."
        }
        if ($null -eq $signature.TimeStamperCertificate) {
            throw "$artifactName has no verifiable timestamp certificate."
        }
    }

    [pscustomobject]@{
        File = $artifactName
        Status = $signature.Status.ToString()
        Publisher = if ($null -eq $signature.SignerCertificate) { '' } else { $signature.SignerCertificate.Subject }
        Timestamped = $null -ne $signature.TimeStamperCertificate
        SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToLowerInvariant()
    }
}

if ($GenerateManifest) {
    $manifestPath = Join-Path $releaseDirectory 'SHA256SUMS.txt'
    $manifestLines = $results | ForEach-Object { "$($_.SHA256) *$($_.File)" }
    Set-Content -LiteralPath $manifestPath -Value $manifestLines -Encoding ascii
}

$manifest = Join-Path $releaseDirectory 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw 'SHA256SUMS.txt is missing.'
}
else {
    $manifestLines = @(Get-Content -LiteralPath $manifest)
    if ($manifestLines.Count -ne $artifactNames.Count) {
        throw 'SHA256SUMS.txt must contain exactly one entry for each release EXE.'
    }
    $manifestNames = @()
    foreach ($line in $manifestLines) {
        $parts = $line -split ' \*', 2
        if ($parts.Count -ne 2 -or $artifactNames -notcontains $parts[1]) {
            throw 'SHA256SUMS.txt contains an unexpected or malformed entry.'
        }
        $manifestNames += $parts[1]
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $releaseDirectory $parts[1])).Hash.ToLowerInvariant()
        if ($parts[0] -ne $actual) {
            throw "SHA-256 verification failed for $($parts[1])."
        }
    }
    if (@($manifestNames | Sort-Object -Unique).Count -ne $artifactNames.Count) {
        throw 'SHA256SUMS.txt contains a duplicate or missing release EXE.'
    }
}

$results | Format-Table -AutoSize File, Status, Timestamped, SHA256
