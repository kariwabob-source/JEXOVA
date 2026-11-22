[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$backendRoot = Join-Path $projectRoot 'backend'
$publicRoot = Join-Path $backendRoot 'public'
$frontendRoot = Join-Path $projectRoot 'frontend'
$routerPath = Join-Path $backendRoot 'vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php'
$viteEntry = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
$backendPort = 8000
$frontendPort = 5173
$mysqlPort = 3306
$loginUrl = 'http://localhost:5173/login'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'JEXOVA\dev-launcher'
$statePath = Join-Path $stateDirectory 'processes.json'

$stateRecords = @()
$startedRecords = New-Object System.Collections.ArrayList
$stateWasRead = $false
$xamppRoot = $null

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

function Get-PortProcesses {
    param([int]$Port)

    $processIds = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    $processes = @()

    foreach ($processId in $processIds) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if ($process) {
            $processes += $process
        }
    }

    return $processes
}

function Test-JEXOVABackendProcess {
    param(
        [Microsoft.Management.Infrastructure.CimInstance]$Process,
        [int]$Port
    )

    if (-not $Process -or $Process.Name -ine 'php.exe') {
        return $false
    }

    $commandLine = ([string]$Process.CommandLine).Replace('/', '\').ToLowerInvariant()
    $backendMarker = $backendRoot.Replace('/', '\').ToLowerInvariant()

    return $commandLine.Contains($backendMarker) `
        -and $commandLine.Contains('\vendor\laravel\framework\') `
        -and $commandLine.Contains("127.0.0.1:$Port")
}

function Test-JEXOVAViteProcess {
    param([Microsoft.Management.Infrastructure.CimInstance]$Process)

    if (-not $Process -or $Process.Name -ine 'node.exe') {
        return $false
    }

    $commandLine = ([string]$Process.CommandLine).Replace('/', '\').ToLowerInvariant()
    $frontendMarker = $frontendRoot.Replace('/', '\').ToLowerInvariant()

    return $commandLine.Contains($frontendMarker) `
        -and $commandLine.Contains('\vite\bin\vite.js')
}

function Test-XamppLayout {
    param([string]$Root)

    return (Test-Path -LiteralPath (Join-Path $Root 'xampp-control.exe')) `
        -and (Test-Path -LiteralPath (Join-Path $Root 'mysql_start.bat')) `
        -and (Test-Path -LiteralPath (Join-Path $Root 'mysql\bin\mysqld.exe')) `
        -and (Test-Path -LiteralPath (Join-Path $Root 'mysql\bin\my.ini'))
}

function Get-XamppRoots {
    $candidates = New-Object System.Collections.ArrayList
    [void]$candidates.Add('C:\xampp')

    $desktopPath = Join-Path $env:USERPROFILE 'Desktop'
    if (Test-Path -LiteralPath $desktopPath) {
        foreach ($directory in Get-ChildItem -LiteralPath $desktopPath -Directory -ErrorAction SilentlyContinue) {
            [void]$candidates.Add($directory.FullName)
        }
    }

    foreach ($controlProcess in Get-CimInstance Win32_Process -Filter "Name = 'xampp-control.exe'" -ErrorAction SilentlyContinue) {
        if ($controlProcess.ExecutablePath) {
            [void]$candidates.Add((Split-Path -Parent $controlProcess.ExecutablePath))
        }
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if (-not $seen.ContainsKey($candidate) -and (Test-XamppLayout $candidate)) {
            $seen[$candidate] = $true
            Write-Output $candidate
        }
    }
}

function Get-XamppRootForMysqlProcess {
    param([Microsoft.Management.Infrastructure.CimInstance]$Process)

    if (-not $Process -or $Process.Name -ine 'mysqld.exe') {
        return $null
    }

    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.ParentProcessId)" -ErrorAction SilentlyContinue
    if ($parent -and $parent.Name -ieq 'xampp-control.exe' -and $parent.ExecutablePath) {
        $root = Split-Path -Parent $parent.ExecutablePath
        $expectedMysql = Join-Path $root 'mysql\bin\mysqld.exe'
        if ((Test-XamppLayout $root) -and (Test-SamePath $Process.ExecutablePath $expectedMysql)) {
            return $root
        }
    }

    $commandLine = [string]$Process.CommandLine
    $defaultsMatch = [regex]::Match(
        $commandLine,
        '(?i)--defaults-file(?:=|\s+)(?:"([^"]+)"|(\S+))'
    )
    $defaultsFile = $null
    if ($defaultsMatch.Success) {
        $defaultsFile = if ($defaultsMatch.Groups[1].Success) {
            $defaultsMatch.Groups[1].Value
        } else {
            $defaultsMatch.Groups[2].Value
        }
    }

    foreach ($root in Get-XamppRoots) {
        $expectedMysql = Join-Path $root 'mysql\bin\mysqld.exe'
        $expectedIni = Join-Path $root 'mysql\bin\my.ini'
        if (
            (Test-SamePath $Process.ExecutablePath $expectedMysql) `
            -and $defaultsFile `
            -and (Test-SamePath $defaultsFile $expectedIni)
        ) {
            return $root
        }
    }

    return $null
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

function Read-LauncherState {
    if (-not (Test-Path -LiteralPath $statePath)) {
        return @()
    }

    try {
        $document = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } catch {
        throw 'The JEXOVA launcher state file is unreadable. It was left untouched; inspect it before retrying.'
    }

    if ($document.Version -ne 1 -or $document.ProjectRoot -ine $projectRoot) {
        throw 'The JEXOVA launcher state does not match this project. It was left untouched.'
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
            throw 'The JEXOVA launcher state contains an invalid process record. It was left untouched.'
        }
    }

    return $records
}

function Write-LauncherState {
    param([object[]]$Records)

    if (-not $Records -or $Records.Count -eq 0) {
        if (Test-Path -LiteralPath $statePath) {
            Remove-Item -LiteralPath $statePath -Force
        }
        return
    }

    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $document = [ordered]@{
        Version = 1
        ProjectRoot = $projectRoot
        Processes = @($Records)
    }
    $temporaryPath = $statePath + '.tmp'
    $json = ConvertTo-Json -InputObject $document -Depth 5
    Set-Content -LiteralPath $temporaryPath -Value $json -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function New-TrackedProcessRecord {
    param(
        [int]$ProcessId,
        [string]$Kind,
        [string]$ExecutablePath
    )

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if ($process) {
            try {
                $startedAt = ConvertTo-ProcessStartTime $process.CreationDate
                $record = [pscustomobject]@{
                    Kind = $Kind
                    ProcessId = $ProcessId
                    ExecutablePath = $ExecutablePath
                    StartedAtUtc = $startedAt.ToString('o')
                    ProjectRoot = $projectRoot
                }
                if (Test-TrackedProcess $record) {
                    return $record
                }
            } catch {
                # Retry while the new process metadata becomes available.
            }
        }

        Start-Sleep -Milliseconds 200
    }

    throw "Could not verify the identity of the newly started $Kind process."
}

function Test-TcpPort {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-ForTcpPort {
    param(
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort $Port) {
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Port $Port did not become ready within $TimeoutSeconds seconds."
}

function Test-LoginPage {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -MaximumRedirection 0 -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    } catch {
        return $false
    }

    if ([int]$response.StatusCode -ne 200) {
        return $false
    }

    $match = [regex]::Match(
        [string]$response.Content,
        '<meta[^>]+name=["'']csrf-token["''][^>]+content=["'']([^"'']+)["'']',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    return $match.Success `
        -and $match.Groups[1].Value.Length -eq 40 `
        -and $match.Groups[1].Value -match '^[A-Za-z0-9]+$'
}

function Wait-ForLoginPage {
    param(
        [string]$Url,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-LoginPage $Url) {
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "The login page at $Url did not become ready with a valid CSRF token."
}

try {
    if (
        -not (Test-Path -LiteralPath (Join-Path $backendRoot 'artisan')) `
        -or -not (Test-Path -LiteralPath (Join-Path $publicRoot 'index.php')) `
        -or -not (Test-Path -LiteralPath $routerPath) `
        -or -not (Test-Path -LiteralPath $viteEntry)
    ) {
        throw 'The Laravel or Vite installation is incomplete. Check backend and frontend dependencies.'
    }

    $stateRecords = @(Read-LauncherState)
    $stateWasRead = $true
    $stateRecords = @($stateRecords | Where-Object { Test-TrackedProcess $_ })
    Write-LauncherState $stateRecords

    $backendListeners = @(Get-PortProcesses $backendPort)
    if ($backendListeners.Count -gt 1) {
        throw "Port $backendPort has multiple listener processes. No server was started."
    }
    if ($backendListeners.Count -eq 1 -and -not (Test-JEXOVABackendProcess $backendListeners[0] $backendPort)) {
        throw "Port $backendPort is occupied by PID $($backendListeners[0].ProcessId) ($($backendListeners[0].Name)), not the JEXOVA Laravel backend. No process was stopped."
    }

    $frontendListeners = @(Get-PortProcesses $frontendPort)
    if ($frontendListeners.Count -gt 1) {
        throw "Port $frontendPort has multiple listener processes. No server was started."
    }
    if ($frontendListeners.Count -eq 1 -and -not (Test-JEXOVAViteProcess $frontendListeners[0])) {
        throw "Port $frontendPort is occupied by PID $($frontendListeners[0].ProcessId) ($($frontendListeners[0].Name)), not JEXOVA Vite. No process was stopped."
    }

    $mysqlListeners = @(Get-PortProcesses $mysqlPort)
    if ($mysqlListeners.Count -gt 1) {
        throw "Port $mysqlPort has multiple listener processes; XAMPP MySQL cannot be identified safely."
    }

    if ($mysqlListeners.Count -eq 1) {
        $xamppRoot = Get-XamppRootForMysqlProcess $mysqlListeners[0]
        if (-not $xamppRoot) {
            throw "Port $mysqlPort is occupied by PID $($mysqlListeners[0].ProcessId) ($($mysqlListeners[0].Name)) outside a confirmed XAMPP installation. No MySQL process was started or stopped."
        }
        Write-Host "XAMPP MySQL is already running on port $mysqlPort."
    } else {
        $dataRoots = @(
            Get-XamppRoots |
                Where-Object { Test-Path -LiteralPath (Join-Path $_ 'mysql\data\edgeledger') }
        )
        if ($dataRoots.Count -ne 1) {
            throw "MySQL is stopped, but could not uniquely identify an XAMPP data directory containing edgeledger. No MySQL instance was started."
        }

        $xamppRoot = $dataRoots[0]
        $mysqldPath = Join-Path $xamppRoot 'mysql\bin\mysqld.exe'
        $myIniPath = Join-Path $xamppRoot 'mysql\bin\my.ini'
        Write-Host "Starting XAMPP MySQL from $xamppRoot. The shutdown script will never stop MySQL."
        Start-Process -FilePath $mysqldPath `
            -ArgumentList ('--defaults-file="' + $myIniPath + '" --standalone') `
            -WorkingDirectory $xamppRoot `
            -WindowStyle Hidden | Out-Null

        Wait-ForTcpPort -Port $mysqlPort -TimeoutSeconds 60
        $mysqlListeners = @(Get-PortProcesses $mysqlPort)
        if ($mysqlListeners.Count -ne 1 -or -not (Test-SamePath $mysqlListeners[0].ExecutablePath $mysqldPath)) {
            throw "Port $mysqlPort became occupied by a process that is not the selected XAMPP MySQL instance."
        }
    }

    $phpCommand = Get-Command php.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($phpCommand) {
        $phpPath = $phpCommand.Source
    } else {
        $phpPath = Join-Path $xamppRoot 'php\php.exe'
    }
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $phpPath)) {
        throw 'php.exe was not found on PATH or in the selected XAMPP installation.'
    }
    if (-not $nodeCommand) {
        throw 'node.exe was not found on PATH. Install Node.js before starting JEXOVA.'
    }

    Push-Location $backendRoot
    try {
        $databaseStatus = @(& $phpPath artisan edgeledger:database-status --no-interaction 2>&1)
        $databaseExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $databaseStatus | ForEach-Object { Write-Host $_ }
    $databaseStatusText = $databaseStatus -join "`n"
    if (
        $databaseExitCode -ne 0 `
        -or $databaseStatusText -notmatch '(?m)^Environment:\s*local\s*$' `
        -or $databaseStatusText -notmatch '(?m)^Connection:\s*mysql\s*$' `
        -or $databaseStatusText -notmatch '(?m)^Database:\s*edgeledger\s*$' `
        -or $databaseStatusText -notmatch '(?m)^Status:\s*reachable\s*$'
    ) {
        throw 'Laravel preflight did not confirm local MySQL edgeledger. No application server was started.'
    }

    $backendRecord = @($stateRecords | Where-Object { $_.Kind -eq 'laravel' } | Select-Object -First 1)
    if ($backendListeners.Count -eq 1) {
        $backendProcessId = [int]$backendListeners[0].ProcessId
        Write-Host "Reusing the JEXOVA Laravel backend on port $backendPort."
    } elseif ($backendRecord.Count -eq 1 -and (Test-TrackedProcess $backendRecord[0])) {
        $backendProcessId = [int]$backendRecord[0].ProcessId
        Write-Host "Waiting for the launcher-owned Laravel backend on port $backendPort."
    } else {
        $arguments = '-S 127.0.0.1:8000 "' + $routerPath + '"'
        $process = Start-Process -FilePath $phpPath `
            -ArgumentList $arguments `
            -WorkingDirectory $publicRoot `
            -PassThru `
            -WindowStyle Hidden
        $record = New-TrackedProcessRecord -ProcessId $process.Id -Kind 'laravel' -ExecutablePath $phpPath
        [void]$startedRecords.Add($record)
        $stateRecords = @($stateRecords) + @($record)
        Write-LauncherState $stateRecords
        $backendProcessId = [int]$record.ProcessId
        Write-Host "Started JEXOVA Laravel on 127.0.0.1:$backendPort."
    }

    $deadline = (Get-Date).AddSeconds(45)
    do {
        $listeners = @(Get-PortProcesses $backendPort)
        if ($listeners.Count -gt 0) {
            if ($listeners.Count -ne 1 -or $listeners[0].ProcessId -ne $backendProcessId) {
                throw "Port $backendPort changed owners while Laravel was starting."
            }
            break
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($listeners.Count -eq 0) {
        throw "Laravel did not open port $backendPort within 45 seconds."
    }
    Wait-ForLoginPage -Url 'http://127.0.0.1:8000/login' -TimeoutSeconds 45

    $frontendRecord = @($stateRecords | Where-Object { $_.Kind -eq 'vite' } | Select-Object -First 1)
    if ($frontendListeners.Count -eq 1) {
        $frontendProcessId = [int]$frontendListeners[0].ProcessId
        Write-Host "Reusing JEXOVA Vite on port $frontendPort."
    } elseif ($frontendRecord.Count -eq 1 -and (Test-TrackedProcess $frontendRecord[0])) {
        $frontendProcessId = [int]$frontendRecord[0].ProcessId
        Write-Host "Waiting for the launcher-owned Vite server on port $frontendPort."
    } else {
        $nodePath = $nodeCommand.Source
        $arguments = '"' + $viteEntry + '" --host 127.0.0.1 --port 5173 --strictPort'
        $process = Start-Process -FilePath $nodePath `
            -ArgumentList $arguments `
            -WorkingDirectory $frontendRoot `
            -PassThru `
            -WindowStyle Hidden
        $record = New-TrackedProcessRecord -ProcessId $process.Id -Kind 'vite' -ExecutablePath $nodePath
        [void]$startedRecords.Add($record)
        $stateRecords = @($stateRecords) + @($record)
        Write-LauncherState $stateRecords
        $frontendProcessId = [int]$record.ProcessId
        Write-Host "Started JEXOVA Vite on 127.0.0.1:$frontendPort."
    }

    $deadline = (Get-Date).AddSeconds(45)
    do {
        $listeners = @(Get-PortProcesses $frontendPort)
        if ($listeners.Count -gt 0) {
            if ($listeners.Count -ne 1 -or $listeners[0].ProcessId -ne $frontendProcessId) {
                throw "Port $frontendPort changed owners while Vite was starting."
            }
            break
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($listeners.Count -eq 0) {
        throw "Vite did not open port $frontendPort within 45 seconds."
    }
    Wait-ForLoginPage -Url $loginUrl -TimeoutSeconds 45

    Start-Process -FilePath $loginUrl | Out-Null
    Write-Host "JEXOVA is ready: $loginUrl"
    Write-Host "Backend: http://127.0.0.1:8000"
} catch {
    Write-Host ("JEXOVA startup failed: " + $_.Exception.Message) -ForegroundColor Red

    for ($index = $startedRecords.Count - 1; $index -ge 0; $index--) {
        $record = $startedRecords[$index]
        if (Test-TrackedProcess $record) {
            Stop-Process -Id ([int]$record.ProcessId) -ErrorAction SilentlyContinue
            Write-Host "Stopped launcher-started $($record.Kind) process PID $($record.ProcessId) after startup failure."
        }
        $stateRecords = @($stateRecords | Where-Object { [int]$_.ProcessId -ne [int]$record.ProcessId })
    }

    if ($stateWasRead) {
        try {
            Write-LauncherState $stateRecords
        } catch {
            Write-Host 'Could not update the launcher state file after startup failure.' -ForegroundColor Yellow
        }
    }

    exit 1
}
