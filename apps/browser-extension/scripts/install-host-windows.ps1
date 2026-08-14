param(
    [Parameter(Mandatory = $false)]
    [string]$ExtensionId = "",
    [switch]$Uninstall
)

$HostName = "com.workinsight.agent.bridge"
$HostDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\NativeMessagingHosts"
$HostJson = "$HostDir\$HostName.json"
$BridgeBin = "C:\Program Files\WorkInsight Agent\workinsight-bridge.exe"

if ($Uninstall) {
    Remove-Item -Force $HostJson -ErrorAction SilentlyContinue
    Write-Host "removed $HostJson"
    exit 0
}

if ($ExtensionId -notmatch '^[a-p]{32}$') {
    Write-Error "--ExtensionId must be a 32-char Chromium extension ID"
    exit 2
}
if (-not (Test-Path $BridgeBin)) {
    Write-Error "bridge binary not found at $BridgeBin"
    exit 2
}

New-Item -ItemType Directory -Force -Path $HostDir | Out-Null
$json = @{
    name = $HostName
    description = "WorkInsight agent native messaging host"
    path = $BridgeBin
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
Set-Content -Path $HostJson -Value $json -Encoding UTF8
Write-Host "installed $HostJson"
