# Android 与 iPhone 版本方案

## 推荐路线

使用 Expo + React Native 做一个 `apps/mobile`，Android 和 iPhone 共用约 90% 的业务代码；不要复制后端。网页、Android、iPhone 都访问同一个线上 API，这就是三端数据同步的核心。

```text
Web ─────────┐
Android ─────┼─ HTTPS / Socket.IO ── Lumi API ── SQLite + 照片存储
iPhone ──────┘
```

服务端已经提供统一能力：

- `POST /api/auth/login`、`POST /api/auth/register`（注册必须使用首个账号提供的一次性邀请码）
- `GET /api/me`、`GET /api/dashboard`
- `/api/moments`、`/api/anniversaries`、`/api/todos`、`/api/messages`
- Socket.IO 事件：`space:updated`、`message:new`

## 创建移动项目

在仓库根目录运行：

```powershell
npx create-expo-app@latest apps/mobile
Set-Location '.\apps\mobile'
npx expo install expo-router expo-secure-store expo-image-picker expo-notifications
npm install socket.io-client
npm install --global eas-cli
eas login
eas build:configure
```

建议目录：

```text
apps/mobile/
├─ app/
│  ├─ (auth)/login.tsx
│  ├─ (tabs)/index.tsx
│  ├─ (tabs)/gallery.tsx
│  ├─ (tabs)/todos.tsx
│  ├─ anniversaries.tsx
│  └─ chat.tsx
├─ src/api/client.ts
├─ src/api/socket.ts
├─ src/store/auth.ts
└─ app.json
```

移动端使用 `EXPO_PUBLIC_API_URL=https://你的-api-域名`。登录得到的 JWT 不放普通本地存储，使用 `expo-secure-store`；照片通过 `expo-image-picker` 选取，再以 `multipart/form-data` 发送到 `/api/moments`。

## 同步规则

1. App 启动时用安全存储中的 JWT 请求 `/api/me`。
2. 所有读写都带 `Authorization: Bearer <token>`。
3. Socket.IO 连接时传 `auth: { token }`。
4. 收到 `space:updated` 后刷新对应列表；收到 `message:new` 时直接追加消息。
5. 弱网时先禁用重复提交；第二阶段再增加离线队列和冲突时间戳。

这样不需要“手机和网页互相传数据”：它们只是同一个空间的三个客户端，数据真相始终在服务端。

## 打包 Android

内部体验包：

```powershell
eas build --platform android --profile preview
```

正式商店包：

```powershell
eas build --platform android
eas submit --platform android
```

EAS 可以在云端生成 Android 安装包并管理签名；内部包可以先只发给你们两个人安装。

## 打包 iPhone

Windows 不能本地运行 Xcode/iOS Simulator，但可以用 EAS 云构建：

```powershell
eas build --platform ios
eas submit --platform ios
```

真机内测推荐 TestFlight。发布到 App Store 或给真机签名安装需要 Apple Developer 账号；EAS 可以协助管理证书和描述文件。

## 最省事的过渡方案

在原生 App 开发完成前，直接把已部署网页在手机浏览器打开并“添加到主屏幕”。当前 Web 已针对 390×844 做响应式适配，两个人可以先用起来，再决定是否值得上架应用商店。

官方参考：

- [Expo EAS Build](https://docs.expo.dev/build/)
- [创建第一个 EAS 构建](https://docs.expo.dev/build/setup/)
- [EAS 分发与提交](https://docs.expo.dev/distribution/introduction/)
