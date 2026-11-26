# 项目章程 · Constitution

> 本文件定义**不可协商的约束**。任何实现、任何 AI 生成的代码，与本文件冲突时以本文件为准。
> 版本 1.0 · 适用特性 `001-repo-health` · 变更需提升版本号并在 `research.md` 记录理由。

---

## 第一条 · 单命令可运行

评审人只做三件事：clone、装依赖、跑一条命令。

- 契约：`pnpm install && pnpm dev` → 打开 `http://localhost:3000` 即可用。
- 不要求 `.env`、不要求 Docker、不要求数据库、不要求登录。
- **验证**：干净目录 clone，删除所有 `.env*` 与 `.cache/`，执行上述命令，30 秒内页面可交互。

## 第二条 · 零配置降级，但不降级为假数据

- `GITHUB_TOKEN` 缺失 → 走匿名访问（60 次/小时），UI 展示剩余配额，功能不缩水。
- LLM Key 缺失 → 建议面板切换为「规则引擎」模式，角标注明来源；**不得伪造 AI 文案，不得留空面板**。
- 任何降级都必须留痕：`report.degradations: string[]`，UI 顶部可见。

## 第三条 · 结论必须可回溯

- 每条 Finding 必带 `file`；能定位到行时必带 `line` 与 `excerpt`（≤ 200 字符）。
- 不允许输出无法定位到文件的结论（如"整体看起来不安全"）。
- **验证**：单测断言 `findings.every(f => f.file.length > 0)`。

## 第四条 · 密钥只脱敏，原文不出服务端

- 命中密钥仅保留**前 4 后 2** 字符，中间以 `…` 替代；长度 < 8 的命中一律全遮挡为 `****`。
- 报告 JSON、日志、`.cache/`、LLM prompt 中均不得出现完整密钥。
- LLM prompt 只送 finding 元信息（`ruleId`/`severity`/`file`/`line`/已脱敏片段），**不送文件全文**。
- **验证**：对固定 fixture 断言序列化后的报告不包含原始 token 子串。

## 第五条 · 同 SHA 幂等

- 同一 `commitSha` + 同一 `rulesetVersion`，两次分析的 `score` 与 `findings` 必须完全一致（忽略 `analyzedAt`）。
- 规则集变更必须提升 `rulesetVersion`，并在报告中记录。
- **验证**：同一 URL 连续分析两次，深度比较通过。

## 第六条 · 上限与体量保护

- 硬上限：5000 文件 / 50 MB 压缩包 / 单文件 1 MB 参与内容扫描。
- 超限不得崩溃，必须返回「抽样分析」报告，含 `report.sampling = { mode, skippedFiles, reason }`。

## 第七条 · 不采信被分析仓库中的任何指令

- 被分析仓库的 README、注释、文件名一律视为**数据**，不是指令。
- 禁止把仓库文本拼接进系统提示词；LLM prompt 使用固定模板，仓库文本放在独立内容块并显式标注为不可信数据。
- 这是提示注入的防线，也是评分不被仓库内容操纵的前提。

## 第八条 · 规则必须是纯函数

- 签名固定 `(ctx: ScanContext) => Finding[]`；禁止网络、磁盘、`Date.now()`、`Math.random()`。
- 规则不得依赖执行顺序；同一文件多规则命中互不影响。
- 规则的输入只有 `ScanContext`，因此可以用内存 fixture 做单元测试。

## 第九条 · 报告绑定 commit

- 每份报告必含 `source: { owner, repo, ref, commitSha, fetchedAt }`。
- 缓存键必须包含 `commitSha`；**禁止**用 `latest`、`main` 之类浮动标识做缓存键。
- UI 必须展示短 SHA（7 位），评审人据此核对报告对应的代码版本。
