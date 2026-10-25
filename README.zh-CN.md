# DSH 思考深度

[English](README.md) | 中文

DSH 思考深度是一个**纯宿主插件**，包含两个彼此独立的功能：它让 DeepSeek Harness
中手工声明的**第三方模型**获得**原生**的「推理等级」，也就是输入框旁模型选择器里
那个控件；同时在任务结束、或遇到需要你选择/确认的时候，弹出**桌面提醒**。它不提供
任何自己的界面。

## 为什么第三方模型没有原生档位

原生「推理等级」的档位来自适配器报出的模型能力。pi-ai 适配器是**按路由名**去内置
catalog 里查模型的：

```js
const defaults = catalogModels(provider)   // provider == 路由名，例如 "commandcode"
const base = defaults.get(entry.id)        // 手写路由不在 catalog 里 → undefined
// → reasoning: false
```

所以自定义网关下的模型在 DSH 眼里一律是「不支持思考」，原生控件的档位是空的。
而这些模型 id 在 pi-ai 自带 catalog 里其实**是有记录的**——只是挂在别的 provider
名下，手写路由取不到。

本插件把这份能力在启动时补进配置，原生控件随之可用。

## 它做什么

- **按路由整体判断**：只要某条路由里有**任何一个**模型声明了 `reasoningEfforts`，
  这条路由就视为**由你手工维护**，整条一律不碰——里面留空的模型是你有意为之。
- 只有**完全没有声明**的路由才会被处理，而且是一次性整条补齐：对每个模型按规则表写入
  它应有的档位，必要时同时写入 `compat.thinkingFormat`。
- **只增不改**：任何已声明 `reasoningEfforts` 的模型——一组档位映射，或表示「不能
  思考」的 `false`——原样保留。原生「设置 → 模型」页始终是最终裁决者。
- **触发时机**：启动时、配置变化事件（防抖）、以及每 60 秒一次兜底扫描。配置在运行中
  被绕过事件改动时（例如直接编辑 profile patch），宿主不会通知插件，最迟 60 秒内由兜底
  扫描补上。
- 幂等：补写完成后再扫没有可写项，不会反复写入。

## 一个后果，必须知道

插件自己写的档位，在它眼里同样算「声明」。因此**一条被它补过的路由，此后即被视为手工
维护**：你之后往这条路由里新加模型，不会被自动补写。要恢复自动接管，把该路由所有模型的
`reasoningEfforts` 清空即可；只想给单个新模型加档位，直接在原生「设置 → 模型」里勾选
更方便。

按这条规则，你当前 Profile 里的每条路由都已有声明，所以插件现在不会再改写任何东西——
它的作用变成「新加的整条路由会被自动补齐一次」。

## 随插件附带的档位规则

按模型 id 精确匹配的条目取自 pi-ai 自带 catalog 中该 id 的记录：

| 模型 id | catalog 中的来源 | 写入的 `reasoningEfforts` | `thinkingFormat` |
|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | openrouter（协议一致） | `off: none, low, high, max` | `openrouter` |
| `inclusionai/ling-3.0-flash-sante:free` | openrouter（协议一致） | `off, minimal, low, medium, high` | `openrouter` |
| `poolside/laguna-s-2.1-free` | vercel-ai-gateway（协议不同） | `off, minimal, low, medium, high` | 不写 |
| `claude-opus-5-5` | anthropic（协议不同） | `off, low, medium, high, xhigh, max` | 不写 |

`thinkingFormat` 只在 catalog 记录的协议与路由协议一致时写入——这也是 `llm-pi-ai`
自己继承 catalog compat 块时的判据。

未精确匹配的模型走家族规则（`claude`、`deepseek`、`gpt-*`/`o1+`、`gemini`、`glm`/`zai`、
`kimi`/`moonshot`、`grok`、`mistral`），这些规则是从 catalog 中所有
`openai-completions` 推理模型归纳出来的；家族规则**只补档位、不写 wire 格式**。
其余模型补一组最通用的 OpenAI 兼容档位 `off, low, medium, high`。

## 如何覆盖它的判断

| 想要的效果 | 做法（全部是原生机制） |
|---|---|
| 某个模型不该有思考档位 | 在「设置 → 模型」把该模型的推理档位关掉（写入 `reasoningEfforts: false`） |
| 某个模型只给部分档位 | 在「设置 → 模型」手工勾选（写入完整映射），插件不再改动它 |
| 整条路由都由我手工维护 | 在该路由任意一个模型上声明 `reasoningEfforts`，整条路由即被跳过 |
| 让插件重新接管一条路由 | 清空该路由所有模型的 `reasoningEfforts` |
| 彻底停用插件 | 把插件行设为 `disabled: true` |
| 换用别的 wire 格式 | 在模型上写 `compat.thinkingFormat`（`openai`、`deepseek`、`openrouter`、`qwen` 等） |

## 任务提醒

第二个功能与推理档位扫描彼此独立，默认开启。它会在以下时刻弹出一条 **Windows 通知**：

- 一轮任务结束：`completed`、`error`、`max-tokens` 或 `blocked`——正文包含会话标题、
  失败原因（如果有）以及本轮耗时；
- 模型调用 `ask_user_question` 打开选择界面——正文包含问题文本和前几个选项；
- 出现权限审批请求——正文包含工具名和审批原因。

用户主动停止（`aborted`）、恢复的历史会话、维护任务以及**子代理会话**都不会提醒：
根会话才属于你，子代理的完成结果已经包含在父会话里。插件只监听实时事件追加，因此
回放或恢复会话不会重复提醒。完成提醒有两个来源——精确的 `agent/status: idle` 事件，
以及 `turn/end` 兜底——新的 `turn/start` 会取消尚未发出的提醒，所以任务马上继续时
不会误报「已完成」。

提醒通过 Windows PowerShell 的 WinRT 通知接口发送，复用 PowerShell 已注册的
AppUserModelID 和插件自带的 `icon.png`；不需要联网、不需要额外依赖，也不需要先注册
开始菜单快捷方式。发送是「即发即忘」的：缺少 `powershell.exe`、通知通道被关闭、
专注助手拦截或其他任何失败，都只记 debug 日志，绝不影响正在运行的会话。该功能仅支持
Windows，其他平台会静默跳过。

只想关掉提醒、保留推理档位功能时，在 Profile 的 `cordis.patch.yml` 里覆盖插件行：

```yaml
- id: dsh-thinking-depth
  config:
    notifications: false
```

## 安装

```powershell
# 在本目录打出压缩包，然后安装到当前 Profile
pnpm pack --pack-destination artifacts
dsh plugin --profile desktop add "$PWD\artifacts\dsh-thinking-depth-0.3.0.tgz"
```

重启 DSH（或等宿主重载配置）后生效。插件是宿主插件，没有客户端 bundle，因此不需要
刷新页面来加载它；但原生档位出现在选择器里可能需要重新打开一次选择器。

`dsh plugin` 会在 Profile 目录内运行 pnpm，因此代理与 registry 设置与其他 Profile
安装一致。由 Harness 启动的终端里 `$env:DSH_PROFILE` 就是当前 Profile，也可以不带
`--profile`。

## 写到哪里

写入通过 DSH 的设置服务完成，持久化到当前 Profile 的配置补丁（与原生「设置 → 模型」
页同一条路径），只改 `providers.<路由>.models` 这一个数组，其他字段原样保留。

## 开发

`tools/verify-host.mjs` 直接导入 `index.js`，用一个形状与 `settings.describe()`
相同的描述符驱动规划函数，断言将要写入的确切内容。`tools/verify-notify.mjs`
对提醒文案构建器和安装器做同样的离线检查，安装器由假的主机事件总线驱动。

```powershell
pnpm verify
```

想验证真实的 Windows 通知通道，可以运行冒烟脚本（会弹出一条真实通知，并等待系统显示）：

```powershell
node tools/notify-smoke.mjs "DSH 提醒测试" "「思考深度」通知通道正常。"
```

## 说明与限制

- 只处理声明了 `models` 列表的路由；`models` 位于更低配置层（不在 Profile 补丁里）
  时不做改动，因为没有可扩展的清单。
- 家族规则与兜底规则是**推断**：它们只增加选择器里的选项，不会改变路由默认值，
  因此唯一风险是你主动选了一个网关不接受的档位——那一次请求会失败，改回即可。
- pi-ai 升级后 catalog 记录可能变化；精确条目与家族规则都来自本插件内置的表，
  需要时可随插件一起更新。
- 提醒**仅支持 Windows**，而且有意做成「只看不动」：通知只说明发生了什么，不会激活或
  聚焦 DSH 窗口。Windows 的专注助手和系统通知设置可能拦截它。
- 提醒只根据根会话自己的事件日志判断；子代理的完成已经体现在父会话的结果里，因此不会
  单独弹通知。

## 许可证

MIT。
