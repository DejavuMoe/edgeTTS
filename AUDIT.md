# edgeTTS 全面审计报告

> **阅读顺序：以本次复核为准。** 本任务开始时根目录已有未跟踪的旧审计稿。为保留原有工作，其内容保存在本文末尾的“历史原稿”中；旧稿不是当前版本的结论，不能据此重复报漏洞或视为安全保证。

## 整改状态（2026-09-15，后续修订）

本节记录基线审计之后的实际整改；原报告的发现、证据和风险范围仍保留在下文，不能把“已修复”理解为完成真实微软、浏览器、容器压力或生产环境资格验证。

| 基线发现 | 状态     | 已完成的代码级整改                                                                                                              |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F01      | 部分完成 | 提供者为音频流设置 120 秒无数据期限并在超时时销毁流/关闭客户端；停机等待限制为 30 秒。排队总期限与跨实例容量仍属于部署策略。    |
| F02      | 已完成   | 音频流改为资源创建即拥有清理责任的迭代器；`return()`/未开始消费/超时均销毁 Readable 并关闭客户端。                              |
| F03      | 已完成   | 分段合成跳过纯空白分段，避免已开始传输后被提供者的非空检查中断。                                                                |
| F04      | 部分完成 | 保留逻辑超时；底层 `msedge-tts` 公开接口不支持取消其 Axios voices 请求，因此不能在不替换/上游修复依赖的前提下承诺物理请求取消。 |
| F05      | 已完成   | 本地预检的 fetch/远端 tag 查询失败关闭；发布 workflow 对镜像查询仅接受明确的 not-found，其他错误失败；版本号拒绝前导零。        |
| F06–F08  | 已完成   | 导入完成不会覆盖后续编辑/清空；初始化 health 与 voices 并行且请求可取消、有 10 秒期限；音频元素挂载后再尝试播放。               |
| F09–F10  | 已完成   | 调整两种主题的辅助文本 token 至 AA 普通文本对比度，根文档语言改为 `zh-CN`。                                                     |
| F11      | 已完成   | Vitest 及 mocker 升级到 `4.1.11`；全依赖 audit 为零。                                                                           |
| F12–F13  | 已完成   | 三语 README 修正许可与上游数据说明，输入 schema 拒绝 XML 1.0 非法字符。                                                         |

新增回归覆盖：未启动迭代的资源回收、静默音频超时、纯空白分段、XML 控制字符、停机截止、异步导入竞争、并行初始化、挂载后播放、SemVer 前导零及远端 fetch 失败关闭。

## 一、本次审计基线与结论

- 审计日期：2026-09-15（执行环境日期）。
- 基线提交：`9c742ba3eac13725f5ae48c955014fd3f7fe1f57`，分支 `main`。
- 基线工作树：已跟踪文件无变更；`AUDIT.md` 为既有未跟踪文件。
- 交付范围：仅补充审计报告，不修改业务代码、依赖、测试断言或系统配置。
- 方法：全项目文件清点、运行时源码与配置审阅、关键测试断言抽查、真实依赖实现追踪、现有测试执行、离线缺陷复现及依赖公告查询。不是“所有测试逐行阅读”，不是生产渗透测试。
- 环境：Node.js `v24.21.0`、pnpm `12.3.4`。

**结论：架构边界清晰，常规请求、鉴权与流式取消已有较好的测试基础，但“所有测试通过”不能推出生产资源生命周期完整或发布流程严格失败关闭。** 本次登记 **13 项发现：高 2、中 7、低 4**；另列部署条件风险和待验证项，不将其混算为已证实漏洞。

优先处理：**合成流与停机缺少有界期限、发布远端查询失败被视为不存在、未开始迭代的资源泄漏、空白分段导致合法请求中断**。前端主要问题是异步导入覆盖新编辑、初始化请求无期限、自动播放时序和无障碍缺口。

本报告描述的是基线版本；“已确认”表示代码路径或离线复现支持结论，不表示已在真实微软服务、生产容器或所有浏览器中成功触发。

### 严重度与证据规则

- **高**：影响进程整体可用性或已发布内容的完整性；仍需满足条目中的触发条件。
- **中**：局部资源泄漏、正常业务失败、用户内容丢失、明显可访问性问题或有适用条件的依赖风险。
- **低**：较小功能错误、文档契约偏差或防御性校验缺失。
- **离线复现**：实际运行了本地合成样例、假上游或组件测试，不调用微软上游。
- **静态确认**：实现能确定缺口；生产影响范围和发生频率尚未测量。

## 二、范围、调用链与信任边界

| 范围                                                          | 审阅重点                                            | 结论概要                                                        |
| ------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `packages/tts-core/src`                                       | 提供者、音频格式、请求与异步音频契约                | 领域层不依赖 HTTP/OpenAI/Fastify/Microsoft 实现                 |
| `packages/shared/src/index.ts`                                | 两种 API 的 Zod 校验、Unicode 计数                  | 严格未知字段检查；voice 字符集/长度和韵律范围已有边界校验       |
| `packages/edge-provider/src`                                  | XML、韵律、连接、取消、超时、真实 `msedge-tts` 实现 | 握手保护较好；迭代前资源所有权和物理请求取消仍有缺口            |
| `packages/tts-service/src`                                    | FIFO 队列、许可、缓存、分段、异常清理               | 分段整会话持有许可；空白段与提供者校验不一致                    |
| `apps/server/src`                                             | 鉴权、路由、流响应、静态文件、停机、日志            | 鉴权先于语音接入限流；有客户端断开取消；无完整执行期限          |
| `apps/web/src`                                                | API、状态竞争、播放、导入、存储、筛选、控件、CSS    | 本地凭据不持久化；部分状态竞争与浏览器生命周期未覆盖            |
| `apps/*/test`、`packages/*/test`                              | 测试目录与关键断言、全量执行结果                    | 595 项通过；假依赖与 jsdom 不能替代真实生命周期和媒体兼容性验证 |
| `Dockerfile`、`compose.yaml`、`deploy/nginx`                  | 网络隔离、运行用户、文件系统、代理超时、脚本清理    | 默认 Compose 加固较好；无宿主资源限额；测试脚本存在固定资源名   |
| `.github/workflows/ci.yml`、`scripts`、`docs/releasing.md`    | 权限、发布、tag/digest、测试接线、回滚              | 权限分离和候选晋升合理；远端错误处理违反失败关闭契约            |
| `package.json`、工作区、lockfile、TS/ESLint/Vite 配置、README | 依赖、工具链、文档一致性                            | 严格 TS；发现开发依赖公告及多语言文档漂移                       |

实际调用链保持为：

```text
HTTP Route → TtsServicePort → TtsService → TtsProvider → EdgeTtsProvider → msedge-tts
```

具体注入仅位于 `apps/server/src/composition.ts`。服务包的生产依赖仅包含领域包；其 smoke 脚本通过开发依赖引用具体提供者，不应误报为生产架构泄漏。

### 数据与访问边界

1. 浏览器向同源 Fastify 发送文本和可选 Bearer Key；开启认证后，声音发现及两个合成端点均受保护。健康检查与静态页面公开是当前明确设计。
2. Fastify 经过 schema 校验后调用服务；服务负责限流排队与分段，提供者负责微软协议、转义及连接。
3. **自托管不等于本地推理**：合成文本会离开部署机器并发送至微软。TXT 的“本地导入”仅表示读取文件时不上传，点击合成后文本仍会发送到服务端和微软。
4. 浏览器 `localStorage` 仅存偏好和收藏；API Key、编辑文本、生成音频没有应用级持久化代码。不能据此保证浏览器扩展、交换分区、反向代理、Docker 环境元数据或上游不会留存数据。
5. 公网安全假设：HTTPS 代理、可靠随机密钥、私有后端监听、不信任任意转发头。当前代码不是多租户隔离平台。

## 三、发现总览

| 编号 | 级别 | 主题                                          | 证据状态                              |
| ---- | ---- | --------------------------------------------- | ------------------------------------- |
| F01  | 高   | 音频阶段、排队及停机没有完整的有界期限        | 静态确认，未做真实黑洞网络实验        |
| F02  | 中   | 未开始迭代就取消/return，提供者资源未关闭     | 单流及分段流均离线复现                |
| F03  | 中   | 合法长文本产生空白段，中途被提供者拒绝        | 离线复现                              |
| F04  | 中   | 声音发现逻辑超时不取消底层 HTTP 请求          | 真实依赖实现确认                      |
| F05  | 高   | 发布查询错误被当作“tag 不存在”，保护可失效    | 本地预检离线复现；CI 同类路径静态确认 |
| F06  | 中   | TXT 导入异步完成可覆盖用户较新的编辑          | jsdom 离线复现                        |
| F07  | 中   | 健康/声音请求无取消与超时，初始化串行阻塞     | 静态确认                              |
| F08  | 低   | 首次生成播放器挂载前调用 play，自动播放未触发 | jsdom 离线复现                        |
| F09  | 中   | 浅色/深色辅助文本对比度不达 AA 普通文本标准   | CSS 色值计算确认                      |
| F10  | 低   | 中文界面文档语言标为英文                      | 静态确认                              |
| F11  | 中   | Vitest 开发依赖命中路径遍历公告               | 依赖扫描确认，未进行漏洞利用          |
| F12  | 低   | README 与当前许可、开发代理、停机语义不符     | 文档与代码交叉确认                    |
| F13  | 低   | API 允许 XML 1.0 非法控制字符                 | 静态确认，未验证上游具体错误表现      |

## 四、详细发现与整改验收

### F01：合成执行与停机缺少有界期限

**位置：** `packages/edge-provider/src/edge-provider.ts:150-172,238-281`；`packages/tts-service/src/synthesis-limiter.ts:59-88`；`apps/server/src/routes/speech.ts:70-95,189-213`；`apps/server/src/shutdown.ts:38-54`。

- 提供者仅对 `setMetadata` 设置默认 10 秒期限；成功建立连接后，对首个音频字节、音频静默间隔、整个合成会话没有超时。
- 路由的 AbortSignal 仅由请求已断开/响应提前关闭触发；FIFO 等待无排队期限。
- 上游保持连接却不再返回音频，且调用者不主动取消时，会话持续持有许可。默认 4 个会话都卡住后，16 个请求等待，新增请求最终得到 503；普通健康检查仍可返回 200。
- 停机只等待 `app.close()`，无内部兜底计时或统一中止活跃任务；再次 SIGTERM/SIGINT 会被忽略。Compose 的 30 秒是外部强杀边界，不是保证长音频正常完成的期限。
- Nginx `proxy_read_timeout 300s` 只限制相邻两次上游读取的间隔，且直接运行服务不受此保护；它不等同于总执行期限。

**建议：** 分别定义排队、首字节/静默间隔和合理的会话总期限；超时必须中止实际连接并释放许可。停机停止接入、允许有限排空，到期取消剩余任务。不要对所有 20,000 字长请求套用过短的统一总超时。

**验收：** 假上游握手成功后永不产出；推进虚拟时间，确认请求终止、连接关闭、下一位排队者获得许可。另用永不完成的 `close()` 测试停机兜底；验证已发送 200 的流以传输错误结束而非伪造完整成功。

### F02：未开始迭代的生成器不执行 finally，实际资源泄漏

**位置：** `packages/edge-provider/src/edge-provider.ts:167-172,238-280`；`packages/tts-service/src/tts-service.ts:36-45,87-98,164-173`。

`toStream()` 已经创建音频流并发送请求，但连接清理及 abort listener 位于 `async *createAudioIterable()` 内部。JavaScript 异步生成器在第一次 `next()` 前不执行函数体；此时调用 `return()` 不进入 `finally`。

服务包装器会释放许可并调用上游 `return()`，因此**许可被释放不代表 WebSocket/Readable 已关闭**。当消费者拿到结果后立即取消、或 HTTP 在首个消费动作前断开，会留下失去服务容量约束的提供者资源。

**复现结果：** 使用真实 `EdgeTtsProvider` + `TtsService` 和假 EdgeClient，对普通、分段两种结果在第一次 `next()` 前调用 `return()`，均观察到 `closeCallCount === 0`、`stream.destroyed === false`。现有服务测试重点检查许可重新可用，未验证这条组合链的连接清理。

**建议：** 在资源创建时就确立清理所有权、注册取消逻辑，并提供即使未启动迭代也有效的 `return()`；保持 close/release 幂等。不要仅在路由处补一个绕过服务边界的 provider close。

**验收：** 两种入口的 return-before-next、abort-before-next、正常完成、提前退出和重复取消都检查底层关闭次数及容量状态。

### F03：无损分段与非空输入校验互相冲突

**位置：** `packages/tts-service/src/text-segmenter.ts:83-136`；`packages/tts-service/src/tts-service.ts:202-208,342-344`；`packages/edge-provider/src/edge-provider.ts:114-116`。

整体非空的文本可以被无损切成纯空白段；服务逐段调用提供者，提供者却拒绝任何 `trim() === ""` 的段。

**离线样例：** `"A".repeat(300) + " ".repeat(301) + "B"` 通过 `NativeSpeechRequestSchema`，但包含纯空白分段。假音频的第一段已被消费，随后失败为 `Text must not be empty`，后面的 `B` 没有合成。实际 HTTP 此时可能已发送 200 和部分音频，不能再用 400/502 JSON 正常报告。

**建议：** 在合成编排处明确“空白段”的处理策略，例如不为纯空白段建立独立上游请求，同时保留分段工具的无损契约；需要停顿语义时明确如何实现。同步规定 `segmentCount` 是文本规划段数还是实际合成段数，避免遥测失真。

**验收：** 前导/中间/尾部超过 300 的空白、连续空行及 CRLF、正常多语言文本均可完整处理；整体纯空白仍由 API 拒绝；不要删除分段无损测试。

### F04：声音发现仅逻辑超时，底层请求继续存活

**位置：** `packages/edge-provider/src/edge-provider.ts:82-110`；`packages/edge-provider/src/client.ts:5-14`；安装的 `msedge-tts/dist/MsEdgeTTS.js:245-249,292-293`；`packages/tts-service/src/voice-cache.ts:45-75`。

当前已通过 `Promise.race` 避免缓存永久等待，旧稿关于“永远卡住同一个 inFlight”的结论不再成立。但真实 `getVoices()` 使用不带 signal/timeout 参数的 `axios.get()`，而 `client.close()` 仅关闭 WebSocket，不会取消该 HTTP 请求。

当底层 HTTP 挂起时，10 秒后应用返回错误、缓存清空 inFlight，下次又能建立新请求，之前的 socket 仍可能存在。并且错误退避只在已有缓存时生效，冷启动快速失败没有负缓存/退避；声音路由也不受语音接入频控约束。

**建议：** 在适配器/上游依赖中实现真正可中止的声音 HTTP 请求；缓存冷启动失败也施加短退避。单纯增加第二个 Promise.race 不能解决 socket 泄漏。

**验收：** 用可观察底层连接的本地假 HTTP 上游测试超时，确认 socket 被销毁而非只检查 `client.close()` 被调用；测试冷缓存连续失败时实际请求次数有界。

### F05：远端查询失败被视为不存在，发布保护不是失败关闭

**位置：** `scripts/release-check.sh:114,134-142`；`.github/workflows/ci.yml:605-623,648-665`。

- 本地预检吞掉 `git fetch` 错误，继续比较可能过期的 `origin/main`；`git ls-remote` 失败也因 `|| true` 变成空输出，被报告为远端 tag 不存在。
- CI 同样将 `docker buildx imagetools inspect ... || true` 的空结果视为版本镜像不存在，继续创建 SemVer alias。
- 查找最高已发布版本时跳过读取失败的版本；若读取更高版本临时失败但后续写入成功，可能错误地下调 `latest`。

**离线复现：** 在项目内创建隔离 Git 仓库，设置本地 `refs/remotes/origin/main = HEAD`，但不配置任何 `origin`，运行预检 `v9.9.9 --skip-tests` 仍退出 0，并输出远端 tag 不存在及预检成功。未对真实仓库创建 tag 或模拟破坏远端。

**影响前提：** 需要发布过程中远端认证、网络或注册表查询发生错误；不是普通匿名 HTTP 用户可以直接覆盖镜像。

**建议：** 区分可信的 404/manifest unknown 与网络、认证、429、5xx；只有明确不存在才允许新建。远端状态无法验证时终止发布；最高版本查询不应悄悄跳过未知状态。将晋升逻辑抽成可测试的最小脚本，避免只测试重写版模拟函数。

**验收：** fetch/ls-remote/inspect 的失败必须导致非零退出；为 404、401、429、5xx、超时分别建模；查询高版本失败时断言完全没有执行版本或 latest 写入。

### F06：TXT 导入会覆盖较新的编辑或清空操作

**位置：** `apps/web/src/App.tsx:232-265,666-671`。

导入版本号仅在新导入和卸载时变化。读取 `file.arrayBuffer()` 未完成时用户继续编辑，或确认清空，版本号不变；旧导入结果仍会执行 `setInput(result.text)`。导入按钮禁用只取决于合成状态，不代表导入读取已完成。

**离线复现：** 延迟 File.arrayBuffer，先触发导入，再输入新的文本，最后让旧读取完成；编辑器变回旧导入文本。现有“较新文件胜出”的保护不覆盖用户手工编辑。

**建议：** 文本编辑、清空和开始合成时使未完成导入失效，或导入期间明确锁定编辑并提供可取消交互。优先采用版本号失效，避免额外状态管理库。

**验收：** 导入→编辑→旧读取完成、导入→清空→旧读取完成、连续两次导入、卸载后完成均不得回滚最新用户意图。

### F07：前端初始化请求无取消和超时，健康检查阻塞声音加载

**位置：** `apps/web/src/api/client.ts:26-45`；`apps/web/src/App.tsx:292-334,349-386`。

`fetchHealth()`/`fetchVoices()` 不接收 AbortSignal、无期限；初始化先 await health 才 fetch voices。健康检查单独挂起会使声音加载和鉴权提示都无法开始；声音请求挂起会让解锁一直处于“验证中”。effect 清理只禁止 setState，不取消网络；普通声音加载失败没有页面内重试入口。

**建议：** 两个初始化请求独立启动，设置可取消的短期限；卸载时取消；提供声音加载重试按钮。状态栏说明健康探针仅反映服务进程，不代表微软合成可用，避免一次“正常”长时间误导。

**验收：** 永不返回的 health 不阻止声音加载；voices 超时后可重试；卸载后网络信号被中止；401 仍进入正常解锁流程。

### F08：首次生成没有触发预期的自动播放尝试

**位置：** `apps/web/src/App.tsx:496-505,958-966`。

`onStreamReady` 先 `setAudioSrc()`，随即检查 `audioRef.current`；但 `<AudioPlayer>` 受 `audioSrc` 条件控制，React 尚未提交挂载，ref 仍为空。没有后续 effect 或 callback ref 在新音频挂载后调用 play。

**离线复现：** 在 Blob fallback 模式完成一次成功生成，播放器和下载链接已渲染，但 mock `HTMLMediaElement.play` 调用次数仍为 0。这不是浏览器 autoplay policy 拒绝，因为根本没有发起播放调用。

**建议：** 在音频 DOM 和新 src 提交后尝试播放，捕获 autoplay 拒绝并保留手动播放。不要用任意 setTimeout 猜测挂载时间。

**验收：** 首次及重新生成都对正确的音频元素调用 play；拒绝自动播放不应清除可手动播放的成功结果；补真实浏览器验证。

### F09：辅助文本的对比度不足

**位置：** `apps/web/src/App.css:6-14,48-56,285-306,719-776`。

正常可见的字符计数、快捷键提示、播放时间、结果元数据使用 `--text-muted`，字号主要为 0.75–0.9rem，并非满足“大文本”豁免的字号。

| 主题     | 前景 / 背景           | WCAG sRGB 对比度 | AA 普通文本最低值 |
| -------- | --------------------- | ---------------- | ----------------- |
| 浅色卡片 | `#787f8c` / `#fbfaf7` | 3.86:1           | 4.5:1             |
| 深色卡片 | `#707784` / `#1e2227` | 3.55:1           | 4.5:1             |

这是基于 CSS token 的计算结果，不是所有屏幕/hover/系统强制色模式的完整检查。禁用控件的豁免不能用于这些正常信息文本。

**建议：** 调整两种主题的辅助文本色；补关键前景/背景配对的对比度测试。当前 `accessibility-contract.test.ts` 主要检查 CSS 字符串存在，不能证明视觉无障碍达标。

**验收：** 所列正常文本均达到 4.5:1；进行 320px 窄屏、200%/400% 缩放、键盘及屏幕阅读器实测，不能只检查 `overflow-x: hidden`。

### F10：页面语言元数据错误

**位置：** `apps/web/index.html:2`；`apps/web/src/App.tsx`。

页面主体和无障碍标签为简体中文，根元素却为 `<html lang="en">`。屏幕阅读器可能选择错误的朗读语言，也影响翻译等辅助功能。

**建议/验收：** 当前单语言页面使用 `zh-CN`；若未来支持多语言，跟随当前 UI locale。加入 DOM 文档语言断言，并以中文屏幕阅读器验证关键控件。

### F11：开发依赖命中 Vitest 路径遍历公告

**证据：** 2026-09-15 执行 `pnpm audit --json` 返回 1，命中 **1 条 GHSA、2 个受影响包条目**：

- 公告：[GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)。
- 标题：Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock。
- 已安装：`vitest@3.2.7`、`@vitest/mocker@3.2.7`；四个带测试的工作区均可达。
- 扫描返回的受影响范围：`>=2.1.0 <4.1.11`；修复版本：`>=4.1.11`；级别 moderate。
- `pnpm audit --prod --json` 返回 0，未命中生产依赖公告。

**边界：** 当前脚本使用 `vitest run`，没有配置公开 Vitest UI；本次未验证该漏洞在项目部署方式下可利用。它是开发/测试供应链风险，不是已经证实的生产 HTTP 任意文件读取漏洞。零公告也不等于零漏洞。

**建议：** 在独立依赖升级任务中确认公告适用条件并升级 Vitest/mocker 到修复版本；可能需要调整 Vite 和测试配置，不应只强制 override 不兼容的子依赖。避免对外开放测试服务器，在 CI 增加全依赖与生产依赖的分层扫描。

**验收：** 依赖树不再含受影响版本，595 项原有测试与新增回归通过；不要通过忽略公告使扫描“变绿”。

### F12：文档契约与实现不一致

**位置及差异：**

1. 三语言 `README*.md:26,419` 描述“逐段申请/释放许可”，实际 `tts-service.ts` 为整个分段会话持有单一许可。
2. 三语言 `README*.md:200` 写 Vite 代理 `/api` 和 `/v1`，实际 `apps/web/vite.config.ts:8-13` 仅有 `/api`；开发时向 5173 请求 OpenAI 路径不会按文档转发。
3. `README.zh-CN.md:435` 宣称 30 秒停机缓冲保证音频完成，与 F01、长文本耗时和 Docker 到期 SIGKILL 不符。
4. `docs/releasing.md` 将 `^v[0-9]+\.[0-9]+\.[0-9]+$` 称为严格 SemVer，但该表达式接受 `v01.2.3` 等带前导零版本。CI 和预检实现一致地偏离 SemVer 规则。
5. README 的“文件不上传”需要明确限定为导入步骤，避免被理解为合成也完全离线。

**建议/验收：** 按当前功能修正文档；如确实要支持 `/v1` 开发代理，再单独修改配置及测试。为版本规则加入前导零反例，统一发布说明。不要为保留陈旧文案恢复已经修复的逐段抢占行为。

### F13：转义 XML 特殊符号不等于验证 XML 字符合法性

**位置：** `packages/shared/src/index.ts:53-69,91-104`；`packages/edge-provider/src/xml.ts:9-10`；`apps/web/src/text-import.ts:72-76`。

API 可接受 `"hello\u0000world"` 等 JSON 字符串；当前转义只替换 `& < > " '`，不会删除/拒绝 XML 1.0 禁止的控制字符。TXT 导入拒绝 NUL，但直接 API 或粘贴输入不共享这一限制。孤立代理项也没有明确处理策略。

**影响：** 畸形 SSML 可能导致上游拒绝或中断；具体微软行为未作 live 验证。此项不是 SSML 注入，也不是已证实的远程执行漏洞。

**建议/验收：** 明确按 XML 合法字符校验并向客户端返回 400，或定义可解释的标准化策略；保留合法 TAB/LF/CR 与 emoji。覆盖 NUL、其他非法控制字符及孤立代理项，不把正常 Unicode 文本粗暴限制为 ASCII。

## 五、部署条件风险与待验证项

以下不计入上述 13 项，避免把设计取舍或尚未复现的推测包装成确定漏洞。

### 5.1 全局频控不提供客户端公平性

`apps/server/src/rate-limit.ts:106-116` 使用固定 `speech-global` key，两个端点合计默认 12 次/10 秒。这是明确的进程容量保护设计；已启用认证时，无效 Key 不会消耗该语音额度。项目仅支持一个共享 Key，不存在可直接称为“跨租户越权”的身份模型。

但合法共享用户或无认证部署下的单一来源，可以持续耗尽所有人的额度；四个长会话也可长时间占据全部许可。公网多人部署应保留全局容量保护，并按可靠的客户端身份增加独立频控/并发限制。不能只删除全局保护；也不能直接信任用户可伪造的 `X-Forwarded-For`。共享 Key 的哈希不会区分不同用户。多进程副本的总容量随副本数增长，当前限制并不跨实例协调。

### 5.2 流式传输不代表常量内存

- `apps/web/src/audio/stream-controller.ts:340-410` 为下载保存全部 chunks，同时追加到 MSE SourceBuffer，没有历史媒体淘汰或字节上限。Blob fallback 同样完整缓冲。长文本、高音质、低速或移动设备可能触发 `QuotaExceededError`；当前 append 失败会终止会话而非保留下载。实际浏览器上限和失败长度未测量。
- 真实 `msedge-tts/dist/MsEdgeTTS.js:224-225` 忽略 `Readable.push()` 的返回值，因此服务层 AsyncIterable 的背压不能保证传递到微软 WebSocket；慢客户端可能令依赖内部缓冲增长。
- `compose.yaml` 未设置内存、CPU、PID 或 tmpfs 大小上限。应基于压测设置容器资源预算，再考虑 MSE 淘汰/下载策略；输入 20,000 码点的限制不是音频字节硬上限。

### 5.3 日志隐私需要字段白名单，而不是“没有显式 input 字段”

应用没有直接打印合成文本的正常路径，依赖日志默认关闭；这两点值得保留。但路由记录完整 `err`、Zod issues，Fastify 默认请求日志含完整 URL，且没有显式 redact 配置。上游错误可能包含 cause、请求配置、URL 或其他意外字段；用户误把凭据放进 URL 时，拒绝 query 认证也不能避免访问日志记录它。

建议：错误仅记录已允许的 name/code、阶段和 request ID；对认证头、URL 敏感 query 及嵌套错误配置实施过滤，用合成标记做“日志中不出现敏感值”的断言。未发现秘密并不等于已证明“零隐私泄漏”；本次未扫描真实运维日志、私有环境文件或完整 Git 历史。

### 5.4 安全响应头与 TLS 的边界

当前 Fastify 全局设置 `X-Frame-Options: SAMEORIGIN`，Nginx 隐藏上游同名头后统一添加；旧稿缺少防嵌入头的结论已失效。Nginx 还有 nosniff 和 Referrer-Policy。

CSP、HSTS、Permissions-Policy 仍未配置；这属于纵深防御，不等于已发现 XSS。生产 CSP 应兼容当前 blob 音频及运行时样式，HSTS 应由拥有域名/TLS 策略的部署方决定。`deploy/nginx/test-proxy.sh:121-128` 目前显式禁止 CSP/HSTS，后续加固需要同步改变契约，而不是绕过测试。敏感文本系统还需 TLS 证书续期、访问日志保留、密钥轮换与上游数据处理政策。

### 5.5 上游依赖故障隔离仍需验证

真实 `msedge-tts` 消息处理直接访问请求 ID 对应的 `_streams`，销毁音频流会删除该条目；迟到帧/未知请求 ID、畸形帧可能触发事件回调中的未捕获异常。`_send(request).then()` 也未显式接 rejection。这里与普通 Promise/Readable 错误不同，路由 try/catch 不一定能拦住事件回调异常。

本次仅确认依赖实现，没有构造真实 WebSocket 竞态，也不将其计为已证实远程崩溃。建议用本地假 WebSocket 验证取消后迟到音频/turn.end、错误请求 ID、发送失败；优先推动依赖修复，不依赖进程级 uncaughtException 后继续运行。

### 5.6 发布与测试基础设施的其他边界

- Actions 固定 SHA、默认只读 contents，发布作业才持有 packages:write；未使用 `pull_request_target` 执行不可信提交。这些保护有效。
- 基础镜像使用版本 tag 而非 digest；候选晋升不重建，但“重跑整个工作流”仍会重建候选，不能保证相同 Git SHA 得到相同 OCI digest。发布回滚应继续使用已记录的 digest。
- SBOM/provenance 存在性检查不等于独立可信签名身份验证或 SLSA 级别认证；本次未核验远端 GHCR 产物、实际仓库 Rulesets、Action SHA 对应内容或宿主镜像漏洞。
- `scripts/test-release-guard.sh` 的 53 项测试没有接入根 `pnpm test` 或 CI quality；部分测试模拟重写发布算法，而非执行实际 CI 脚本，容易漏掉 F05。将其接入并增加远端错误分支，比增加更多重复成功场景更有效。
- Nginx 测试固定容器名，cleanup 对这些名称执行 `docker rm -f`，并匹配删除 `/tmp` 下共享文件；只适用于独占测试环境。建议所有资源使用本次运行唯一后缀，清理仅限本次创建的资源。本次未运行该脚本，避免触及项目外目录/既存容器。

## 六、前端、产品逻辑与可维护性补充结论

### 已有可靠设计

- React 文本节点渲染声音元数据，没有发现 `dangerouslySetInnerHTML`/eval 等主动执行文本路径；导入文件不解析 HTML，也不上传原文件。
- 合成 generation ID 与播放器 session ID 分别保护旧请求回调、Object URL 生命周期；取消后不应混入新会话结果。下载文件名不包含原始合成文本。
- 收藏/偏好读取有类型与范围防御，存储异常会降级；收藏上限 128，非法/重复条目受到限制。
- Checkbox、Slider 使用原生 input；自定义 Select 有 ARIA combobox/listbox、方向键、Home/End、Escape 等导航。焦点样式与 reduced-motion 已存在，但不代表所有可访问性标准达标。
- 分段工具按码点处理，不切开代理对，并有边界与较大输入测试。无损码点分段不保证保留 grapheme cluster（如组合字符、ZWJ emoji）的语音语义，需要产品层明确这一限制。

### 尚需真实环境验收

1. Chrome/Firefox/Safari 的 MP3 MSE、Blob fallback、重复 MP3 段拼接的 duration/seek 行为与首音延迟。
2. 长音频在暂停、不自动播放、后台标签页、低内存设备下的 SourceBuffer 行为。
3. 自定义 Select 在移动端触控、虚拟键盘、屏幕阅读器中的焦点与展开位置；播放器错误事件目前没有清晰用户提示，`play()` 失败被静默吞掉。
4. 大文本直接粘贴没有输入时的硬上限；虽不能提交超过 20,000 码点的请求，但页面仍会保存并统计超长文本。需先测量再决定粘贴截断/提示策略，不引入复杂编辑器。
5. 健康检查应保持廉价 liveness；若需要 readiness/容量可观测性，另加无敏感文本的缓存年龄、活跃/排队数、超时/取消/流中断指标，而不是每次健康探针都请求微软。

### 复杂度审计（不建议破坏既定分层）

- **native:** `apps/web/src/ui/AudioPlayer.tsx` 的自绘播放控件约 222 行；若不再要求当前外观，可用原生 `<audio controls>` + 下载链接替代。当前先修生命周期/错误提示，不因“简化”删除明确 UI 要求。
- **shrink:** `apps/server/src/routes/speech.ts` 两个入口重复的取消监听、流发送与错误映射可在后续修改时提取小型共享函数；不引入通用路由框架。
- **shrink:** `apps/web/src/ui/Select.tsx` 顶层选项与分组选项 JSX 重复，可复用一个选项渲染函数；只有两个选项的 quality 下拉若允许可改为原生 select。
- voice 校验和 Unicode 计数存在局部重复，但不同包有明确依赖边界；为删除十几行而让领域/服务依赖 HTTP schema 包并不值得。
- 不建议删除 `TtsProvider`、`TtsServicePort`、EdgeClientFactory：它们承担仓库明确要求的架构隔离与假上游测试职责，不是仅凭“只有一个实现”即可判定的过度设计。

保守估计：允许切回原生播放器并合并明显重复片段时，可减少约 200–300 行，**无需增加依赖，也未确认能移除任何现有依赖**。此估计不是实测 diff，本次没有实施重构。

## 七、验证记录与证据局限

| 检查                                              | 本次结果                  | 说明                             |
| ------------------------------------------------- | ------------------------- | -------------------------------- |
| `pnpm build`                                      | 通过，退出 0              | 全工作区与前端构建               |
| `pnpm typecheck`                                  | 通过，退出 0              | 严格 TS 检查                     |
| `pnpm lint`                                       | 通过，退出 0              | ESLint                           |
| `pnpm test`                                       | 通过，退出 0              | 27 个测试文件、595 项测试        |
| `pnpm format:check`                               | 通过，退出 0              | 格式检查                         |
| `git diff --check`                                | 通过，退出 0              | 空白错误检查                     |
| `bash -n scripts/*.sh deploy/nginx/test-proxy.sh` | 通过                      | 仅语法，不代表运行合同通过       |
| `scripts/test-release-guard.sh`                   | 53/53 通过                | TMPDIR 限定在项目内隔离目录      |
| `pnpm audit --prod --json`                        | 退出 0，0 公告条目        | 数据库快照，不是无漏洞证明       |
| `pnpm audit --json`                               | 退出 1，2 moderate 包条目 | 同一 GHSA，见 F11；未修复        |
| 额外 Node 离线复现                                | 通过缺陷观察断言          | F02 单流/分段、F03、F09          |
| 额外 jsdom 离线复现                               | 2/2 通过缺陷观察断言      | F06、F08；不是修复回归已通过     |
| 隔离 Git 发布预检                                 | 复现错误成功，退出 0      | 没有 origin 仍被报告成功，见 F05 |

原有测试分布：edge-provider 49、tts-service 153、server 147、web 246。额外复现使用临时文件，结束后移除，不改变正式测试套件；关键 Node 复现保存在下一节，方便后续转成永久回归。

**没有执行：** 微软 live smoke、真实语音质量检查、真实浏览器 E2E/屏幕阅读器测试、负载测试、Docker 构建与容器/OS 漏洞扫描、Nginx 容器测试、线上攻击测试。依赖公告查询会访问包安全数据库，但不会发送合成文本或凭据。

**不是整改完成：** 报告交付与项目无缺陷是两件事。F01–F13 均未由本任务修复；全依赖扫描仍非零。每项整改应在独立变更中保留原有测试并补充对应反例。

## 八、可重复运行的最小离线证据

在根目录先 `pnpm build`，再执行下列代码。它只使用假 EdgeClient，不建立真实上游连接；断言描述的是**当前缺陷**，修复后这些缺陷观察断言应失败，并改为相反的正确性断言纳入正式测试。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EdgeTtsProvider } from './packages/edge-provider/dist/index.js';
import { TtsService } from './packages/tts-service/dist/index.js';
import { NativeSpeechRequestSchema } from './packages/shared/dist/index.js';

for (const segmented of [false, true]) {
  let closes = 0;
  const stream = Readable.from([Buffer.from('audio')]);
  const provider = new EdgeTtsProvider(() => ({
    getVoices: async () => [], setMetadata: async () => {},
    toStream: () => ({ audioStream: stream }), close: () => { closes++; },
  }));
  const service = new TtsService(provider);
  const request = { text: 'example', voice: 'en-US-AriaNeural' };
  const signal = new AbortController().signal;
  const result = segmented
    ? await service.synthesizeSegmented(request, signal, { maxSegmentCodePoints: 300 })
    : await service.synthesize(request, signal);
  await result.audio[Symbol.asyncIterator]().return();
  assert.equal(closes, 0); // F02: permit released, client not closed
  assert.equal(stream.destroyed, false);
  stream.destroy();
}

const input = 'A'.repeat(300) + ' '.repeat(301) + 'B';
const voice = 'en-US-AriaNeural';
assert(NativeSpeechRequestSchema.safeParse({ input, voice }).success);
const service = new TtsService(new EdgeTtsProvider(() => ({
  getVoices: async () => [], setMetadata: async () => {},
  toStream: () => ({ audioStream: Readable.from([Buffer.from('audio')]) }),
  close: () => {},
})));
const result = await service.synthesizeSegmented(
  { text: input, voice }, new AbortController().signal, { maxSegmentCodePoints: 300 },
);
let chunks = 0;
await assert.rejects(async () => {
  for await (const chunk of result.audio) { assert(chunk.length); chunks++; }
}, /Text must not be empty/);
assert(chunks > 0); // F03: audio started before failure
console.log('F02/F03 reproduced without upstream calls');
JS
```

## 九、建议整改顺序与放行条件

1. **第一批：运行时完整性。** F01–F04：资源创建/销毁所有权、有界等待、纯空白分段。以真实提供者适配器 + 假传输组合测试验证，而不只测许可计数或 close mock。
2. **第二批：发布可信性。** F05、F11：远端错误失败关闭，实际发布脚本接入测试，处理开发依赖公告；验证已有版本不会被错误覆盖、latest 不倒退。
3. **第三批：用户体验与可访问性。** F06–F10、F13：防内容覆盖、请求取消/重试、播放提交时序、对比度与文档语言、XML 字符合法性。
4. **第四批：文档与部署资格验证。** F12 和第五/六节：同步三语言 README，完成目标浏览器矩阵、容器/代理资格测试、长文本与慢客户端压测。

每批应执行仓库规定的 build/typecheck/lint/test/format/diff 检查。涉及真实上游集成的修复按仓库协议另行运行 live smoke，并且只使用明确允许的合成样例。不得为了完成审计而直接在生产环境验证 DoS、覆盖发布版本或收集合成文本日志。

## 十、旧稿逐项复核

| 旧编号/说法                            | 当前处理                       | 依据                                                                                 |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| SEC-01：voice 未校验、SSML 注入        | 已修复，不列为当前漏洞         | shared VoiceIdSchema 与 provider isValidVoiceId 双层检查；HTTP/provider 回归测试存在 |
| SEC-02：全局限流导致“跨租户”问题       | 改为部署公平性风险，不认定越权 | 单共享 Key、明确全局预算，见 5.1                                                     |
| SEC-03：声音发现永不超时、缓存永久挂起 | 旧症状已缓解，但资源取消不完整 | 已有 10 秒逻辑超时与 stale/backoff；F04 追踪底层 HTTP                                |
| SEC-04：无 X-Frame-Options             | 已修复                         | Fastify 全局、静态及 Nginx 均有设置和回归                                            |
| ARCH-01：分段间重抢许可导致队列满中断  | 已修复                         | 单个 SegmentedAudioStream 持有整会话许可                                             |
| ARCH-02：HTTP 路由重复分段             | 已修复                         | 路由直接返回 result.segmentCount                                                     |
| ARCH-03：分段允许 WebM 直接拼接        | 已修复                         | synthesizeSegmented 首先拒绝 webm-opus                                               |
| “零隐私泄漏”“不可变供应链”等绝对保证   | 不予采纳                       | 缺少完整日志/运行环境证明，且 F05 与供应链边界明确存在                               |

---

## 历史原稿（保留，不作为当前结论）

> 以下是任务开始时已经存在的未跟踪报告，原有表述保留用于追溯。其行号、问题状态、覆盖程度和绝对安全评价可能过时；当前状态必须以以上独立复核为准。

# edgeTTS 全量代码与安全性深度审计报告 (Code & Security Audit Report)

- **审计基准时间**: 2026-09-15
- **审计目标仓库**: `DejavuMoe/edgeTTS` (`main` 分支)
- **审计方式**: 逐行完整阅读、全代码库静态审计、依赖分析与运行时契约核验
- **审计覆盖范围**: Monorepo 全部工程代码、类型契约、依赖适配器、服务编排、HTTP 路由、WebUI 前端、Docker 容器化与 CI/CD 供应链

---

## 1. 审计范围与工程全景 (Audit Scope & Architecture)

### 1.1 模块与文件覆盖清单

本次审计对仓库中所有被跟踪的代码与配置文件进行了完整逐行阅读：

| 模块 / 路径                  | 职责定位                                                 | 核心文件                                                                                                                                                                                                                                                    |
| :--------------------------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`packages/shared`**        | 共享领域 DTO、Zod 校验契约、字符计数                     | `src/index.ts`                                                                                                                                                                                                                                              |
| **`packages/tts-core`**      | 核心提供商抽象接口与数据契约                             | `src/index.ts`, `src/provider.ts`                                                                                                                                                                                                                           |
| **`packages/edge-provider`** | 微软 Edge Read Aloud TTS (`msedge-tts`) 适配层           | `src/edge-provider.ts`, `src/client.ts`, `src/xml.ts`, `src/prosody.ts`                                                                                                                                                                                     |
| **`packages/tts-service`**   | 业务编排：并发限制器、语音防击穿缓存、长文本自然边界分段 | `src/tts-service.ts`, `src/synthesis-limiter.ts`, `src/voice-cache.ts`, `src/text-segmenter.ts`                                                                                                                                                             |
| **`apps/server`**            | Fastify HTTP 服务端与 Composition Root                   | `src/app.ts`, `src/server.ts`, `src/auth.ts`, `src/rate-limit.ts`, `src/shutdown.ts`, `src/static.ts`, `src/composition.ts`, `src/dependencies.ts`, `src/routes/*`                                                                                          |
| **`apps/web`**               | React 19 + Vite 单页应用（WebUI 工作台）                 | `src/App.tsx`, `src/api/client.ts`, `src/audio/stream-controller.ts`, `src/preferences.ts`, `src/voice-favorites.ts`, `src/voice-catalog.ts`, `src/text-import.ts`, `src/text-stats.ts`, `src/result-metadata.ts`, `src/synthesis-telemetry.ts`, `src/ui/*` |
| **部署与运维**               | 容器与反向代理基础设施                                   | `Dockerfile`, `compose.yaml`, `deploy/nginx/edgetts.conf.example`, `deploy/nginx/test-proxy.sh`                                                                                                                                                             |
| **CI / CD 与治理**           | 自动化工作流与发版防御脚本                               | `.github/workflows/ci.yml`, `scripts/release-check.sh`, `scripts/test-release-guard.sh`, `docs/releasing.md`                                                                                                                                                |

### 1.2 架构分层契约遵守情况

项目严格遵守了 `AGENTS.md` 所定义的调用层级：

```text
HTTP Route (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts
```

- **无提供商泄露到 HTTP 层**: HTTP 路由仅依赖 `TtsServicePort`，无任何对 `msedge-tts` 或 `EdgeTtsProvider` 的直接依赖。
- **无基础设施入侵核心领域**: `packages/tts-core` 纯净无外部依赖。
- **服务层解耦**: `packages/tts-service` 仅依赖 `@edgetts/tts-core`，不依赖 `@edgetts/edge-provider`。依赖注入在 `apps/server/src/composition.ts` 完成。

---

## 2. 审计发现总览 (Findings Summary)

根据代码现状事实，共发现 **4 项安全漏洞/风险** 与 **3 项架构/并发边界隐患**：

| 编号        | 类别            |  严重级别  | 标题 / 概要                                                    | 涉及文件与位置                                                                                         |
| :---------- | :-------------- | :--------: | :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **SEC-01**  | 安全性          | **Medium** | `voice` 参数未校验且未转义导致的潜在 SSML 注入                 | `packages/shared/src/index.ts:38,85`<br>`packages/edge-provider/src/edge-provider.ts:90`               |
| **SEC-02**  | 安全性 / 可用性 | **Medium** | 全局入站限流器导致的跨租户/跨用户拒绝服务 (DoS)                | `apps/server/src/rate-limit.ts:110`                                                                    |
| **SEC-03**  | 稳定性 / 可用性 | **Medium** | 上游声音发现 (`listVoices`) 无超时控制引发服务永久阻塞风险     | `packages/tts-service/src/voice-cache.ts:42-60`<br>`packages/edge-provider/src/edge-provider.ts:51-65` |
| **SEC-04**  | 安全性          |  **Low**   | WebUI 缺少点击劫持防护响应头 (`X-Frame-Options`)               | `apps/server/src/static.ts`<br>`deploy/nginx/edgetts.conf.example`                                     |
| **ARCH-01** | 并发架构        | **Medium** | 分段语音合成在并发高峰期可能引发流式播放中断截断               | `packages/tts-service/src/tts-service.ts:179-228`                                                      |
| **ARCH-02** | 架构性能        |  **Low**   | 原生语音合成路由中存在重复的分段计算                           | `apps/server/src/routes/speech.ts:215,219`                                                             |
| **ARCH-03** | 格式兼容        |  **Low**   | `synthesizeSegmented` 对非拼接音频格式（如 WebM-Opus）未做限制 | `packages/tts-service/src/tts-service.ts:289`                                                          |

---

## 3. 安全脆弱性深度审计 (Detailed Security Vulnerabilities)

### SEC-01: `voice` 参数未校验且未转义导致的潜在 SSML 注入 (SSML Injection via Unsanitized `voice` Parameter)

- **严重等级**: **Medium**
- **存在位置**:
  - `packages/shared/src/index.ts`（第 38-40 行、第 85-87 行）
  - `packages/edge-provider/src/edge-provider.ts`（第 90 行、第 96 行）
  - `node_modules/msedge-tts/dist/MsEdgeTTS.js`（第 234 行、第 268 行）

#### 代码现状事实分析

1. 在 `packages/shared/src/index.ts` 中，`SpeechRequestSchema` 与 `NativeSpeechRequestSchema` 对 `voice` 字段的校验仅有非空判断：
   ```typescript
   voice: z.string().refine((val) => val.trim().length > 0, {
     message: "Voice must not be empty",
   }),
   ```
   **未限制字符集（如正则）、未限制最大长度、未限制必须属于合法音色清单。**
2. 在 `packages/edge-provider/src/edge-provider.ts` 的 `synthesize` 方法中：
   ```typescript
   await client.setMetadata(request.voice, formatDetails.outputFormat);
   // ...
   const escapedText = escapeXmlText(request.text);
   const { audioStream } = client.toStream(escapedText, prosodyOptions);
   ```
   系统仅对 `request.text` 调用了 `escapeXmlText` 进行 XML 转义，而 `request.voice` 原样传递给了 `client.setMetadata`。
3. 在底层依赖 `msedge-tts`（`MsEdgeTTS.js`）内部：
   - 提取 locale 时仅使用弱正则：`MsEdgeTTS.VOICE_LANG_REGEX = /\w{2}-\w{2}/`。只要传入的 voice 字符串中任意位置包含 `en-US` 或 `zh-CN`，校验即可通过。
   - 生成 SSML 时执行直接字符串拼接：
     ```javascript
     _SSMLTemplate(input, options = {}) {
         return `<speak version="1.0" ...>
                     <voice name="${this._voice}">
                         <prosody ...>${input}</prosody>
                     </voice>
                 </speak>`;
     }
     ```
4. **危害场景**:
   攻击者可以构造恶意 `voice` 参数（例如 `zh-CN-XiaoxiaoNeural"><mstts:express-as style="cheerful"><prosody>...`），闭合 `<voice name="...">` 标签并注入非预期的 SSML 节点。
   - 篡改语音合成情绪、语调、甚至嵌入未授权的标记语言。
   - 构造畸形 XML 导致微软服务端报 XML 解析错误，引发 502 UPSTREAM_ERROR。

#### 修复建议

1. 在 `packages/shared/src/index.ts` 中对 `voice` 施加严格正则校验，例如：
   ```typescript
   voice: z.string().regex(/^[a-zA-Z0-9-_]+$/, "Voice identifier contains invalid characters").max(128),
   ```
2. 或在 `EdgeTtsProvider` 中对 `request.voice` 同样调用 `escapeXmlText`，防止引号跳出属性。

---

### SEC-02: 全局入站限流器导致的跨租户/跨用户拒绝服务 (Inter-Tenant DoS via Global Speech Rate Limiter)

- **严重等级**: **Medium**
- **存在位置**:
  - `apps/server/src/rate-limit.ts`（第 106-116 行）
  - `apps/server/src/app.ts`（第 62-66 行）

#### 代码现状事实分析

在 `apps/server/src/rate-limit.ts` 中定义了语音合成接口的限流器：

```typescript
export function createSpeechRateLimiter(scope: FastifyInstance, config: SpeechRateLimitConfig) {
  return scope.rateLimit({
    max: config.max,
    timeWindow: config.timeWindowMs,
    keyGenerator: () => "speech-global",
    groupId: "speech-admission",
    errorResponseBuilder: (_req, context) => {
      return new RateLimitedError(RATE_LIMITED_ERROR.error.message, context.statusCode);
    },
  });
}
```

1. `keyGenerator` 强制无条件返回常量 `"speech-global"`。
2. 默认配置 `DEFAULT_SPEECH_RATE_LIMIT_MAX = 12`，`DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS = 10000`（10 秒内最多 12 次请求）。
3. **危害场景**:
   该限流器作用于 Fastify 进程级别，但将所有来源的请求归一为一个全局 Key。
   一旦某个客户端在 10 秒内连续发出 12 次请求（平均只需 1.2 QPS），整个服务实例的全局配额将被耗尽。在此期间，**所有其他合法用户（即便携带合法 API Key 或来自不同 IP）发起请求都会立即收到 HTTP 429 (`RATE_LIMITED`) 响应**。这构成了单用户恶意或突发流量对多用户的拒绝服务攻击（Noisy Neighbor / Inter-Tenant Starvation）。

#### 修复建议

- 将限流划分为两层：
  1. **接入层防滥用限流 (Per-Client Rate Limiting)**: 按客户端 IP 或 `Authorization: Bearer` Token 哈希生成 Key，限制单一客户端突发。
  2. **后端容量保护**: 全局层面的保护应由 `packages/tts-service` 的 `SynthesisLimiter`（信号量与排队机制）负责，而非直接给所有其他用户返回 HTTP 429。

---

### SEC-03: 上游声音发现 (`listVoices`) 无超时控制与缓存雪崩/卡死风险 (Unbounded Timeout in Upstream Voice Discovery & Cache Lockup)

- **严重等级**: **Medium**
- **存在位置**:
  - `packages/tts-service/src/voice-cache.ts`（第 42-60 行）
  - `packages/edge-provider/src/edge-provider.ts`（第 51-65 行）
  - `node_modules/msedge-tts/dist/MsEdgeTTS.js`（第 245-251 行）

#### 代码现状事实分析

1. `EdgeTtsProvider.listVoices()` 调用 `client.getVoices()`，其底层在 `MsEdgeTTS.js` 中使用 `axios.get(MsEdgeTTS.VOICES_URL)` 发送 HTTP 请求。
2. `axios` 默认的 `timeout` 是 `0`（无限等待）。
3. 在 `packages/tts-core/src/provider.ts` 中，`listVoices(): Promise<readonly TtsVoice[]>` **不支持传入 `AbortSignal`**。
4. 在 `packages/tts-service/src/voice-cache.ts` 中：
   ```typescript
   if (this.inFlight !== null) {
     return this.inFlight.then(cloneVoices);
   }
   const fetchPromise = (async () => {
     try {
       const voices = await this.provider.listVoices();
       // ...
       return snapshot;
     } finally {
       this.inFlight = null;
     }
   })();
   this.inFlight = fetchPromise;
   ```
5. **危害场景**:
   如果微软的 `VOICES_URL` 连接出现网络挂起（如 TCP 黑洞、中间代理假死），`axios` 将永远等待。
   此时 `inFlight` 永远不会变为 `null`，`VoiceCache` 会将所有后续调用重定向到该挂起的 Promise 上。整个服务进程的 `/api/voices` 端点将永久处于挂起状态，无法自愈，直到服务被外力杀死。

#### 修复建议

1. 在 `TtsProvider.listVoices` 接口中增加 `signal?: AbortSignal` 支持。
2. 在 `EdgeTtsProvider` 中使用带硬超时（如 10 秒）的 `AbortSignal.timeout(10_000)` 保护上游请求。
3. 在 `VoiceCache` 中实现过期后的弹性降级（如遇到网络错误时返回过期缓存并记录警告，而非直接中断）。

---

### SEC-04: WebUI 缺少点击劫持防护响应头 (Missing Clickjacking Protection on WebUI)

- **严重等级**: **Low**
- **存在位置**:
  - `apps/server/src/static.ts`（第 61-73 行）
  - `deploy/nginx/edgetts.conf.example`（第 45-48 行）

#### 代码现状事实分析

1. `apps/server` 作为独立应用时，未集成 `@fastify/helmet` 或手动设置 `X-Frame-Options`。
2. 在 `deploy/nginx/edgetts.conf.example` 中，仅配置了：
   ```nginx
   add_header X-Content-Type-Options "nosniff" always;
   add_header Referrer-Policy "same-origin" always;
   ```
   **未包含 `X-Frame-Options: SAMEORIGIN`（或 `DENY`），也未设置 CSP `frame-ancestors`。**
3. **危害场景**:
   任意第三方网站可以通过 `<iframe>` 将 edgeTTS 的 WebUI 嵌入在其页面中，实施点击劫持（Clickjacking），诱骗用户在不知情的情况下点击“合成语音”、“清空”或触发大批量语音合成。

#### 修复建议

在 Nginx 模板及 Fastify 静态托管响应中增加 `X-Frame-Options: SAMEORIGIN` 响应头。

---

## 4. 并发控制与架构隐患审计 (Concurrency & Architecture Findings)

### ARCH-01: 分段语音合成在并发高峰期可能引发流式播放中断截断 (Segmented Synthesis Mid-Stream Starvation & Error)

- **严重等级**: **Medium**
- **存在位置**:
  - `packages/tts-service/src/tts-service.ts`（`SegmentedAudioStream`，第 179-228 行）
  - `packages/tts-service/src/synthesis-limiter.ts`（第 59-90 行）

#### 代码现状事实分析

1. `TtsService.synthesizeSegmented` 将长文本分拆为若干片段（如 300 字符/段）。
2. 在 `SegmentedAudioStream` 的迭代器循环中：
   - 第 0 段在返回 `SegmentedAudioStream` 前已合成并持有了 Permit 0。
   - 当第 0 段音频数据消费完毕，其内部的 `ManagedAudioStream` 触发 `releaseOnce()`，Permit 0 被**释放回池中**。
   - `SynthesisLimiter.dispatchNext()` 会优先将该空闲许可分发给等待队列最前端的其他请求。
   - 随后，`SegmentedAudioStream` 进入第 1 段的合成：
     ```typescript
     const nextResult = await this.service.synthesize(
       { ...this.request, text: this.segments[this.currentSegmentIndex]! },
       this.signal,
     );
     ```
3. **并发缺陷场景**:
   - 如果此时服务正处于高并发状态，等待队列已满（`queue.length >= maxQueued`），`this.service.synthesize` 会立即抛出 `SynthesisQueueFullError`！
   - 但是此时 HTTP 响应已向客户端发送了 `200 OK` 及部分音频数据！
   - 结果：客户端正在播放第 0 段音频，流突然无预警中断（抛出错误并在后端触发 `Audio stream error occurred during native playback`），用户收到一段残缺不全的音频。
   - 即使队列未满，分段之间的许可争抢也会导致长音频在段与段之间出现不可预期的停顿或等待延迟。

#### 修复建议

- 为多段连续任务设计“许可延续”或“会话优先级”机制，避免长任务在播放一半时因排队被抢占而异常中断。

---

### ARCH-02: 原生语音合成路由中存在重复的分段计算 (Redundant Text Segmentation in `/api/speech`)

- **严重等级**: **Low**
- **存在位置**: `apps/server/src/routes/speech.ts`（第 215 行与第 219 行）

#### 代码现状事实分析

在 `POST /api/speech` 的处理程序中：

```typescript
// 第一次分段计算：仅为了获取 segments.length 设置响应头 X-EdgeTTS-Segment-Count
const segments = segmentText(validatedBody.input, {
  maxCodePoints: NATIVE_SEGMENT_CODE_POINTS,
});

// 第二次分段计算：在 ttsService.synthesizeSegmented 内部第 311 行又执行了一次完全相同的 segmentText
const result = await ttsService.synthesizeSegmented(domainRequest, controller.signal, {
  maxSegmentCodePoints: NATIVE_SEGMENT_CODE_POINTS,
});
```

- 输入长达 20,000 字符时，`segmentText` 会执行两次完整的 O(N log N) 正则扫描与二分查找分段，虽然没有安全性风险，但浪费了 CPU 算力与内存。

#### 修复建议

重构 `synthesizeSegmented`，允许直接传入已计算好的 `segments`，或使其返回结果中携带分段元数据。

---

### ARCH-03: `synthesizeSegmented` 对非可拼接音频格式（WebM-Opus）未做限制 (Format Incompatibility in Segmented Audio)

- **严重等级**: **Low**
- **存在位置**: `packages/tts-service/src/tts-service.ts`（第 289 行）

#### 代码现状事实分析

1. `packages/tts-core` 定义了音频格式：`TtsAudioFormat = "mp3-48k" | "mp3-96k" | "webm-opus"`。
2. `SegmentedAudioStream` 的拼接逻辑是将各个片段的原始二进制字节流直接顺序 `yield` 给消费者。
3. **技术事实**:
   - MP3 格式由于是无容器、依靠帧同步字（Frame Sync Word）定位的流式格式，直接拼接各个片段的 MP3 字节流，大部分解码器（浏览器、FFmpeg）均能连续平滑解码。
   - **WebM-Opus 是 EBML 容器格式**，包含 EBML Header、Segment、Tracks 及 Clusters。
   - 如果对 WebM 音频直接拼接待续流，在第 1 段结尾遇到第 2 段的 EBML Header 时，解码器会判定文件损坏或提前终止播放。
4. **现状**:
   虽然目前 `apps/server` 的路由只开放了 `standard` 与 `high`（均映射为 MP3），避开了该问题；但领域服务层 `TtsService.synthesizeSegmented` 未对 `request.format === "webm-opus"` 进行校验或拦截，若未来扩展格式，将直接导致输出损坏音频。

---

## 5. 安全性与合规设计亮点 (Security & Privacy Strengths)

在逐行审计中，本代码库在隐私保护、密码学防护、边界校验与供应链安全上展现了极高的工程标准：

### 5.1 零明文语音输入日志泄露 (Zero Text Payload Logging)

- 严格审计了 `apps/server/src/routes/speech.ts`、`packages/edge-provider` 及 `packages/tts-service` 中的所有日志调用（`request.log.error`、`request.log.warn`）。
- 系统仅记录了 `voice`、`model`、错误对象 `err`，**没有任何一处代码记录用户输入的文本内容（`input` / `request.text`）**，彻底避免了用户隐私数据泄露至集中日志系统的风险。

### 5.2 恒定时间密码学校验 (Timing-Safe API Key Verification)

- 在 `apps/server/src/auth.ts` 中，API Key 校验采用了业界标准的固定长度 SHA-256 哈希后再通过 `crypto.timingSafeEqual` 对比：
  ```typescript
  const configuredHash = crypto.createHash("sha256").update(configuredKey).digest();
  const candidateHash = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(configuredHash, candidateHash);
  ```
  不仅规避了传统字符串比较的时序攻击（Timing Attack），同时因 SHA-256 输出固定 32 字节，规避了 `timingSafeEqual` 在输入长度不同时抛出异常的陷阱。
- 规定了 API Key 最小长度限制（>= 16 字符）并严禁包含空格字符。

### 5.3 WebUI 严格内存持有凭据 (Zero Credential Leakage in Browser Storage)

- 审计 `apps/web/src/App.tsx` 与 `apps/web/src/preferences.ts`：
  - 用户输入的 API Key 严格保存在 React 组件内存 `apiKeyRef` 中，**从未保存至 `localStorage` 或 `sessionStorage`**。
  - `localStorage` 仅用于持久化无敏感性的 UI 偏好（`voiceId`, `quality`, `speed`, `pitchSemitones`, `volume`）及收藏列表（`voice-favorites`）。
  - 在读取本地存储时，提供了严格的运行时类型与边界防御（`validateWorkbenchPreferences`, `validateFavoriteVoiceIds`），防止损坏或篡改的本地数据造成页面奔溃。

### 5.4 严格的本地文件导入沙箱 (Safe Text Import)

- 审计 `apps/web/src/text-import.ts`：
  - 校验文件后缀必须为 `.txt`。
  - 限制文件大小不超过 256 KiB。
  - 使用严格 UTF-8 解码器（`fatal: true`），格式损坏立即拒绝。
  - 自动识别并剥离 UTF-8 BOM（`\uFEFF`）。
  - 显式检测并拒绝包含 NUL 字节（`\u0000`）的伪装二进制文件。
  - 强制限制 Unicode Code Points 不超过 20,000 上限。

### 5.5 极高等级的容器沙箱加固 (Hardened Container Runtime)

- 审计 `Dockerfile` 与 `compose.yaml`：
  - 运行于普通用户 `node`（UID 1000），非 root 运行。
  - 容器根文件系统挂载为完全只读（`read_only: true`）。
  - 丢弃所有 Linux 内核特权（`cap_drop: ALL`）。
  - 阻止特权提升（`no-new-privileges: true`）。
  - 仅开放临时可写目录 `/tmp`（以 `tmpfs` 形式挂载）。
  - 默认绑定仅限本地回环接口（`127.0.0.1:8080`），防止直接暴露于公网。

### 5.6 严密的发版防篡改与供应链治理 (Immutable Supply Chain)

- 审计 `.github/workflows/ci.yml`、`scripts/release-check.sh` 与 `docs/releasing.md`：
  - 严格 SemVer 格式正则校验（`^v[0-9]+\.[0-9]+\.[0-9]+$`），禁止任何 Prerelease 标签污染生产线。
  - 拒绝移动已存在的发布 Tag（校验 `event.before == 0000000000...`）。
  - 发布候选与正式镜像促进分离（Zero-Rebuild Promotion），利用 OCI Index Digest 保证完全一致性。
  - 强制附加 SLSA Provenance (`mode=max`) 与 SPDX SBOM 凭证。
  - 自动审查多架构镜像（amd64 / arm64）的构建历史与文件系统，严禁包含 token、密钥与私有文件。

---

## 6. 综合审计结论与改进路线 (Conclusions & Recommendations)

总体而言，`edgeTTS` 架构分层高度严谨、工程化完成度极高、类型契约完整，具有优异的隐私保护和容器安全加固。当前系统在防御网络恶意利用方面已具备高标准的防御纵深。

为进一步提升系统的企业级稳健性与安全性，建议在后续开发中优先实施以下修复：

1. **[高优先级] 修复 SEC-01 (SSML 注入隐患)**:
   在 `packages/shared/src/index.ts` 中将 `voice` 字段补充正则白名单校验（如 `/^[a-zA-Z0-9-_]+$/`），并在 `EdgeTtsProvider` 中对 `voice` 实施字符转义或白名单匹配。
2. **[中优先级] 优化 SEC-02 (限流器策略)**:
   将全局限流器重构为基于客户端 IP / Bearer Key 的每用户限流，避免单用户高频请求引发全服拒绝服务。
3. **[中优先级] 优化 SEC-03 (声音获取超时控制)**:
   为上游 `listVoices` 调用增加超时控制（如 10 秒超时中断），并在 `VoiceCache` 增加容灾保护。
4. **[低优先级] 修复 SEC-04 (点击劫持)**:
   在 Nginx 模板与 Fastify 静态托管中间件中配置 `X-Frame-Options: SAMEORIGIN`。
5. **[低优先级] 优化 ARCH-01 / ARCH-02 (分段语音架构)**:
   消除原生路由中的重复文本分段计算，并优化分段语音连续流中的信号量分配逻辑。
