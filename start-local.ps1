param([switch]$Rebuild, [switch]$Lan, [switch]$OneClick, [string]$LanAddress, [ValidateRange(1, 65535)][int]$Port = 5188)
$ErrorActionPreference = 'Stop'
$webProjectRoot = $PSScriptRoot
$webFrontendPath = Join-Path $webProjectRoot 'APP/web-frontend'
$webBackendPath = Join-Path $webProjectRoot 'APP/web-backend'
$webArguments = @('run_local.py', '--port', [string]$Port)
if ($Lan) {
    if (-not $LanAddress) {
        $webCandidates = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
            ForEach-Object { $_.IPv4Address } | Where-Object {
                $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
            })
        if ($webCandidates.Count -ne 1) {
            throw 'Cannot select a unique LAN address. Specify -LanAddress with this PC IPv4 address.'
        }
        $LanAddress = $webCandidates[0].IPAddress
    }
    $webInterface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction Stop)
    if ($webInterface.Count -ne 1) { throw 'LAN address must belong to exactly one local interface.' }
    $webArguments += @('--lan-address', $LanAddress, '--lan-network', "$LanAddress/$($webInterface[0].PrefixLength)")
} elseif ($LanAddress) {
    throw '-LanAddress requires -Lan.'
}
if ($OneClick -and $Lan) {
    $webFirewallScript = Join-Path $webProjectRoot 'configure-lan-firewall.ps1'
    if (-not (& $webFirewallScript -LanAddress $LanAddress -Port $Port -CheckOnly)) {
        Write-Host 'Windows administrator approval is needed to allow trusted LAN access.'
        try {
            $webFirewallProcess = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
                -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$webFirewallScript`" -LanAddress $LanAddress -Port $Port" -ErrorAction Stop
            if (-not $webFirewallProcess -or $webFirewallProcess.ExitCode -ne 0) { throw 'Firewall configuration failed.' }
            if (-not (& $webFirewallScript -LanAddress $LanAddress -Port $Port -CheckOnly)) { throw 'Firewall rule was not confirmed.' }
        } catch {
            Write-Warning 'LAN firewall was not configured. Localhost still works; phone access may be blocked.'
        }
    }
}
$webListener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($webListener.Count -gt 0) {
    if ($OneClick -and -not $Rebuild) {
        $webRunningUrl = if ($Lan) { "http://$LanAddress`:$Port" } else { "http://localhost:$Port" }
        try {
            $webHealth = Invoke-RestMethod -Uri "$webRunningUrl/api/health" -TimeoutSec 3 -Proxy $null
            $webProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($webListener[0].OwningProcess)"
            if ($webHealth.service -eq 'perlabo-web' -and $webProcess.Name -eq 'python.exe' -and
                $webProcess.CommandLine -match '(^|\s)run_local\.py(\s|$)' -and
                (-not $Lan -or $webListener.LocalAddress -contains '0.0.0.0')) {
                Write-Host "Web is already running. LAN address: $webRunningUrl"
                Start-Process "http://localhost:$Port"
                return
            }
        } catch { Write-Warning 'The occupied port could not be verified as this Web service.' }
    }
    throw "Port $Port is already in use. Stop your existing Web service or select another -Port."
}
if ($OneClick) { $webArguments += '--open-browser' }

$webHtmlPath = Join-Path $webFrontendPath 'dist/index.html'
$webNeedsBuild = $Rebuild -or -not (Test-Path -LiteralPath $webHtmlPath)
if (-not $webNeedsBuild) {
    $webBuiltAt = (Get-Item -LiteralPath $webHtmlPath).LastWriteTimeUtc
    $webSources = Get-ChildItem -LiteralPath (Join-Path $webFrontendPath 'src'), (Join-Path $webFrontendPath 'config') -Recurse -File
    $webSources += Get-Item -LiteralPath (Join-Path $webFrontendPath 'package.json'), (Join-Path $webFrontendPath 'babel.config.js')
    $webNeedsBuild = [bool]($webSources | Where-Object { $_.LastWriteTimeUtc -gt $webBuiltAt } | Select-Object -First 1)
}
if ($webNeedsBuild) {
    Push-Location $webFrontendPath
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $webFrontendPath 'node_modules'))) {
            & npm.cmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Web dependency installation failed.' }
        }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    } finally { Pop-Location }
}

$webPython = Join-Path $webBackendPath '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $webPython)) { $webPython = 'python' }
Push-Location $webBackendPath
try {
    & $webPython @webArguments
    if ($LASTEXITCODE -ne 0) { throw 'Local Web service failed to start.' }
} finally { Pop-Location }
