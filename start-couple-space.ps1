[CmdletBinding()]
param(
  [string]$CloudflaredPath = 'E:\Cloudflared\bin\cloudflared.exe',
  [string]$TunnelConfig = 'E:\Cloudflared\config\config.yml',
  [switch]$ApiOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$ApiRoot = Join-Path $ProjectRoot 'apps\api'
$RuntimeRoot = Join-Path $ProjectRoot '.runtime'
$StatePath = Join-Path $RuntimeRoot 'processes.json'
$ApiStdoutPath = Join-Path $RuntimeRoot 'api.stdout.log'
$ApiStderrPath = Join-Path $RuntimeRoot 'api.stderr.log'
$TunnelStdoutPath = Join-Path $RuntimeRoot 'cloudflared.stdout.log'
$TunnelStderrPath = Join-Path $RuntimeRoot 'cloudflared.stderr.log'

function Test-ApiHealth {
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
    return $result.ok -eq $true
  }
  catch {
    return $false
  }
}

function Stop-StartedProcess {
  param([Diagnostics.Process]$Process)

  if (-not $Process -or $Process.HasExited) {
    return
  }

  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath (Join-Path $ApiRoot '.env') -PathType Leaf)) {
  throw '缺少 apps\api\.env。请先从 .env.example 创建正式配置。'
}

if (-not (Test-Path -LiteralPath (Join-Path $ApiRoot 'node_modules') -PathType Container) -and
    -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules') -PathType Container)) {
  throw "尚未安装依赖。请先在 $ProjectRoot 运行 npm install。"
}

$node = Get-Command 'node.exe' -ErrorAction Stop
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null

if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
  $state = Get-Content -LiteralPath $StatePath -Raw -Encoding utf8 | ConvertFrom-Json
  $running = @($state.processes | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
  if ($running.Count -gt 0) {
    throw "情侣空间已经由脚本启动。请先运行 .\stop-couple-space.ps1。"
  }
  Remove-Item -LiteralPath $StatePath -Force
}

if (Test-ApiHealth) {
  throw '8787 端口已有可用的情侣空间后端。请先停止旧的开发进程，再运行本脚本。'
}

$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  throw '8787 端口已被其他程序占用，请先关闭占用程序。'
}

$apiProcess = $null
$tunnelProcess = $null
$previousNodeEnv = $env:NODE_ENV

try {
  $env:NODE_ENV = 'production'
  $apiProcess = Start-Process -FilePath $node.Source `
    -ArgumentList @('src/server.js') `
    -WorkingDirectory $ApiRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ApiStdoutPath `
    -RedirectStandardError $ApiStderrPath `
    -PassThru

  $healthy = $false
  foreach ($attempt in 1..30) {
    if ($apiProcess.HasExited) {
      break
    }
    if (Test-ApiHealth) {
      $healthy = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $healthy) {
    $details = if (Test-Path -LiteralPath $ApiStderrPath) {
      (Get-Content -LiteralPath $ApiStderrPath -Tail 20 -Encoding utf8) -join [Environment]::NewLine
    } else {
      '没有错误日志。'
    }
    throw "后端未能启动：$details"
  }

  if (-not $ApiOnly) {
    if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
      throw "找不到 cloudflared：$CloudflaredPath"
    }
    if (-not (Test-Path -LiteralPath $TunnelConfig -PathType Leaf)) {
      throw "找不到 Tunnel 配置：$TunnelConfig。域名审核期间可用 .\start-couple-space.ps1 -ApiOnly 只启动 API。"
    }

    $tunnelProcess = Start-Process -FilePath $CloudflaredPath `
      -ArgumentList @('--config', $TunnelConfig, 'tunnel', 'run') `
      -WorkingDirectory (Split-Path -Parent $CloudflaredPath) `
      -WindowStyle Hidden `
      -RedirectStandardOutput $TunnelStdoutPath `
      -RedirectStandardError $TunnelStderrPath `
      -PassThru

    Start-Sleep -Seconds 2
    if ($tunnelProcess.HasExited) {
      $details = if (Test-Path -LiteralPath $TunnelStderrPath) {
        (Get-Content -LiteralPath $TunnelStderrPath -Tail 30 -Encoding utf8) -join [Environment]::NewLine
      } else {
        '没有错误日志。'
      }
      throw "Cloudflare Tunnel 未能启动：$details"
    }
  }

  $processes = @(
    [ordered]@{ name = 'api'; pid = $apiProcess.Id; commandContains = 'src/server.js' }
  )
  if ($tunnelProcess) {
    $processes += [ordered]@{ name = 'cloudflared'; pid = $tunnelProcess.Id; commandContains = 'cloudflared' }
  }

  [ordered]@{
    projectRoot = $ProjectRoot
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    processes = $processes
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StatePath -Encoding utf8NoBOM

  Write-Host "后端已启动：http://127.0.0.1:8787（PID $($apiProcess.Id)）" -ForegroundColor Green
  if ($tunnelProcess) {
    Write-Host "Cloudflare Tunnel 已启动（PID $($tunnelProcess.Id)）" -ForegroundColor Green
  }
  else {
    Write-Host '当前使用 ApiOnly 模式，尚未启动 Cloudflare Tunnel。' -ForegroundColor Yellow
  }
  Write-Host "运行日志：$RuntimeRoot"
}
catch {
  Stop-StartedProcess -Process $tunnelProcess
  Stop-StartedProcess -Process $apiProcess
  throw
}
finally {
  $env:NODE_ENV = $previousNodeEnv
}
