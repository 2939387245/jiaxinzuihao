[CmdletBinding()]
param(
  [string]$SdkRoot = 'E:\Android_sdk\sdk',
  [int]$AdbServerPort = 5038,
  [switch]$Install
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$WebRoot = Join-Path $ProjectRoot 'apps\web'
$AndroidRoot = Join-Path $WebRoot 'android'
$ArtifactRoot = Join-Path $ProjectRoot 'artifacts'
$ApkSource = Join-Path $AndroidRoot 'app\build\outputs\apk\debug\app-debug.apk'
$ApkTarget = Join-Path $ArtifactRoot 'Lumi-android-debug.apk'

if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platform-tools\adb.exe') -PathType Leaf)) {
  throw "Android SDK 不完整或路径不正确：$SdkRoot"
}

$java = Get-Command 'java.exe' -ErrorAction Stop
$JavaHome = Split-Path -Parent (Split-Path -Parent $java.Source)
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$(Join-Path $SdkRoot 'platform-tools');$env:Path"

$localProperties = Join-Path $AndroidRoot 'local.properties'
$escapedSdk = $SdkRoot.Replace('\', '\\').Replace(':', '\:')
"sdk.dir=$escapedSdk" | Set-Content -LiteralPath $localProperties -Encoding utf8NoBOM

Push-Location $ProjectRoot
try {
  & npm.cmd run android:sync -w web
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor 同步失败。' }

  Push-Location $AndroidRoot
  try {
    & .\gradlew.bat assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android APK 构建失败。' }
  }
  finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath $ApkSource -PathType Leaf)) {
    throw "构建完成但没有找到 APK：$ApkSource"
  }

  New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null
  Copy-Item -LiteralPath $ApkSource -Destination $ApkTarget -Force
  Write-Host "APK 已生成：$ApkTarget" -ForegroundColor Green

  if ($Install) {
    $adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
    $devices = & $adb -P $AdbServerPort devices
    $readyDevices = @($devices | Select-String "\tdevice$")
    if ($readyDevices.Count -ne 1) {
      throw "需要恰好连接一台已授权的 Android 设备，当前检测到 $($readyDevices.Count) 台。"
    }
    & $adb -P $AdbServerPort install -r $ApkTarget
    if ($LASTEXITCODE -ne 0) { throw 'APK 安装失败。' }
    Write-Host 'APK 已安装到手机。' -ForegroundColor Green
  }
}
finally {
  Pop-Location
}
