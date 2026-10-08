param([switch]$Rebuild, [switch]$OneClick, [string]$LanAddress, [ValidateRange(1, 65535)][int]$Port = 5188)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'start-local.ps1') -Lan -Rebuild:$Rebuild -OneClick:$OneClick -LanAddress $LanAddress -Port $Port
