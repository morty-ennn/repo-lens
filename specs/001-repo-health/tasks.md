# 任务清单 · Git 仓库接入体检

> 每个任务必须有**可执行的验证方式**，验证不通过不算完成。
> 估时为单人参考值，总计约 21h，留 27h 缓冲用于联调、文档与录制。

## 阶段 0 · 脚手架（约 1.5h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-01 | 初始化 Next.js 15 + TS + Tailwind + Vitest | 可 `pnpm dev` 的骨架 | `pnpm dev` 打开 3000 端口；`pnpm test` 跑通 1 个空测试 | 40m | — |
| T-02 | 落 `types.ts` 与 `ruleset.ts` | 类型 + 规则注册表 + `rulesetVersion='1.0.0'` | `tsc --noEmit` 通过 | 30m | T-01 |
| T-03 | 造 3 个 fixture 仓库 | `tests/fixtures/*` | 每个 fixture 能被 `repoFilesFromDir()` 读入内存 | 20m | T-02 |

## 阶段 1 · 取数链路（约 4h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-04 | URL 解析 | `parseRepoUrl()` | 覆盖 AC-1.2 五种形态 + 2 个非法输入，单测全绿 | 30m | T-02 |
| T-05 | 元数据 + 限流识别 | `fetchRepoMeta()` | mock 404/403/429，返回对应 `AnalyzeError` | 40m | T-04 |
| T-06 | tarball 流式下载解包 | `fetchSnapshot()` + `unpack.ts` | 真实仓库解出文件数与 GitHub 页面一致；8MB 仓库内存峰值 < 100MB | 90m | T-05 |
| T-07 | 剥离顶层目录 + 路径规范化 | 同上 | 解出的路径不含 `{repo}-{sha}/` 前缀 | 20m | T-06 |
| T-08 | 体量上限与抽样标注 | `sampling` 字段 | 构造 6000 文件 tar，返回 `mode='sampled'` 且不崩 | 40m | T-06 |
| T-09 | Contents API 回退路径 | `fetchSnapshotFallback()` | 强制 tarball 抛错，仍能拿到 README + package.json | 40m | T-06 |

## 阶段 2 · 规则引擎（约 6h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-10 | README 组 RD-01~RD-07 | `scan/readme.ts` | 每条 ≥1 正例 1 反例 | 60m | T-03 |
| T-11 | Node 依赖组 DEP-01/02/05 | `scan/deps.ts` | 同上；无 `package.json` 时不误报 | 45m | T-03 |
| T-12 | Python 依赖组 DEP-03/04 | 同上 | 用 AST 或 `ast` 简化版解析 import，注释掉的 import 不算 | 60m | T-11 |
| T-13 | 启动脚本组 RUN-01~RUN-05 | `scan/run.ts` | RUN-03 用 `node dist/index.js` 但无 dist 的 fixture 命中 | 60m | T-11 |
| T-14 | Windows 脚本组 WIN-01~WIN-03 | `scan/win.ts` | 有 `.bat` 无 `.sh` 时 WIN-02 命中；两者都有时不命中 | 30m | T-03 |
| T-15 | 硬编码路径组 PATH-01~PATH-05 | `scan/paths.ts` | 注释里的 `C:\` 降级为 info | 50m | T-03 |
| T-16 | 密钥组 SEC-01~SEC-08 | `scan/secrets.ts` | 5 类真实形态全命中；脱敏函数有独立单测 | 70m | T-03 |
| T-17 | 抑制层（SEC-09 + 文档/测试降级） | `scan/suppress.ts` | `.env.example` 里 `your_key_here` 为 info 而非 critical | 45m | T-16 |
| T-18 | 行号与 excerpt 生成 | 统一工具函数 | 每条 finding 的 line 指向正确的行，excerpt ≤ 200 字符 | 30m | T-10 |

## 阶段 3 · 评分（约 2h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-19 | 扣分与子分计算 | `score.ts` | 扣分累加正确、下限 0、权重算术误差 ≤ 1 | 45m | T-18 |
| T-20 | 封顶 / 空仓库 / 抽样置信度 | 同上 | critical → total ≤ 40；空仓库 → 0 分 + `EMPTY_REPO` | 30m | T-19 |
| T-21 | 等级与文案 | `grade()` | 85/84/70/69/50/49 边界值逐点断言 | 20m | T-19 |

## 阶段 4 · 报告页 UI（约 5h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-22 | 输入页 | `app/page.tsx` + `UrlForm` | 粘贴 URL 回车即分析；错误输入有内联提示 | 45m | T-04 |
| T-23 | 报告页骨架 + 分数环 | `ScoreRing` + `Breakdown` | 三子分可见、权重可见、总分动画正确 | 90m | T-21 |
| T-24 | 风险清单 + 证据展开 | `RiskList` + `FindingRow` | critical 置顶；点击展开 ±3 行代码 | 80m | T-23 |
| T-25 | 错误态与降级横幅 | `ErrorState` | §7 矩阵 7 种场景各有一张脸 | 45m | T-05 |
| T-26 | 导出 JSON + fixture 入口 | 下载按钮 + `?fixture=` | 下载文件含短 SHA；3 个 fixture 都能渲染 | 40m | T-23 |

## 阶段 5 · 增量更新（约 2.5h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-27 | 报告缓存 + 文件级 findings 缓存 | `cache.ts` | 同 URL 二次请求 < 100ms 返回 | 60m | T-19 |
| T-28 | compare 增量 + 兜底 | `analyze` 的 `baseSha` 分支 | 真实仓库演示出"复用 M 条"；300+ 变更回退全量 | 60m | T-27 |
| T-29 | 差异横幅 UI | `DiffBanner` | 显示 `旧分 → 新分`、变更数、复用率 | 30m | T-28 |

## 阶段 6 · AI 层（约 1.5h，可砍）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-30 | OpenAI 兼容适配 + zod 校验 | `explain.ts` | 错误 JSON 自动回退规则文案且页面不报错 | 50m | T-21 |
| T-31 | 规则引擎文案生成器 | `explainRules()` | 无 Key 时面板结构与 AI 模式一致 | 40m | T-30 |

## 阶段 7 · 交付（约 3h）

| ID | 任务 | 产出 | 验证 | 估时 | 依赖 |
|---|---|---|---|---|---|
| T-32 | 自查：用本工具分析本工具 | 截图 + 分数 | 得分 ≥ B，且无 critical 误报 | 30m | T-24 |
| T-33 | 撰写 README（含更新跟踪设计） | `README.md` | 覆盖题面第 5 条四个子问题 | 60m | T-29 |
| T-34 | 撰写 `AI_USAGE.md` | 含 ≥1 条 AI 答错记录 | 记录含"AI 输出 → 我的判断 → 验证方式" | 45m | — |
| T-35 | 录屏 / 截图 | 演示视频 | 60s 内展示完整流程 | 45m | T-32 |

---

## 依赖关系图

```
T-01 → T-02 → T-03 ─┬─→ T-10..T-18（规则，可并行）
                    │
T-02 → T-04 → T-05 → T-06 → T-07/T-08/T-09
                    │
T-18 → T-19 → T-20/T-21 → T-23 → T-24/T-26
T-27 → T-28 → T-29
T-30/T-31 可完全独立于 UI 开发
```

**可并行给多个 AI 会话的部分**：`scan/readme|deps|run|win|paths|secrets` 六组规则彼此独立，只要 `types.ts` 先冻结，可以六路同时生成，再靠单测合并。

---

## 每日节奏建议

| 时段 | 内容 |
|---|---|
| 第 1 天上午 | 阶段 0–1，打通"输入 URL → 拿到文件列表" |
| 第 1 天下午 | 阶段 2，六组规则 + 单测 |
| 第 1 天晚上 | 阶段 3，评分跑通，CLI 出 JSON |
| 第 2 天上午 | 阶段 4，UI 成型 |
| 第 2 天下午 | 阶段 5–6，增量与 AI |
| 第 2 天晚上 | 阶段 7，自查、文档、录屏 |

> 关键判断点：**第 1 天结束时如果 Report JSON 还不能完整生成，砍掉 M5 的 AI 层，保 P0。**
