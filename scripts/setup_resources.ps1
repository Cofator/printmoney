<#
.SYNOPSIS
    Downloads the large binary resources (fonts and background music) that are
    intentionally kept out of git for this repository.

.DESCRIPTION
    Windows / PowerShell equivalent of scripts/setup_resources.sh. The font and
    music files live in the upstream MoneyPrinterTurbo project and are required
    at runtime for video rendering (subtitle fonts) and for the background-song
    feature. They are downloaded into resource/fonts/ and resource/songs/.

    Re-running is safe: existing, non-empty files are skipped unless -Force is
    given.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup_resources.ps1

.EXAMPLE
    .\scripts\setup_resources.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [string]$Upstream = $(if ($env:MPT_UPSTREAM) { $env:MPT_UPSTREAM } else { "https://raw.githubusercontent.com/harry0703/MoneyPrinterTurbo/main" })
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # much faster downloads with Invoke-WebRequest

# Repository root = parent of the folder containing this script.
$Root = Split-Path -Parent $PSScriptRoot

$Fonts = @(
    "BeVietnamPro-Bold.ttf",
    "BeVietnamPro-Medium.ttf",
    "Charm-Bold.ttf",
    "Charm-Regular.ttf",
    "MicrosoftYaHeiBold.ttc",
    "MicrosoftYaHeiNormal.ttc",
    "STHeitiLight.ttc",
    "STHeitiMedium.ttc",
    "UTM Kabel KT.ttf"
)

# Note: upstream skips output026.mp3, so the list is enumerated explicitly.
$Songs = @(
    "output000.mp3","output001.mp3","output002.mp3","output003.mp3","output004.mp3",
    "output005.mp3","output006.mp3","output007.mp3","output008.mp3","output009.mp3",
    "output010.mp3","output011.mp3","output012.mp3","output013.mp3","output014.mp3",
    "output015.mp3","output016.mp3","output017.mp3","output018.mp3","output019.mp3",
    "output020.mp3","output021.mp3","output022.mp3","output023.mp3","output024.mp3",
    "output025.mp3","output027.mp3","output028.mp3","output029.mp3"
)

function Get-Resource {
    param(
        [string]$SubDir,   # "fonts" or "songs"
        [string]$Name
    )
    $destDir = Join-Path $Root "resource\$SubDir"
    $dest    = Join-Path $destDir $Name
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null

    if (-not $Force -and (Test-Path $dest) -and (Get-Item $dest).Length -gt 0) {
        Write-Host "  skip (exists): resource/$SubDir/$Name"
        return
    }

    # URL-encode the file name (handles the space in "UTM Kabel KT.ttf").
    $encName = [uri]::EscapeDataString($Name)
    $url = "$Upstream/resource/$SubDir/$encName"

    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        if ((Get-Item $dest).Length -le 0) { throw "empty file" }
        Write-Host "  ok: resource/$SubDir/$Name"
    }
    catch {
        if (Test-Path $dest) { Remove-Item $dest -Force }
        Write-Error "  FAILED: $url  ($($_.Exception.Message))"
        throw
    }
}

Write-Host "Downloading fonts -> resource/fonts/"
foreach ($f in $Fonts) { Get-Resource -SubDir "fonts" -Name $f }

Write-Host "Downloading background music -> resource/songs/"
foreach ($s in $Songs) { Get-Resource -SubDir "songs" -Name $s }

Write-Host "Done. Fonts and background music are ready."
