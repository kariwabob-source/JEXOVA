<#
.SYNOPSIS
Starts the normal EdgeLedger development server using backend\.env.

.DESCRIPTION
Checks MySQL, clears a stale Laravel config cache if one exists, verifies that
the effective database is edgeledger, and starts the server on 127.0.0.1:8000.
It never changes .env, starts a test-database server, or stops existing processes.

.EXAMPLE
Set-Location 'C:\Users\USER\edgeledger\backend'
.\start-edgeledger-dev.ps1

If PowerShell blocks the script:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-edgeledger-dev.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$mysqlHost = '127.0.0.1'
$mysqlPort = 3306
$serverHost = '127.0.0.1'
$serverPort = 8000
$legacyTestPort = 8001
$applicationEnvironmentVariables = @(
    'APP_ENV',
    'APP_CONFIG_CACHE',
    'DB_CONNECTION',
    'DB_HOST',
    'DB_PORT',
    'DB_DATABASE',
    'DB_URL',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_SOCKET',
    'DB_CHARSET',
    'DB_COLLATION',
    'DB_FOREIGN_KEYS'
)

$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
$occupiedPorts = @()
foreach ($port in @($serverPort, $legacyTestPort)) {
    if ($listeners | Where-Object { $_.Port -eq $port }) {
        $occupiedPorts += $port
    }
}
if ($occupiedPorts.Count -gt 0) {
    $ports = ($occupiedPorts | Sort-Object -Unique) -join ', '
    Write-Host "Port(s) $ports are already occupied. No process was stopped. Close the existing Laravel server(s), including the legacy test server on port $legacyTestPort, before starting EdgeLedger." -ForegroundColor Red
    exit 1
}

$mysqlClient = New-Object System.Net.Sockets.TcpClient
try {
    $mysqlClient.Connect($mysqlHost, $mysqlPort)
}
catch {
    Write-Host "MySQL is not reachable at ${mysqlHost}:$mysqlPort. Laravel was not started." -ForegroundColor Red
    exit 1
}
finally {
    $mysqlClient.Dispose()
}

$phpCommand = Get-Command php.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $phpCommand) {
    Write-Host 'php.exe was not found on PATH. Laravel was not started.' -ForegroundColor Red
    exit 1
}

function New-LaravelProcessStartInfo {
    param(
        [string]$Arguments,
        [bool]$RedirectOutput = $false
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $phpCommand.Source
    $startInfo.WorkingDirectory = $PSScriptRoot
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $false
    $startInfo.RedirectStandardOutput = $RedirectOutput
    $startInfo.RedirectStandardError = $RedirectOutput

    foreach ($name in $applicationEnvironmentVariables) {
        [void]$startInfo.EnvironmentVariables.Remove($name)
    }

    return $startInfo
}

function Invoke-EdgeLedgerArtisan {
    param([string]$Arguments)

    $startInfo = New-LaravelProcessStartInfo -Arguments $Arguments -RedirectOutput $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($standardOutput) {
        Write-Host $standardOutput.TrimEnd()
    }
    if ($standardError) {
        Write-Host $standardError.TrimEnd() -ForegroundColor Yellow
    }
    if ($process.ExitCode -ne 0) {
        throw "Laravel preflight failed with exit code $($process.ExitCode). The server was not started."
    }
}

$configurationCache = Join-Path $PSScriptRoot 'bootstrap\cache\config.php'
if (Test-Path -LiteralPath $configurationCache) {
    Write-Host 'Clearing the stale Laravel configuration cache.'
    Invoke-EdgeLedgerArtisan 'artisan config:clear --no-interaction'
}

Invoke-EdgeLedgerArtisan 'artisan edgeledger:database-status --no-interaction'

$startInfo = New-LaravelProcessStartInfo -Arguments "artisan serve --host=$serverHost --port=$serverPort"
Write-Host "Starting EdgeLedger at http://${serverHost}:$serverPort using backend\.env (edgeledger). Press Ctrl+C to stop."
$process = [System.Diagnostics.Process]::Start($startInfo)
$process.WaitForExit()
exit $process.ExitCode
