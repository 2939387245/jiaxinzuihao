# Lumi · 双人空间

一个前后端分离、适配桌面与手机浏览器的情侣私密空间。对象通过一次性邀请码加入同一空间，可以共同保存照片时光、纪念日、愿望清单和私密消息；更新通过 Socket.IO 实时同步。

## 已实现

- 邮箱登录、账号内修改密码、一次性情侣邀请码，一个空间严格限制两人
- 首页相恋计时、共同数据概览、最近回忆
- 时光轴与相册，支持无图记录、真实照片、放大、编辑与删除
- 共同清单，双方都能新增、编辑、完成与删除
- 纪念日倒计时、编辑与删除
- 私密聊天与实时消息
- DeepSeek 约会灵感与网页内加密 API Key 设置
- 桌面、平板、手机响应式界面
- SQLite 本地持久化、JWT 登录限速、私密照片短时签名链接、上传文件限制与 CORS 配置

## 项目结构

```text
qinglv/
├─ apps/
│  ├─ web/     React + Vite 前端
│  └─ api/     Express + SQLite + Socket.IO 后端
├─ docs/
│  ├─ MOBILE.md
│  └─ DEPLOYMENT.md
├─ qa/         视觉对照与验收证据
└─ docker-compose.yml
```

## Windows 本地运行

PowerShell 7：

```powershell
Set-Location 'E:\code\codex\qinglv'
Copy-Item '.\apps\api\.env.example' '.\apps\api\.env'
Copy-Item '.\apps\web\.env.example' '.\apps\web\.env'
npm install
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- API 健康检查：http://localhost:8787/health

项目不提供演示账号，也不会自动写入示例照片。全新空数据库需要先在本机初始化首个账号：

```powershell
$env:OWNER_EMAIL = '你的邮箱'
$env:OWNER_PASSWORD = '你的密码'
$env:OWNER_NAME = '你的昵称'
npm run account:bootstrap -w '@lumi/api'
Remove-Item Env:OWNER_EMAIL, Env:OWNER_PASSWORD, Env:OWNER_NAME
```

初始化命令只允许在没有任何账号的数据库上运行，不会覆盖已有数据。

## 两个人开始使用

1. 首个账号由本机初始化命令创建，不能从公网自行创建空间。
2. 首个账号登录后，在右上角设置中复制一次性邀请码。
3. 第二个人点击“注册”，填写邀请码；使用成功后邀请码立即失效。
4. 空间达到两人后不再接受注册；清单、纪念日、照片和消息会在两端同步。

## 生产前必须修改

- 把 `JWT_SECRET` 换成随机长密钥。
- 只允许真实前端域名访问 `CLIENT_ORIGIN`。
- 前后端都必须使用 HTTPS。
- 为 SQLite 数据库和 `uploads` 建立自动备份。
- 不要把 `.env`、数据库或上传照片提交到 Git。

Android/iPhone 方案见 [docs/MOBILE.md](./docs/MOBILE.md)，账号与本地数据位置见 [docs/DATA_AND_DELETION.md](./docs/DATA_AND_DELETION.md)。
