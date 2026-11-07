# Voilà — 实现计划（黑客松 MVP）

> 依据：[PRD.zh.md](PRD.zh.md) v0.2。技术栈：**全 TypeScript**。
> 原则：先打通风险最大的链路——"一条命令 → H agent 在仿真站订到付款页并调用 `handoff_payment`"，其余模块围绕它并行推进。

## 1. 仓库结构（pnpm workspaces monorepo）

```
apps/
  shuttle-clone/   仿真接送站（保留烂 UI）+ Stripe Checkout + webhook
  server/          Voilà 后端编排器（状态机 + 各服务适配器）
  web/             手机网页（说话按钮、TTS、数据流、支付交接、预订卡片）
packages/
  shared/          事件协议、Trip/Option/Booking 类型、zod schema
playbooks/         站点手册（每个预订站一份 Markdown）
scripts/           run-booking.ts 等命令行脚本、录制好的 PRIM 响应
```

| 层 | 选型 | 理由 |
| - | - | - |
| 运行时 | Node 22 + `tsx`（开发）/ `tsup`（构建） | 原生 `fetch`、WebSocket 客户端 |
| 后端框架 | Hono（`@hono/node-server` + `ws`） | 轻量，HTTP + WebSocket 一套代码 |
| 校验 | zod（同时用于 LLM 结构化输出的 JSON Schema） | 前后端共享类型 |
| 前端 | Vite + 原生 TS（或 Preact） | DOM 可控，便于 VoiceOver 实测 |
| 仿真站 | Hono + 服务端模板（`hono/html`）+ jQuery / jQuery UI | 还原 WordPress "Chauffeur Booking System" 的味道 |
| 支付 | `stripe` Node SDK，Checkout Session（测试模式） | 与真实站跳转 Stripe 一致 |
| 存储 | SQLite（`better-sqlite3`），或内存 Map | 黑客松足够 |
| 部署 | 仿真站和 server 部署到公网（Fly / Render），开发期用 cloudflared tunnel | H 云端浏览器要能访问；手机端 `getUserMedia` 需要 HTTPS |

## 2. 组件设计

### 2.1 仿真接送站 `apps/shuttle-clone`

按[附录 A](PRD.zh.md#附录-a真实站点观察)还原 4 步流程：**路线 → 选车 → 信息 → 付款**。

- 必须保留的"烂"：`<label>` 不关联输入框；jQuery 日期/时间选择器（不能直接输入）；地址自动补全写入隐藏的 `lat/lng` 字段（用本地固定地址列表模拟 Google Places）；多个原生 `<select>`（乘客数、行李数、接送类型）；备注栏默认折叠；进入付款步骤时**先生成订单**，再"2 秒倒计时后跳转 Stripe"。
- 开关：`?difficulty=easy|real`，必要时降低选择器难度，保证 demo 稳定（默认 `real`）。
- 支付：`POST /checkout` 创建 Stripe Checkout Session（`payment_method_types` 含 card，Apple Pay 由 Checkout 自动提供），`success_url` 回到确认页。
- `POST /stripe/webhook`：`checkout.session.completed` → 订单标记已付款 → 回调 server `POST /internal/payment-completed`。
- 确认页：显示订单号、上车点、时间、价格、商家电话。
- 不做：真实验证码、真实反爬（只在 PRD 叙事中提及）。

### 2.2 后端编排器 `apps/server`

**会话状态机（PRD §8.1）：**

```
LISTEN → UNDERSTAND → (CLARIFY?) → RESEARCH → PRESENT → CHOOSE
      → EXECUTE ⇄ CONFIRM → HANDOFF → AWAIT_PAYMENT → DONE
                   任意阶段 ← STOP / 纠正（FR-7, FR-28）
```

**模块：**

| 模块 | 职责 | 对应 FR |
| - | - | - |
| `session.ts` | 状态机、会话存储、事件推送、心跳播报（静默超过约 4 s 自动补一句进度） | FR-3 |
| `understand.ts` | LLM 结构化输出 → `Trip`；只追问缺失的关键字段；追问期间并行启动调研 | FR-10 |
| `adapters/prim.ts` | IDFM PRIM 查询 RER B 中断信息；失败时回退到 `scripts/fixtures/prim-rer-b.json`，并在 feed 中标明"录制数据" | FR-11 |
| `adapters/linkup.ts` | 交叉验证中断信息 + 搜索替代方案，保留来源 URL | FR-11, FR-12 |
| `options.ts` | 预置清单（北站出租车站、G7、Paris Airport Shuttle、替代巴士）+ Linkup 结果合并 | FR-12 |
| `feasibility.ts` | 纯函数：`now + 接车等待 + 路程 + 缓冲 ≤ 托运截止`；导盲犬 `accepted / unknown / refused`；输出剔除原因。**要有单元测试** | FR-13 |
| `choose.ts` | 把"第一个""接送车"映射到方案 id | FR-14 |
| `adapters/h-agent.ts` | 创建 H session、流式读取 `changes`、处理自定义工具调用、取消 session、超时 | FR-20–24, FR-26 |
| `narrate.ts` | 把 `policy_event.content` 压成简短的语音进度（先用模板，必要时再用 LLM） | FR-21 |
| `gladia.ts` | 为手机签发 Gladia 实时 session（浏览器直连，key 不下发） | FR-2 |

**H agent 配置（PRD §9.4）：** `holo4-27b`，`reasoning_effort: disabled`，`settle_s: 0.3`，1280×800，`start_url` 直达表单，`max_steps: 60`，`max_time_s: 240`。
`instructions` = 行程 + 用户档案 + `playbooks/<site>.md` + 硬规则（"绝不付款；提交前调用 `confirm_with_user`；到付款页调用 `handoff_payment`"）。

**自定义工具：**

- `confirm_with_user(summary)` → 推 `confirm` 事件 → 等待用户回复 → 将 `"confirmed"` 或用户的纠正作为工具结果返回给 agent。
- `handoff_payment(amount, merchant, summary)` → 后端取当前页面 URL（优先从 session 事件或浏览器状态读取，见 PRD 待定问题 5）→ 推 `payment_handoff` → agent 等待。
- `answer_format` → `Booking { ref, pickup_time, pickup_point, price, operator_phone, payment_url, guide_dog_status }`。

> 具体 API 形状（自定义工具注册、`changes` 流、`answer_format`）实现前须对照 `https://hub.hcompany.ai/llms.txt` 核实。

**并发：** 免费版全 org 只有 3 个 H session → 每个用户会话同一时间只运行 1 个 agent；server 启动时列出并清理残留 session。

**LLM：** 用于理解、方案选择、进度压缩；通过 `LLM_PROVIDER` 环境变量切换，输出一律经 zod 校验。

### 2.3 事件协议 `packages/shared`

一条 WebSocket `/ws/session/:id`：

| 方向 | 事件 |
| - | - |
| server → web | `stage`、`say{text}`、`feed{kind, text, source?}`、`clarify{question}`、`options{items}`、`confirm{summary}`、`payment_handoff{url, amount, merchant, expires_at?}`、`booking_card{Booking}`、`error` |
| web → server | `hello{profile, gps}`、`final_transcript{text}`、`user_reply{text}`、`stop`、`paid`（用户口头确认已付款） |

断线重连时 server 补发当前状态快照（从付款页返回后会触发）。

### 2.4 手机网页 `apps/web`

- 全屏 `<button>`，按住说话；`aria-live="assertive"` 播报区；触觉反馈用 `navigator.vibrate`（iOS 不支持，改用短提示音）。
- 音频：`getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } })` → AudioWorklet 转 16 kHz PCM16 → 直连 Gladia WebSocket；屏幕实时显示转写；把最终转写发给 server。
- TTS：浏览器 `speechSynthesis`（零延迟、零成本）。**首次点按时解锁音频**（iOS 限制）。TTS 播放期间暂停收音，避免自激。
- 支付交接：iOS 会拦截非手势触发的 `window.open` → 显示全屏"打开付款页"按钮，并朗读金额和商家；`visibilitychange` 回到页面时重连并拉取状态。
- 预订卡片：自动朗读；`tel:` 一键拨打；导盲犬确认状态显式展示。
- 档案（姓名、电话、邮箱、导盲犬、语言）存 localStorage，首次进入时填写一次。
- `/stage` 大屏视图（笔记本投屏）：数据流 + H Agent View 链接或实时画面（FR-6）。

### 2.5 站点手册 `playbooks/`

`paris-airport-shuttle.md`：字段顺序、每个控件怪癖（日期选择器怎么翻月、时间下拉格式、自动补全要等下拉出现再选第一项）、**所有 `<select>` 的选项全文**、导盲犬写进哪个备注栏、付款页的识别特征。根据实测迭代。

## 3. 里程碑（对齐 PRD §16）

| # | 时段 | 交付 | 验收 | 负责 |
| - | - | - | - | - |
| M0 | 周五晚开头 | monorepo 脚手架、`shared` 类型、`.env.example`、公网 tunnel | `pnpm dev` 启动 3 个 app | 任一人 |
| M1 | 周五晚 | 仿真站 4 步 + Stripe Checkout（测试模式）+ webhook，部署 | 手机 Safari 用 Apple Pay（测试）付完，webhook 到达（验证待定问题 2） | P1 |
| M2 | 周五晚 | `scripts/run-booking.ts`：H agent + 手册 + 两个自定义工具 | 一条命令返回 `payment_url`；5 次运行中 confirm/handoff **每次**都被调用；记录步数、耗时、成本 | P2 |
| M3 | 周六上午 | 手机网页：按住说话 → Gladia → 转写 → `understand` → TTS | 车站噪音录音 → 正确的 `Trip` | P3 |
| M4 | 周六下午 | PRIM + Linkup + 可行性筛选 → 朗读方案 → 语音选择 | 30 s 内读出停运原因和 2–3 个方案，带来源 | P4 |
| M5 | 周六晚 | 端到端：选择 → 执行 → 确认 → 交接 → 付款 → 预订卡片；兜底换方案 | 全流程 ≤ 5 分钟，连续成功 3 次 | 全员 |
| M6 | 周日上午 | `/stage` 大屏、"停"/纠正、导盲犬跟进邮件、预录备用视频 | 可上台 | P3/P4 |
| M7 | 周日下午 | Pitch、排练 | 3 分钟内讲完 | 全员 |

关键路径：**M1 → M2 → M5**。M2 一旦不稳（选择器选错、步数过多），优先改手册，其次用 `difficulty=easy` 降低仿真站难度。

## 4. 测试与验证

- `feasibility.ts`、`choose.ts`、事件协议：vitest 单元测试。
- `understand.ts`：一组录音/转写样本（含噪音）→ 期望的 `Trip`，作为回归集。
- H agent：`run-booking.ts --runs 5` 输出成功率、步数、耗时、成本，与 PRD §13 基线对比。
- 手机端：iPhone + VoiceOver 实测整条流程；Android Chrome + TalkBack 冒烟测试。
- Demo 前检查清单：没有残留的 H session、Stripe 处于测试模式、PRIM 回退数据就绪、备用视频就绪。

## 5. 环境变量（`.env.example`）

```
H_API_KEY=            GLADIA_API_KEY=        LINKUP_API_KEY=
PRIM_API_KEY=         LLM_PROVIDER=  LLM_API_KEY=
STRIPE_SECRET_KEY=    STRIPE_WEBHOOK_SECRET=
SHUTTLE_PUBLIC_URL=   SERVER_PUBLIC_URL=     INTERNAL_CALLBACK_TOKEN=
```

## 6. 开放问题（需尽早确认）

1. LLM 用哪家（影响结构化输出写法）？
2. H Agents API 自定义工具 + `answer_format` 的确切用法；付款页 URL 是否能从 session 事件中可靠拿到（PRD 待定问题 5）。
3. PRIM 的 token 申请方式，以及提供 RER B 中断信息的具体接口（PRD 待定问题 3）。
4. Stripe Checkout 测试模式下的 Apple Pay 是否无需域名验证即可使用（PRD 待定问题 2，M1 验证）。
