[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status', 'Logs')]
    [string]$Action = 'Start'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $generator.Dispose()
    }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $root '.env.local'
$composePath = Join-Path $root 'compose.local.yaml'

function Invoke-LocalCompose {
    param([string[]]$ComposeArgs)

    & docker compose --env-file $envPath -f $composePath @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed (exit $LASTEXITCODE). Use -Action Logs for details, or -Action Stop to stop any services that started."
    }
}

Push-Location $root
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker was not found. Install Docker Desktop, start it with Linux containers, and reopen PowerShell. See deploy/WINDOWS_LOCAL.md.'
    }
    & docker compose version
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose v2 is required. Update Docker Desktop.'
    }
    $engine = & docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Desktop is not ready. Start it, wait until the engine is running, and retry.'
    }
    if ($engine -ne 'linux') {
        throw 'Switch Docker Desktop to Linux containers, then retry.'
    }

    if (-not (Test-Path -LiteralPath $envPath)) {
        if ($Action -ne 'Start') {
            throw 'No .env.local file exists. Run this script without -Action first.'
        }
        $settings = @(
            '# Generated local Docker credentials. Keep this file private and do not commit it.'
            "LOCAL_DB_PASSWORD=$(New-LocalSecret)"
            "LOCAL_SESSION_SECRET=$(New-LocalSecret)"
            'LOCAL_ADMIN_USER=admin'
            "LOCAL_ADMIN_PASSWORD=$(New-LocalSecret)"
        )
        [System.IO.File]::WriteAllLines($envPath, $settings, [System.Text.Encoding]::ASCII)
        Write-Host 'Created .env.local with new random credentials. Existing .env was not changed.'
    }

    switch ($Action) {
        'Start' {
            Invoke-LocalCompose -ComposeArgs @('up', '--build', '--detach', '--wait', '--wait-timeout', '240')
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/health' -TimeoutSec 10
            if ($health.ok -ne $true) {
                throw 'The frontend API proxy health check failed. Use -Action Logs for details.'
            }
            Write-Host ''
            Write-Host 'Ready: http://127.0.0.1:5173'
            Write-Host 'Sign in using LOCAL_ADMIN_USER and LOCAL_ADMIN_PASSWORD from .env.local.'
            Write-Host 'Services keep running after PowerShell closes.'
            Write-Host 'Stop without deleting data: .\scripts\start-local.ps1 -Action Stop'
        }
        'Stop' {
            Invoke-LocalCompose -ComposeArgs @('down')
            Write-Host 'Services stopped. Database data and .env.local were preserved.'
        }
        'Status' {
            Invoke-LocalCompose -ComposeArgs @('ps', '--all')
        }
        'Logs' {
            Invoke-LocalCompose -ComposeArgs @('logs', '--follow', '--tail', '100')
        }
    }
}
catch {
    [System.Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    Pop-Location
}
