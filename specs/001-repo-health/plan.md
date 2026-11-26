# 实现计划 · Git 仓库接入体检

> 前置文档：`constitution.md`（约束）、`spec.md`（需求）、`data-model.md`（类型）、`contracts/api.md`（接口）。
> 本文件只回答"怎么做"，不定义"做什么"。

---

## 1. 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript 5 | 前后端同进程，`pnpm dev` 一条命令满足 Constitution 第一条 |
| 样式 | Tailwind CSS v4 | 零运行时，无需 design token 构建链 |
| 解包 | `tar-stream` + Node `zlib` | 流式，不落盘、不整包 buffer |
| 校验 | `zod` | API 出入参与 LLM 输出共用一套 schema |
| 测试 | Vitest | 与 Vite 系生态一致，纯函数测试极快 |
| 存储 | 无数据库；`.cache/` 目录 JSON | 单机工具，避免引入服务 |
| 图表 | 原生 SVG（分数环、子分条） | 引入 chart 库为两个图形不值当 |

**显式不引入**：ORM、状态管理库、UI 组件库、i18n 框架、Docker。

---

## 2. 目录结构

```
app/
  page.tsx                       输入页（含最近分析与样例入口）
  report/page.tsx                报告页（?url= 或 ?fixture=）
  api/analyze/route.ts           POST 分析（全量 / 增量）
  api/report/route.ts            GET 读取缓存报告
  api/fixture/[name]/route.ts    GET 离线样例
src/
  core/
    ruleset.ts                   rulesetVersion + 规则注册表
    github.ts                    元数据 / tarball / commits / compare
    unpack.ts                    流式 tar → RepoFiles
    pipeline.ts                  编排 5 个阶段 + 计时
    scan/
      index.ts                   按注册表调度，聚合去重
      readme.ts  deps.ts  run.ts  win.ts  paths.ts  secrets.ts
      suppress.ts                占位符白名单 + 上下文降级
      lexicon.ts                 正则与关键词常量（集中编译，防 ReDoS）
    score.ts                     扣分/封顶/等级
    explain.ts                   规则文案 + LLM 适配 + schema 校验回退
    cache.ts                     报告缓存 + 文件级 finding 缓存
    types.ts                     与 data-model.md 一一对应
src/ui/
  components/ScoreRing.tsx  Breakdown.tsx  RiskList.tsx  FindingRow.tsx
  components/DiffBanner.tsx  AiPanel.tsx  UrlForm.tsx  ErrorState.tsx
tests/
  fixtures/{node-good,python-good,bad-everything}/   最小可分析仓库
  rules/*.test.ts
  score.test.ts  pipeline.test.ts  api.test.ts
```

---

## 3. 模块边界

数据单向流动，禁止反向依赖：

```
github.ts ──▶ unpack.ts ──▶ RepoFiles ──▶ scan/* ──▶ Finding[]
                                                        │
                                                        ▼
                                                   score.ts ──▶ Report ──▶ explain.ts ──▶ UI
```

- `scan/*` 只依赖 `RepoS like` 内存结构与 `lexicon`，**不得** import `github.ts`。
- `score.ts` 只读 `Finding[]`，不读文件内容——这是增量更新能复用 finding 的前提。
- `explain.ts` 是唯一允许出网的模块（除 `github.ts` 外），且必须能整体关闭。

---

## 4. 关键实现要点

| 点 | 做法 |
|---|---|
| 流式解包 | `tar-stream` 逐 entry 处理：按 `header.size` 先判上限，超 1MB 或二进制扩展名直接 `resume()` 丢弃，不 buffer |
| 顶层目录 | GitHub tarball 顶层固定为 `{repo}-{sha}/`，统一剥离一层，保证路径与仓库一致 |
| 文本解码 | `new TextDecoder('utf-8', {fatal: false})` 宽松解码；去 BOM；非法字节替换为 `\uFFFD` 并在 `FileRecord.encoding` 标记 |
| 行号 | 解包时一次性 `split('\n')` 保留行数组，规则命中直接拿到下标 +1，避免二次切分 |
| 正则安全 | 全部集中 `lexicon.ts`，量词必须带上界（如 `sk-[A-Za-z0-9]{20,200}`），单条正则对单文件执行 ≤ 50ms 预算 |
| 超时 | `AbortSignal.timeout(15_000)`；tarball 下载单独 30s |
| 增量粒度 | 文件级缓存键 = `sha256(文件内容) + rulesetVersion`，值 = 该文件的 `Finding[]`。换 commit 时天然命中未变更文件，**不依赖 git blob SHA 计算** |
| 错误 | 内部抛 `AnalyzeError{code, httpStatus, message, hint}`，路由层统一转 JSON，不泄漏堆栈 |

---

## 5. 接口契约

详见 `contracts/api.md`。四个端点：

| 端点 | 用途 |
|---|---|
| `POST /api/analyze` | 全量分析；带 `baseSha` 时走增量 |
| `GET /api/report?url=&sha=` | 读缓存报告（刷新页面不重算） |
| `GET /api/fixture/{name}` | 离线样例 |
| `GET /api/health` | 探测是否配置了 token / LLM key（只返回布尔） |

---

## 6. 缓存设计

| 层 | 键 | 失效 |
|---|---|---|
| 内存 LRU | `owner/repo@sha` | 进程重启 |
| 报告磁盘 | `.cache/reports/{owner}__{repo}__{sha}.json` | 不过期（内容寻址） |
| 文件级 findings | `.cache/files/{sha256前16位}.json` | `rulesetVersion` 变更即失效 |
| 分支 HEAD | `owner/repo@head` | 60s TTL |

体积控制：启动时若 `.cache` > 200MB，按 mtime 删除最旧报告至 150MB。

---

## 7. LLM 适配层

- 协议：OpenAI 兼容 `POST {baseURL}/chat/completions`。
- 环境变量：`LLM_API_KEY`（缺失即关闭）、`LLM_BASE_URL`（默认 `https://api.deepseek.com`）、`LLM_MODEL`（默认 `deepseek-chat`）。
- 输出 schema（zod 强校验，失败即回退）：

```ts
{ verdict: string.max(60), reasons: string[3], actions: {title, detail, severity}[3] }
```

- prompt 为固定模板，只注入：总分/子分、按规则聚合的统计（ruleId 计数）、Top 5 finding 的 `ruleId + file + 已脱敏摘要`。
- 参数：`temperature 0.2`、`max_tokens 800`、超时 20s、失败重试 0 次（直接降级）。

---

## 8. 测试策略

| 层 | 内容 |
|---|---|
| 规则单测 | 每条规则 ≥ 1 正例 + 1 反例；抑制规则（SEC-09、4.5 降级）单独覆盖 |
| 快照测试 | 3 个 fixture 仓库的完整 Report（去掉 `analyzedAt`）快照 |
| 评分单测 | 扣分累加、下限 0、封顶 40、空仓库 0 分、子分权重算术 |
| 契约测试 | API 响应过 zod；错误码符合 §7 矩阵 |
| 幂等测试 | 同 SHA 两次分析深度相等 |
| 泄漏测试 | 报告 JSON 字符串不包含 fixture 中的原始 token |
| 网络隔离 | `Fetcher` 通过依赖注入，单测一律 mock，CI 不出网 |

**不做**：真实 GitHub 的集成测试进 CI（限流不可控）。改为 `pnpm verify:live <url>` 手动脚本。

---

## 9. 性能预算

| 阶段 | 中型仓库（~2000 文件 / 8MB）预算 |
|---|---|
| 元数据 | < 400ms |
| tarball 下载 + 解包 | < 2500ms |
| 规则扫描 | < 1200ms |
| 评分 + 序列化 | < 50ms |
| **合计** | **< 5s**，UI 有分阶段进度 |

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 误报率高（最常见死法） | 评审人认为规则粗糙 | 抑制层 + 占位符白名单；**用本工具分析本工具，目标 A/B 级**，作为自查用例 |
| 匿名限流 | 演示中断 | 单 tarball 请求 + 报告缓存 + fixture 兜底 |
| 大仓库 OOM | 进程崩溃 | header 阶段即丢弃，硬上限 5000/50MB |
| LLM 输出不可控 | 页面错乱 | 强 schema + 回退，AI 不参与评分 |
| 时间不够 | 功能残缺 | 按 `tasks.md` 的 M1→M4 顺序，P2 可整体砍掉不影响 P0 |

---

## 11. 里程碑

| 里程碑 | 内容 | 完成判据 |
|---|---|---|
| M1 | 脚手架 + 取数链路 | CLI 能打印一个真实仓库的文件清单 |
| M2 | 六组规则 + 评分 | fixture 测试全绿，Report JSON 完整 |
| M3 | 报告页 UI | 浏览器里能看完一份报告，含证据展开 |
| M4 | 增量更新 + 错误态 | 「检测更新」演示出复用率 |
| M5 | AI 层 + 文档 | `README`、`AI_USAGE.md`、录屏就绪 |

**砍功能顺序（时间不足时）**：AI → 离线样例 → 导出 → 证据展开 → 分阶段耗时。**P0 的六组规则和评分一项都不能砍。**
