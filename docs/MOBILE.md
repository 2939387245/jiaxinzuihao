# Android 与 iPhone 客户端

Lumi 现在使用 Capacitor 把现有 React/Vite 前端打包为原生应用。网页、Android 和后续 iPhone 客户端共用同一套界面与同一个后端，因此功能和数据保持一致，不需要维护三套业务代码。

```text
Web ─────────┐
Android ─────┼─ HTTPS / Socket.IO ── Lumi API ── SQLite + uploads
iPhone ──────┘
```

安装包不硬编码后端域名。首次打开 Android App 时，在登录页展开“服务器设置”，填写 Cloudflare Tunnel 提供的完整 HTTPS 地址并保存。该地址只保存在当前手机中。

## Android 环境

本机默认使用：

```text
Android SDK: E:\Android_sdk\sdk
JDK:         Java 21
应用包名:    xin.jiaxinzuihao.lumi
最低系统:    Android 7.0（API 24）
目标系统:    Android 16（API 36）
```

## 构建 Android APK

在仓库根目录使用 PowerShell 7：

```powershell
.\build-android.ps1
```

脚本会自动完成网页构建、Capacitor 同步和 Gradle 编译，输出文件为：

```text
artifacts\Lumi-android-debug.apk
```

连接已开启 USB 调试的 Android 手机后，也可以构建并安装：

```powershell
.\build-android.ps1 -Install
```

脚本默认让 ADB 使用 `5038` 端口，避免与这台电脑上正在运行的代理程序占用的 `5037` 端口冲突。

当前 APK 使用 Android 调试证书签名，适合你们两个人内部安装。发布到应用商店前，需要另外创建并安全保管正式签名密钥，再生成 release APK 或 AAB。

## 修改前端后的重新打包

平时只需要继续修改 `apps/web`。完成修改后再次运行：

```powershell
.\build-android.ps1
```

如果需要在 Android Studio 中调试原生工程：

```powershell
npm run android:sync -w web
npm run android:open -w web
```

## 数据同步

1. 所有客户端都连接同一个 HTTPS 后端。
2. 登录后，每次 API 请求都携带当前账号的 JWT。
3. 照片、时光、纪念日、清单和聊天数据仍写入运行后端的电脑。
4. Socket.IO 负责通知另一端刷新内容与接收新消息。
5. 更换后端地址时，只需在各手机的登录页重新保存服务器地址。

Android App 本身不保存服务端数据库；它只保存登录令牌、服务器地址和少量浏览器缓存。删除 App 数据或卸载 App 不会删除电脑上的情侣空间数据。

动态照片可以直接以原始 JPG 上传。后端会自动提取其中的视频，并通过 FFmpeg 转成 H.264 MP4；相册中的“动态”标识可打开循环播放器。运行后端的电脑需要能够通过 `ffmpeg` 命令找到 FFmpeg，也可以在 `apps/api/.env` 中通过 `FFMPEG_PATH` 指定完整路径。

## 后续 iPhone 版本

同一套 Capacitor 前端可以继续生成 iOS 工程，但 Apple 的最终编译和签名必须在 macOS + Xcode 上完成。届时可以使用 Mac 本地构建，或使用提供 macOS 构建机的 CI 服务；真机长期安装和 TestFlight 分发需要 Apple Developer 账号。

官方参考：

- [Capacitor Android 文档](https://capacitorjs.com/docs/android)
- [Capacitor iOS 文档](https://capacitorjs.com/docs/ios)
- [Android 命令行工具文档](https://developer.android.com/tools)
