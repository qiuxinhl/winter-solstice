# 免费小容量情侣同步后端

此目录提供全新 Supabase Free 项目的 SQL、本地开通程序和前端接入契约。运行时只需要 Windows、Node.js 22+、系统自带的 Windows PowerShell / WinForms；无需 npm 包，无需电脑常开。照片、视频和留言保存在 Supabase，GitHub Pages 只承载静态页面。

已在用户授权下开通并验证真实免费项目；前端使用公开配置连接，私有相册和留言必须登录才能访问。网站地址：[两个人的小屋](https://qiuxinhl.github.io/winter-solstice/)。程序不会自动发送邀请消息。

手机和电脑使用同一个私人邀请链接即可连接同一个小屋，或在页面中输入小屋口令。原本机照片需要在原手机、原浏览器中点击“将本机照片上传到共享相册”，迁移不删除原记录；本机留言也有单独的复制入口。共享相册、共享留言、称呼和纪念日跨设备同步，心愿、记事及未迁移的本机内容仍保存在各自浏览器。

## 免费范围（2026-11-12 核对）

| 项目 | Supabase Free | 本程序的约束 |
| --- | --- | --- |
| 文件存储 | 1 GB | 同一小屋已完成文件与未完成预约合计不超过 **900,000,000 字节**，约 900 MB / 858 MiB |
| 单文件上传 | 50 MB | **50,000,000 字节**；大视频需要先压缩，不支持拆分绕过限制 |
| 数据库 | 每项目 500 MB | 留言、设置、预约记录使用数据库；文件内容使用独立 Storage |
| 普通出站流量 | 每月 5 GB | 查看和下载照片、视频也消耗流量；900 MB 容量限制无法限制观看次数 |
| 缓存出站流量 | 每月另列 5 GB | 是单独计量的缓存额度，不能当成任意请求通用的 10 GB；私有文件不保证享受缓存命中 |
| 空闲项目 | 空闲约一周后会暂停 | 可能需要在控制台恢复，恢复前无法同步；不承诺全年持续在线，不设置保活绕过规则 |
| 活跃免费项目数量 | 每个账号作为所有者/管理员通常最多 2 个 | 新建组织不会绕过个人免费项目数量限制；额度满则停止，不切换付费 |
| 自动备份 / 保障 | Free 不含付费方案的自动备份与服务保障 | 请另外保留重要照片、视频原件 |

新组织默认 Free，订阅以组织为单位。创建项目 API 的 `plan` 字段已弃用且被服务忽略，因此本程序根本不传该字段。程序仅新建组织，并通过组织详情确认 `plan === 'free'` 后创建固定 nano、`ap-southeast-1` 项目；方案字段缺失也会停止。不会复用旧组织、升级、加购、启用高可用、创建收费项目、自动绑定支付信息或用收费资源兜底。Free 不会因本程序的用量自动升级收费，但超额可能被限制服务；平台条款以后可能变化。

官方依据：[价格页](https://supabase.com/pricing)、[计费说明](https://supabase.com/docs/guides/platform/billing-on-supabase)、[Management API](https://supabase.com/docs/reference/api/introduction)、[Storage 访问控制](https://supabase.com/docs/guides/storage/security/access-control)、[Storage 数据库注意事项](https://supabase.com/docs/guides/storage/schema/design)。本地 API 定义核对来源是 `D:/work/xhs/tmp/supabase-management-openapi.json`。

## 开通程序（仅用于全新项目）

当前小屋已经开通，不要重新执行开通程序。以下是为其他全新项目保留的说明；`setup-state.json` 防止意外重建。

先做完全本地检查，不联网、不弹窗：

```powershell
Set-Location -LiteralPath 'D:\work\xhs\output\our-little-world-free'
node --check .\setup-free-room.cjs
node .\setup-free-room.cjs --check
node --test .\setup-free-room.test.cjs
```

**只有主代理获得实际开通授权后**，才运行下面的命令。`--prepare-only` 会真实新建远程组织和项目，完成后端初始化；这里的 prepare 仅表示不发布前端网站。

```powershell
node .\setup-free-room.cjs --prepare-only
```

1. 用户自行在 Supabase 账户设置生成 Personal Access Token，在程序的本地密码框中粘贴。不要通过聊天、命令参数、环境变量、文件或日志传入口令/令牌。浏览器已有登录态不会替代 PAT。
2. 程序只创建全新的默认 Free 组织，确认方案后创建最小 nano 新加坡项目。每 5 秒检查就绪状态，最长等待 10 分钟，并只打印不含凭据的进度。读操作遇到暂时的限流、服务错误或网络故障可继续轮询；创建操作绝不自动重试。
3. 关闭公开注册和匿名登录，执行事务性 SQL，核验私有桶的 50 MB 与照片/视频类型限制，使用仅存于内存的 `service_role` 管理密钥创建共享登录账号；账号邮箱是 `room-login@<projectref>.invalid`，`email_confirm: true`，不需要邮件确认。随机口令长 64 个字符。
4. 使用新账号实际登录，验证空留言读取和容量 RPC，然后退出此验证会话。不写入测试留言、设置或媒体。
5. 在本目录生成 `public-config.js`，公开字段仅有 `address`、`anonKey`、`email`、`provider`、`bucket`；全局变量是 `window.OUR_WORLD_CLOUD`。可直接复制到主站的 `cloud-config.js`。其中 `address` 就是 Supabase 项目 URL。不会生成含口令的配置样例或秘密文件。
6. 用本地只读窗口展示口令和可复制的私人邀请链接。只有点击复制按钮才写系统剪贴板。程序不自动复制、打开或发送链接；关闭窗口后不再持有可供恢复的口令文件。请先妥善保存。

如需先发布网站、再显示私人邀请，推荐主代理运行：

```powershell
node .\setup-free-room.cjs --prepare-only --hold-invite
```

本地管理令牌输入框仍会在开始时出现。后端准备完成后，`setup-state.json` 的 `stage` 变成 `waiting-for-frontend`，`public-config.js` 已可复制发布。程序只保留小屋口令于内存并等待，不显示它。主代理完成前端部署后，另一个终端在本目录写入非秘密标志即可放行本地结果窗口：

```powershell
Set-Content -LiteralPath 'D:\work\xhs\output\our-little-world-free\frontend-ready.flag' -Value 'ready' -Encoding ascii
```

标志内容必须是 `ready`，首尾空白会忽略。每秒检查一次，没有自动超时，不自动打开任何网址。开通前已存在有效标志会直接停止，避免旧标志提前放行。等待期间不要关闭原程序；中断后口令不会被文件恢复。主代理无需读取口令或邀请链接即可完成发布和放行。

邀请链接固定为：

```text
https://qiuxinhl.github.io/winter-solstice/#room=<base64url(JSON)>
```

编码前的 JSON 字段严格是 `{address, secret, provider:'supabase', anonKey, email, bucket}`。`secret` 是这个共享 Auth 账号的登录密码。Base64url 只是编码，不是加密；链接相当于登录凭据。前端读取后应马上用 `history.replaceState` 清理地址栏片段，避免留在截图或后续复制的网页地址中；不得把片段送去统计、日志或外部接口。邀请链接在当前前端接入相应协议后才能使用。

PAT、数据库密码、service_role、登录密码、会话令牌及邀请链接均不写日志和文件、不放入子进程命令行。子进程通过内存管道通信。HTTP 失败只报告固定说明与状态码，不读取并打印错误响应。JavaScript/.NET 的不可变字符串无法保证物理内存擦除；程序会尽早释放引用，正常退出后由操作系统回收。请不要给该程序启用请求体追踪、进程转储或秘密调试日志。

`local-secret-dialog.ps1` 是普通密码输入与结果窗口，不是 OAuth 授权或浏览器登录窗口。若系统策略阻止 PowerShell/WinForms，程序会停止，不调整系统策略。仅用 Node 程序启动该文件，避免将其内部的管道输出直接显示到终端。Windows PowerShell 5.1 需要此文件使用 **带 BOM 的 UTF-8** 保存。

## 中断与恢复

程序在第一次创建请求之前，以独占方式建立 `setup-state.json`，只记版本、时间、阶段以及已知的组织/项目编号。已有状态文件或公开配置时会在弹窗/联网前停止，防止重跑造成重复资源。

创建请求超时可能意味着服务已经创建资源，而本地没收到结果。程序不会猜测是否成功、重复创建、删除项目或恢复旧项目。先在官方项目列表核对进度文件中对应的新组织和项目。不要直接删除状态文件重跑。当前版本没有自动续跑；若决定从头开通，需先自行确认并处理本次残留的空闲资源、免费项目名额，再另行授权开始。**这些处理不属于本程序的自动行为。**

若账号创建后、结果窗口显示前失败，口令不会落盘。需要由项目管理员在 Supabase 安全重置此共享账号口令，再在本地构造私人邀请；不要把管理员密钥或新的口令发到聊天。随机数据库密码也不会保存；以后确需直接连数据库时，可在控制台另行重置。

SQL 以全新项目为前提，一次事务建立表与策略；不是重复执行的迁移或既有后端升级脚本。再次执行会因同名表/桶存在而整体失败，防止悄悄改写旧结构。程序不读取或修改现有前端目录。

## 前端 API 契约

两台设备使用**同一个**受保护账号，通过邮箱和口令分别登录。`author: 'me' | 'partner'` 仅标记显示身份，不代表两个登录账户或彼此隔离的权限。两端登录后的 `auth.uid()` 相同，共享数据；这套初始化不开放多人注册或多小屋管理。

下文请求目标均为公开配置中的 `address`。登录请求使用 `apikey: anonKey`。其他数据与 Storage 请求使用 `apikey: anonKey`、`Authorization: Bearer <access_token>`。**不能用 anon key 或小屋口令直接当作数据请求的会话令牌。** 可用 Supabase JS SDK，或直接 fetch 调用官方端点；本程序本身无 SDK 依赖。

| 用途 | 请求 / 返回 |
| --- | --- |
| 密码登录 | `POST /auth/v1/token?grant_type=password`，JSON `{email,password:secret}`；取得 `access_token`、`refresh_token`、`user.id` |
| 刷新会话 | `POST /auth/v1/token?grant_type=refresh_token`，JSON `{refresh_token}`；保存轮换后的新令牌 |
| 读设置 | `GET /rest/v1/couple_settings?select=me,partner,start_date`；初始是 `[]`，前端可显示本地默认值 |
| 写设置 | `POST /rest/v1/couple_settings?on_conflict=owner_id`，`Prefer: resolution=merge-duplicates,return=representation`，JSON `{owner_id:user.id,me,partner,start_date}` |
| 读留言 | `GET /rest/v1/couple_messages?select=*&order=created_at.desc&limit=100`；更多记录用分页读取 |
| 发留言 | `POST /rest/v1/couple_messages`，JSON `{author:'me'或'partner',text}`，`Prefer: return=representation`；不传 owner 时由数据库填 `auth.uid()`；最多 1000 个数据库字符 |
| 删留言 | `DELETE /rest/v1/couple_messages?id=eq.<uuid>` |
| 读媒体 | `GET /rest/v1/couple_media?select=*&status=eq.ready&order=created_at.desc&limit=100` |
| 找未完成预约 | 同一媒体列表改成 `status=eq.uploading`；保留预约直到完成或用户明确取消，不按时间自动删除 |
| 查容量 | `POST /rest/v1/rpc/couple_storage_usage`，JSON `{}`；直接返回 `{usedBytes,pendingBytes,maxBytes:900000000,maxFileBytes:50000000}` |
| 预约上传 | `POST /rest/v1/rpc/couple_reserve_media`，JSON `{p_name,p_type,p_size}`；直接返回 `{id,path,partSize:50000000}` |
| 确认完成 | `POST /rest/v1/rpc/couple_complete_media`，JSON `{p_id:id}`；直接返回完整媒体对象，`status:'ready'`；会核验 `storage.objects.metadata.size` 等于预约字节数 |
| 释放预约/记录 | `POST /rest/v1/rpc/couple_release_media`，JSON `{p_id:id}`；直接返回 `{id,releasedBytes}`。文件还存在则拒绝，记录不存在则幂等返回 0 |

这三个数据表均有 RLS，只允许 `authenticated` 且 `auth.uid() = owner_id`。匿名角色没有表和 RPC 权限。媒体表仅授权直接读取；写入和删除走 RPC，不能用 REST 修改 `size/status/path/owner_id` 来绕开预约。所有高权限 RPC 固定空 `search_path`，逐一核对当前 UID，不接受客户端传 owner。

上传流程必须依次执行：

1. 获取浏览器 `File.size` 和实际 MIME 类型；文件名为 1–255 字符，类型必须是合法的 `image/...` 或 `video/...`。空 MIME 时先在前端确认正确类型，不使用 `application/octet-stream` 兜底。
2. 预约。已完成和未完成预约共用 900 MB 限额，RPC 使用当前 UID 的事务 advisory lock 计算容量，防止两台设备同时预约超额。
3. 将原始文件内容作为 body，**一次标准上传** `POST /storage/v1/object/couple-private/<path>`，`Content-Type: p_type`、`x-upsert: false`。SDK 对应 `.storage.from(bucket).upload(path,file,{contentType:p_type,upsert:false})`。`path` 是 `<auth.uid()>/<uuid>`，不要附加原文件名或额外目录。
4. 上传成功后调用完成 RPC。`partSize` 仅为单文件上限，**不是分块上传协议**。不实现 TUS、多段大文件、覆盖、移动、复制或签名上传通道。Storage INSERT 策略同时检查桶、路径 UID、未完成预约和可用的实际大小/类型；不提供 UPDATE 策略。
5. 下载可使用已登录请求 `GET /storage/v1/object/authenticated/couple-private/<path>`；或通过 SDK `.createSignedUrl(path,短有效期)` 获取短期读取链接，再交给图片/视频标签。桶是私有的，不能拼公开 URL；签名 URL 不应长期存数据库，也不要每次刷新重新下载整段视频来统计容量。视频交给浏览器按需/范围读取，避免无谓消耗 5 GB 出站额度。
6. 删除或取消时，先 `DELETE /storage/v1/object/couple-private`，JSON `{prefixes:[path]}`，SDK 对应 `.remove([path])`；确认成功后调用释放 RPC，恢复容量。如果还在上传，先终止上传并等待请求结束，再做删除与释放。未上传成功、对象确实不存在时可以直接释放。网络结果不确定时重试查询/删除原路径，不能提前释放预约；也不要在数据库中直接删除 `storage.objects` 行。

每个媒体对象的字段是 `{id,owner_id,path,name,type,size,status,created_at}`。容量 RPC 的 `usedBytes` 仅算 ready，`pendingBytes` 仅算 uploading；前端总占用/剩余空间使用两者之和。上传失败的预约不会自动过期，否则可能误释放另一个设备仍在使用的容量；前端应提供重试或明确取消入口。

留言/设置可以两端手动刷新或在页面重新进入时查询。本交付没有启用 Supabase Realtime publication，也不承诺即时推送；若前端需要自动更新，可只在页面可见时做适度刷新，避免后台无谓请求。

## 验证范围

`node --test setup-free-room.test.cjs` 的 **14 项测试已通过**，全部使用内存替身，不发网络请求、不弹窗口、不创建远程资源。覆盖全流程请求契约、确认免费方案后才能创建、固定机型区域、秘密不进入输出、私有桶/注册核验、未知创建结果不重试、旧记录保护、延后邀请及旧标志拦截、轮询超时和 HTTP 错误脱敏。Node 语法与 PowerShell 语法检查也已通过；没有实际弹出密码窗口。

另外用本地 PGlite 0.5.16 的 PostgreSQL 引擎完整执行了原始 `schema.sql`，**59 项断言已通过**：表 RLS、匿名拒绝、跨 UID 读写隔离、媒体直接写入拒绝、大小与 MIME 校验、私有桶范围、错误 metadata 字段拒绝、完成幂等、删除后释放以及 900 MB 边界。验证只建立内存数据库与本地假平台表，没有创建真实业务数据或物理媒体。事务锁竞争和真实 Storage HTTP 行为未由此证明。

本地 `verify-schema.cjs` 可复用此校验，需要另外提供可信的 `@electric-sql/pglite` 包路径。正式开通程序不需要安装或加载该包。

真实免费组织与项目已创建，已核对关闭公开注册、私有桶配置，并以小屋账号验证登录、空留言读取和容量查询；匿名访问表会被拒绝。未在正式云空间添加测试留言或测试媒体。双设备写入、迁移与视频播放通过本地模拟官方接口验证，真实手机微信的最终播放表现仍受文件格式和网络影响。`/database/query` 官方标记为实验/Beta，接口可能变化；本程序失败后停止，不调用收费替代方案。
