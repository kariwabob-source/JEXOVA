param(
    [string]$JEXOVAUrl = "http://127.0.0.1:8000",
    [string]$TerminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe"
)

$ErrorActionPreference = "Stop"
$taskName = "JEXOVA MT5 Connector"
$connectorDirectory = $PSScriptRoot
$pythonCandidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
)

$edgeLedgerUri = $null
if (-not [Uri]::TryCreate($JEXOVAUrl, [UriKind]::Absolute, [ref]$edgeLedgerUri)) {
    throw "Enter a valid JEXOVA URL."
}
$localHttp = $edgeLedgerUri.Scheme -eq "http" -and $edgeLedgerUri.Host -in @("127.0.0.1", "localhost")
if (($edgeLedgerUri.Scheme -ne "https" -and -not $localHttp) -or
    -not $edgeLedgerUri.Host -or
    $edgeLedgerUri.UserInfo -or
    $edgeLedgerUri.Query -or
    $edgeLedgerUri.Fragment -or
    $JEXOVAUrl.Contains('"')) {
    throw "Use HTTPS for a remote JEXOVA URL, or HTTP only for a local URL."
}
if (-not (Test-Path $TerminalPath)) {
    throw "MetaTrader 5 was not found at '$TerminalPath'. Pass its terminal64.exe path with -TerminalPath."
}

$python = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $python = $pythonCommand.Source
    }
}
if (-not $python) {
    throw "64-bit Python 3.12 or 3.13 was not found. Install Python from python.org, then rerun this script."
}

$pythonCheck = & $python -c "import struct,sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+':'+str(struct.calcsize(chr(80))*8))"
if ($LASTEXITCODE -ne 0 -or $pythonCheck -ne "3.12:64") {
    throw "The connector requires 64-bit Python 3.12."
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    throw "The scheduled task '$taskName' already exists. It was not changed. Start it with: Start-ScheduledTask -TaskName '$taskName'"
}

$portInUse = Get-NetTCPConnection -State Listen -LocalPort 47620 -ErrorAction SilentlyContinue
if ($portInUse) {
    throw "Port 47620 is already in use. The installer will not stop or replace that process."
}

$venvPython = Join-Path $connectorDirectory ".venv\Scripts\python.exe"
$venvPythonw = Join-Path $connectorDirectory ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $venvPython)) {
    & $python -m venv (Join-Path $connectorDirectory ".venv")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the connector virtual environment."
    }
    if (-not (Test-Path $venvPythonw)) {
        throw "The Python installation does not include pythonw.exe, which is required for background startup."
    }
    $venvCheck = & $venvPython -c "import struct,sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+':'+str(struct.calcsize(chr(80))*8))"
    if ($LASTEXITCODE -ne 0 -or $venvCheck -ne "3.12:64") {
        throw "The existing connector virtual environment is not 64-bit Python 3.12."
    }
}

& $venvPython -m pip install -r (Join-Path $connectorDirectory "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Could not install connector requirements."
}

$arguments = '"{0}" serve --base-url "{1}" --terminal-path "{2}"' -f `
    (Join-Path $connectorDirectory "mt5_connector.py"), $JEXOVAUrl, $TerminalPath
$action = New-ScheduledTaskAction -Execute $venvPythonw -Argument $arguments -WorkingDirectory $connectorDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Read-only local MetaTrader 5 connector for JEXOVA." | Out-Null

Start-ScheduledTask -TaskName $taskName
$listener = $null
for ($attempt = 0; $attempt -lt 15 -and -not $listener; $attempt++) {
    Start-Sleep -Seconds 1
    $listener = Get-NetTCPConnection -State Listen -LocalPort 47620 -ErrorAction SilentlyContinue
}
if (-not $listener) {
    throw "The connector task was registered but did not open port 47620. Check the task history and %LOCALAPPDATA%\JEXOVA\mt5-connector.log."
}

Write-Host "JEXOVA MT5 Connector is installed and running."
Write-Host "It will start automatically when this Windows user signs in."
Write-Host "Open JEXOVA Settings and select Connect Trading Account."
Write-Host "The connector only reads MT5 account and trading history; it does not place or modify orders."
