[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$routerPath = Join-Path $backendRoot 'vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php'
$viteEntry = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
$statePath = Join-Path (Join-Path $env:LOCALAPPDATA 'JEXOVA\dev-launcher') 'processes.json'

function Test-SamePath {
    param([string]$First, [string]$Second)

    if ([string]::IsNullOrWhiteSpace($First) -or [string]::IsNullOrWhiteSpace($Second)) {
        return $false
    }

    return [string]::Equals(
        [System.IO.Path]::GetFullPath($First),
        [System.IO.Path]::GetFullPath($Second),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function ConvertTo-ProcessStartTime {
    param([object]$Value)

    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime()
    }

    return [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Value).ToUniversalTime()
}

function Test-TrackedProcess {
    param([object]$Record)

    if (
        -not $Record `
        -or $Record.ProjectRoot -ine $projectRoot `
        -or $Record.Kind -notin @('laravel', 'vite')
    ) {
        return $false
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $process -or -not (Test-SamePath $process.ExecutablePath $Record.ExecutablePath)) {
        return $false
    }

    try {
        $createdAt = ConvertTo-ProcessStartTime $process.CreationDate
        $recordedAt = [DateTime]::Parse($Record.StartedAtUtc).ToUniversalTime()
    } catch {
        return $false
    }

    if ([Math]::Abs(($createdAt - $recordedAt).TotalSeconds) -gt 2) {
        return $false
    }

    $commandLine = ([string]$process.CommandLine).Replace('/', '\').ToLowerInvariant()
    if ($Record.Kind -eq 'laravel') {
        $routerMarker = $routerPath.Replace('/', '\').ToLowerInvariant()

        return $process.Name -ieq 'php.exe' `
            -and $commandLine.Contains('-s 127.0.0.1:8000') `
            -and $commandLine.Contains($routerMarker)
    }

    $viteMarker = $viteEntry.Replace('/', '\').ToLowerInvariant()

    return $process.Name -ieq 'node.exe' `
        -and $commandLine.Contains($viteMarker) `
        -and $commandLine.Contains('--port 5173')
}

function Write-LauncherState {
    param(
        [string]$Path,
        [object[]]$Records
    )

    if (-not $Records -or $Records.Count -eq 0) {
        if (Test-Path -LiteralPath $Path) {
            Remove-Item -LiteralPath $Path -Force
        }
        return
    }

    $document = [ordered]@{
        Version = 1
        ProjectRoot = $projectRoot
        Processes = @($Records)
    }
    $temporaryPath = $Path + '.tmp'
    $json = ConvertTo-Json -InputObject $document -Depth 5
    Set-Content -LiteralPath $temporaryPath -Value $json -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'No JEXOVA development processes started by this launcher are recorded.'
    Write-Host 'Existing servers and MySQL were left untouched.'
    exit 0
}

try {
    $document = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
} catch {
    Write-Host 'The launcher state file is unreadable; no process was stopped.' -ForegroundColor Red
    exit 1
}

if ($document.Version -ne 1 -or $document.ProjectRoot -ine $projectRoot) {
    Write-Host 'The launcher state does not match this project; no process was stopped.' -ForegroundColor Red
    exit 1
}

$records = @($document.Processes)
foreach ($record in $records) {
    if (
        $record.Kind -notin @('laravel', 'vite') `
        -or $record.ProjectRoot -ine $projectRoot `
        -or -not $record.ProcessId `
        -or -not $record.ExecutablePath `
        -or -not $record.StartedAtUtc
    ) {
        Write-Host 'The launcher state contains an invalid process record; no process was stopped.' -ForegroundColor Red
        exit 1
    }
}

$remainingRecords = @()
foreach ($record in $records) {
    if (-not (Test-TrackedProcess $record)) {
        Write-Host "Skipped PID $($record.ProcessId): it is no longer the matching launcher-started JEXOVA process."
        continue
    }

    try {
        Stop-Process -Id ([int]$record.ProcessId) -ErrorAction Stop
        $deadline = (Get-Date).AddSeconds(10)
        do {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.ProcessId)" -ErrorAction SilentlyContinue
            if (-not $process) {
                break
            }
            Start-Sleep -Milliseconds 250
        } while ((Get-Date) -lt $deadline)

        if (Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.ProcessId)" -ErrorAction SilentlyContinue) {
            Write-Host "Could not confirm shutdown of launcher-owned PID $($record.ProcessId)." -ForegroundColor Yellow
            $remainingRecords += $record
        } else {
            Write-Host "Stopped launcher-started $($record.Kind) process PID $($record.ProcessId)."
        }
    } catch {
        Write-Host "Could not stop launcher-owned PID $($record.ProcessId): $($_.Exception.Message)" -ForegroundColor Yellow
        $remainingRecords += $record
    }
}

Write-LauncherState -Path $statePath -Records $remainingRecords
Write-Host 'MySQL was not stopped; the launcher never tracks or stops MySQL.'
