# 数据保存与删除

## 本地后端默认保存位置

从项目根目录执行 `npm start` 或 `npm run dev:api` 时：

- SQLite 数据库：`apps/api/data/lumi.sqlite`
- SQLite 运行文件：`apps/api/data/lumi.sqlite-wal`、`apps/api/data/lumi.sqlite-shm`
- 用户上传照片：`apps/api/uploads/`

可通过后端环境变量 `DATA_DIR` 和 `UPLOAD_DIR` 改到电脑上的其他目录。备份时应先停止后端，再同时复制数据库目录和上传目录。

## 各类数据保存在哪里

- 邮箱、昵称、空间关系：SQLite 的 `users`、`spaces` 表。
- 密码：只保存 bcrypt 哈希，不保存可读明文，无法从数据库还原原密码。可在右上角“设置 → 修改登录密码”更新；修改后该账号其他设备上的旧登录令牌会失效。
- 时光、纪念日、清单、聊天：SQLite 对应业务表。
- 照片：文件保存在 `uploads` 目录，SQLite 只保存照片路径。后端只签发短时有效的私密访问链接，原始 `/uploads` 地址不会公开提供文件。
- DeepSeek API Key：使用 `JWT_SECRET` 派生的 AES-256-GCM 密钥加密后，保存在 SQLite 的 `space_settings` 表；前端只会看到掩码。
- 登录状态：每个浏览器自己的 `localStorage`，键名是 `lumi_token`。退出登录会清除此项。

`JWT_SECRET` 一旦更换，旧 JWT 会失效，网页保存的 DeepSeek API Key 也无法再解密，需要重新填写。

邀请码保存在 `spaces` 表。第二个账号注册成功时会写入使用时间，旧邀请码立即失效；空间达到两人后不能再生成或使用邀请码。

## 在网页内永久删除

点击右上角齿轮，选择“永久删除账号与全部空间数据”，输入当前登录密码和确认文字 `永久删除`。

该操作按双人空间删除，会同时删除：

- 两个人的账号和密码哈希
- 时光及上传照片
- 纪念日、清单、聊天记录
- DeepSeek API 设置
- 双人空间本身

删除不可恢复。如果只想换设备或暂时不用，请使用“退出当前账号”，不要执行永久删除。

## 手工彻底清空

先停止后端，然后删除 `apps/api/data/` 与 `apps/api/uploads/`。再次启动后端会创建一套新数据库。若环境变量把数据目录改到了其他位置，应删除环境变量指向的目录，而不是项目内默认目录。
