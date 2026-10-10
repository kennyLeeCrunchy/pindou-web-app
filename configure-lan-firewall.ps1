param([Parameter(Mandatory = $true)][string]$LanAddress, [ValidateRange(1, 65535)][int]$Port = 5188, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$webInterface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction Stop)
if ($webInterface.Count -ne 1 -or $LanAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
    throw 'Specify a private IPv4 address assigned to this PC.'
}
$webPrefix = $webInterface[0].PrefixLength
if ($webPrefix -lt 8 -or $webPrefix -gt 32) { throw 'Invalid LAN prefix.' }
$webMinimumPrefix = if ($LanAddress -match '^10\.') { 8 } elseif ($LanAddress -match '^172\.') { 12 } else { 16 }
if ($webPrefix -lt $webMinimumPrefix) { throw 'LAN subnet must stay entirely within a private IPv4 range.' }
$webBytes = ([System.Net.IPAddress]::Parse($LanAddress)).GetAddressBytes()
for ($webIndex = 0; $webIndex -lt 4; $webIndex++) {
    $webBits = [Math]::Max(0, [Math]::Min(8, $webPrefix - $webIndex * 8))
    $webMask = if ($webBits -eq 0) { 0 } else { 256 - [Math]::Pow(2, 8 - $webBits) }
    $webBytes[$webIndex] = $webBytes[$webIndex] -band [int]$webMask
}
$webSubnet = "$([System.Net.IPAddress]::new($webBytes))/$webPrefix"
$webRuleName = "Pindou-Web-LAN-$Port"
$webRuleDescription = "Pindou LAN $LanAddress`:$Port from $webSubnet on $($webInterface[0].InterfaceAlias)"
$webRule = Get-NetFirewallRule -Name $webRuleName -ErrorAction SilentlyContinue
if ($CheckOnly) {
    $webAddressFilter = if ($webRule) { $webRule | Get-NetFirewallAddressFilter }
    $webPortFilter = if ($webRule) { $webRule | Get-NetFirewallPortFilter }
    $webInterfaceFilter = if ($webRule) { $webRule | Get-NetFirewallInterfaceFilter }
    return [bool]($webRule -and $webRule.Enabled -eq 'True' -and $webRule.Action -eq 'Allow' -and
        $webRule.Direction -eq 'Inbound' -and $webRule.Description -eq $webRuleDescription -and
        @($webAddressFilter.LocalAddress).Count -eq 1 -and $webAddressFilter.LocalAddress -eq $LanAddress -and
        @($webAddressFilter.RemoteAddress).Count -eq 1 -and $webAddressFilter.RemoteAddress -eq $webSubnet -and
        $webPortFilter.Protocol -eq 'TCP' -and $webPortFilter.LocalPort -eq [string]$Port -and
        $webInterfaceFilter.InterfaceAlias -eq $webInterface[0].InterfaceAlias)
}
if ($webRule) {
    Set-NetFirewallRule -Name $webRuleName -Description $webRuleDescription -Enabled True -Direction Inbound -Action Allow -Profile Any `
        -Protocol TCP -LocalPort $Port -LocalAddress $LanAddress -RemoteAddress $webSubnet `
        -InterfaceAlias $webInterface[0].InterfaceAlias -ErrorAction Stop
} else {
    New-NetFirewallRule -Name $webRuleName -DisplayName "Pindou Web trusted LAN ($Port)" -Description $webRuleDescription `
        -Direction Inbound -Action Allow -Profile Any -Protocol TCP -LocalPort $Port `
        -LocalAddress $LanAddress -RemoteAddress $webSubnet -InterfaceAlias $webInterface[0].InterfaceAlias -ErrorAction Stop | Out-Null
}
Write-Host "LAN firewall rule ready: $LanAddress`:$Port from $webSubnet only."
