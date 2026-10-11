[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    function Invoke-ProjectCommand {
        param([string]$Program, [string[]]$Arguments)
        & $Program @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Program failed: $($Arguments -join ' ')" }
    }
    if ($Install) {
        Invoke-ProjectCommand 'npm.cmd' @('ci', '--no-audit', '--no-fund')
        Invoke-ProjectCommand 'git' @('submodule', 'update', '--init', 'media')
    }
    if (!(Test-Path 'media/logo/logo.png')) { throw 'Initialize the media submodule (use -Install).' }
    Copy-Item -LiteralPath 'media/logo/logo.png' -Destination 'static/logo.png'
    Copy-Item -LiteralPath 'media/logo/logo.svg' -Destination 'static/logo.svg'
    Invoke-ProjectCommand 'npx.cmd' @('eslint', 'src/features/projects/api.ts', 'src/features/projects/booking.ts', 'src/views/Projects.vue', 'src/views/ProjectBooking.vue', 'test/unit/projects.test.js', 'test/unit/projects-view.test.js', 'test/unit/booking.test.js', 'test/unit/booking-view.test.js', '--max-warnings=0')
    Invoke-ProjectCommand 'npm.cmd' @('test', '--', '--runInBand', '--coverage=false', '--runTestsByPath', 'test/unit/projects.test.js', 'test/unit/projects-view.test.js', 'test/unit/booking.test.js', 'test/unit/booking-view.test.js', 'test/unit/route.test.js')
    Invoke-ProjectCommand 'npm.cmd' @('run', 'build')
    Write-Output 'Project tracking UI validation passed.'
} finally { Pop-Location }
