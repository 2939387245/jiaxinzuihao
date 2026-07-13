[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$RuntimeRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot '.runtime'))
$StatePath = [IO.Path]::GetFullPath((Join-Path $RuntimeRoot 'processes.json'))
$ExpectedPrefix = $ProjectRoot.TrimEnd('\') + '\'

if (-not $StatePath.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw '运行状态文件不在项目目录内，已拒绝操作。'
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  Write-Host '没有找到由启动脚本记录的运行进程，无需停止。' -ForegroundColor Yellow
  exit 0
}

$state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json
if ([IO.Path]::GetFullPath([string]$state.projectRoot) -ne $ProjectRoot) {
  throw '运行状态不属于当前项目，已拒绝停止进程。'
}

$processes = @($state.processes)
[Array]::Reverse($processes)

foreach ($entry in $processes) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$entry.pid)" -ErrorAction SilentlyContinue
  if (-not $process) {
    continue
  }

  $commandLine = [string]$process.CommandLine
  if (-not $commandLine.Contains([string]$entry.commandContains, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning "PID $($entry.pid) 已被其他程序复用，已跳过。"
    continue
  }

  Stop-Process -Id ([int]$entry.pid) -ErrorAction Stop
  try {
    Wait-Process -Id ([int]$entry.pid) -Timeout 8 -ErrorAction Stop
  }
  catch {
    Stop-Process -Id ([int]$entry.pid) -Force -ErrorAction SilentlyContinue
  }
  Write-Host "已停止 $($entry.name)（PID $($entry.pid)）" -ForegroundColor Green
}

Remove-Item -LiteralPath $StatePath -Force
Write-Host '情侣空间后端和 Tunnel 已停止。' -ForegroundColor Green
