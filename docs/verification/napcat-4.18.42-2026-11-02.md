# NapCat v4.18.42 真机验收记录（2026-11-02）

- 验收账号：UIN 166542782
- 运行形态：`pnpm tauri dev` → `target\debug\xiaohanbao-injector-desktop.exe`
- workdir：`%APPDATA%\top.nexari.xiaohanbao.injector\napcat`（`SNOWLUMA_DEV_MODE=1`）
- NapCat Core：4.18.42，`packetBackend=auto` → NativePacketClient，`o3HookMode=1`
- QQ：`napcat\qq\QQ.exe`，`--user-data-dir=napcat\qq-profile`，版本 `9.9.32-50969`
- 平台：win32.x64

## 1. 核心契约核验

| 契约 | 证据 | 结果 |
|---|---|---|
| 收包钩子初始化 | `napcat\logs\launcher-stdout.log` `[PacketHandler] 初始化成功` | PASS |
| 原生客户端 | `[Core] [Packet] 使用 NativePacketClient 作为后端` + `[PacketClient] NativePacketClient Hook 初始化成功 platform=win32.x64` | PASS |
| OlPush 钩子注册 | 实例日志 `[Plugin: xhb-runtime] [xhb-runtime] OlPush receive hook registered; waiting for MsgPush` | PASS |
| NT 内核监听 | `[xhb-runtime] NT message listener attached` | PASS |
| 插件 RPC | `[xhb-runtime] RPC ready for napcat:166542782` | PASS |
| 接收证明（周期） | `[RuntimeBridge] OlPush receive proof ... hookRegistered=true ... callbackErrors=0 msgPushMislabeled=0`（每 ~60s 一条） | PASS |
| rkey | `[OneBot] rkeys loaded: UIN=166542782 count=2`；全日志 0 条 `FetchRkey 失败` / `获取native.rkey失败` / `Native.FetchRkey 已被禁用` | PASS |
| 管道 | `\\.\pipe\NapCat_<pid>`；launcher `Creating pipe` → `Pipe connected successfully` → `Read thread started` | PASS |

`\\.\pipe\XhbRun_<pid>` 在该构建中不存在且不需要：插件走 NapCat 进程内 ctx + RPC 通道，桌面端走 OneBot HTTP 3000 / WS 3001。

## 2. 消息流转实测

```
napcat\logs\<日期>_<时间>.log
03:43:01 [info] 45岁 | 接收 <- 群聊 [$下载(1013708121)] [甜甜の宵小狗(1391100592)] 测试
03:43:03 [info] 45岁 | 接收 <- 群聊 [$下载(1013708121)] [甜甜の宵小狗(1391100592)] 测试2
03:43:09 [info] 45岁 | 发送 -> 群聊 [$下载(1013708121)] [45岁(166542782)] 123
03:43:11 [info] 45岁 | 发送 -> 群聊 [$下载(1013708121)] [45岁(166542782)] 测试

logs\snowluma-<日期>.log
03:43:01 OK [166542782] [Event] 群 [$下载(1013708121)] | [甜甜の宵小狗(1391100592)]: ID:-1537896771 测试
03:43:03 OK [166542782] [Event] 群 [$下载(1013708121)] | [甜甜の宵小狗(1391100592)]: ID:418610755 测试2
03:43:22 [RuntimeBridge] OlPush receive proof ... msgPushFrames=11 ...
```

- 收：2 条真实群消息 → 2 条 `[Event]`，1:1 且无重复投递
- 发：2 条自身上行 → `发送 ->` 双条确认
- 计数：`msgPushFrames` 7 → 11，`callbackErrors=0`，`msgPushMislabeled=0`

## 3. 全量拉取残留检查

| 检查项 | 结果 |
|---|---|
| 成员预拉取 | 已禁用：`[xhb-runtime] native group-member prefetch disabled; 0xFE7 walks are rate-limited` |
| 成员 walk 预算 | `member-list-budget.json` 仅 1 次 walk，限额 5/小时，未触发上限告警 |
| 好友 walk | 仅 1 次 `running 0 103` → `reconciled 1 103`，无循环重扫 |
| 群消息回捞 | 登录后仅 2 次 `background ... SsoGetGroupMsg` |
| 群/好友列表 | `groups loaded: 21` / `friends loaded: 103`，各 1 次 |

## 4. 已修复：`loadNapCat.js` 落位缺陷

**症状**：新版本目录 / 新安装环境下首次登录必崩：

```
A JavaScript error occurred in the main process
Uncaught Exception:
Error: Cannot find module '...\resources\app\loadNapCat.js'
```

**根因**：Windows hook 只把 QQ `package.json#main` 改写成 `qqnt.json` 里的相对入口 `./loadNapCat.js`，并不提供该文件；Electron 以 QQ 自身应用目录 `napcat\qq\versions\<version>\resources\app` 为基准解析，而 staging 只把引导脚本写在 managed Shell 里。

**修复**（injector 仓库）：

- `packages/core/src/runtime/managed-napcat-service.ts`：新增 `stageQqAppBootEntry()`，launch 阶段把生成的引导脚本镜像到 `<qq>\versions\<MANAGED_QQ_VERSION>\resources\app\<entry>`，并用写入后字节数做硬校验；随后打印 `managed QQ bootstrap entry staged: <path>`。release 路径不变（release hook 从内存直接应答同一 open，无需落盘）。
- `tools/prepare-managed-napcat.ps1`：打包断言新增 `loadNapCat.js` 必须存在，并校验 `qqnt.json#main === './loadNapCat.js'`，不一致直接拒绝出包。
- `packages/core/tests/managed-napcat-service.test.ts`：新增两处断言，覆盖普通路径与 Unicode 路径 staging 后 QQ 侧引导脚本存在且内容与 Shell 侧一致。

**真机验证**：手工删除 QQ 侧 `loadNapCat.js` 后触发登录，日志出现且仅出现一条

```
04:14:17 [ManagedNapCat] managed QQ bootstrap entry staged: ...\napcat\qq\versions\9.9.32-50969\resources\app\loadNapCat.js
04:14:18 [PacketHandler] 初始化成功
04:14:19 二维码已保存到 ...\napcat\cache\qrcode.png
```

QQ 侧文件与 Shell 侧 sha256 完全一致（`9986A08C…C0DB`，395 B），未再弹出 JS error 对话框。injector 全量单测 1130 passed / 1 skipped。

## 5. 遗留小问题

1. 启动竞态：登录完成到 XHB 会话 attach 之间约 2 秒窗口内到达的群消息会被插件按 `sessionsEmpty` 丢弃。建议会话建立后回补一次短窗口 `get_group_msg_history`（该通道已验证可用）。
2. 良性告警：`unable to read experimental packet config: ENOENT ...\plugins\xhb-runtime\config.json`（回退默认值）、`[Update] update check failed: github 404`。

## 6. 结论

**验收通过。** v4.18.42 在本机成立：`initHook` 返回状态字符串（`success`）的契约被正确接受，收包 hook 与 OlPush 事件 1:1 通到 XHB 事件层，rkey 无阻断，全量拉取已被限流压制；`loadNapCat.js` 落位缺陷已修复并通过真机验证。
