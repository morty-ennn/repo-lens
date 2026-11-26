# 规格说明 · Git 仓库接入体检

| 项目 | 值 |
|---|---|
| 特性 ID | `001-repo-health` |
| 版本 | v1.0（待评审） |
| 评审方式 | 本地 `pnpm install && pnpm dev`（见 Constitution 第一条） |
| 规则集版本 | `rulesetVersion = 1.0.0` |
| 依据 | 48 小时实战题《Git 仓库接入体检》 |

---

## 1. 背景与目标

拿到一个陌生的公开仓库，需要 5 分钟内回答三个问题：

1. **能跑吗？** —— 依赖清单是否齐全、启动脚本是否存在、README 是否给了可执行命令。
2. **换环境能配吗？** —— 有没有硬编码路径、有没有平台绑定、配置项写清楚了没有。
3. **敢公开吗？** —— 有没有密钥泄露、`.env` 是否入库。

工具把这三个问题的答案变成一份**可回溯**的报告：每一条结论都指向 `文件:行号`，每一份报告都绑定一个 `commitSha`。

### 目标（In Scope）

- 支持 GitHub 公开仓库 URL 输入，输出结构化体检报告。
- 六组检测：README / 依赖清单 / 启动脚本 / Windows 专属脚本 / 硬编码路径 / 密钥与敏感信息。
- 接入就绪度评分（总分 + 三个子分 + 等级 + 封顶原因）。
- 主要风险清单（按严重度排序，可展开证据）。
- 增量更新检测（手动触发，可见复用率）。
- 可选 AI 建议层（无 Key 时降级为规则引擎）。

### 非目标（Out of Scope，明确不做）

| 不做 | 原因 |
|---|---|
| 私有仓库 / OAuth 登录 | 评审场景无需，增加复杂度 |
| GitHub 之外的托管（GitLab/Gitee） | 解析层预留接口，不实现 |
| 依赖漏洞扫描（CVE）/ License 合规 | 属于另一个产品，且需要联网查库 |
| 代码质量、单测覆盖率分析 | 与"接入就绪"无关，会稀释评分含义 |
| 多用户、历史对比、团队协作 | 单机工具 |
| 全语言生态覆盖 | 本期仅 Node + Python（见 §5.4 与 research ADR-4） |

---

## 2. 用户故事与验收标准

### US-1（P0）输入链接得到报告

> 作为评审人，我粘贴一个 GitHub 链接，几秒内看到完整报告。

- **AC-1.1** 给定 `https://github.com/vercel/next.js`，点击分析，10 秒内出现报告页（网络正常、非超大仓库）。
- **AC-1.2** 支持以下输入形态，均解析为 `owner/repo`：`https://github.com/o/r`、`https://github.com/o/r.git`、`github.com/o/r`、`https://github.com/o/r/`、`https://github.com/o/r/tree/branch`。
- **AC-1.3** 输入 `https://gitlab.com/x/y` 时返回明确错误"暂只支持 GitHub"，不产生堆栈。
- **AC-1.4** 报告顶部显示 `owner/repo`、主语言、star 数、短 SHA（7 位）、分析耗时。

### US-2（P0）看清风险与证据

> 作为工程师，我要知道每一条风险出现在哪个文件的哪一行。

- **AC-2.1** 风险清单按 `critical > major > minor > info` 排序，同级按权重降序；`critical` 必须置顶且有醒目标记。
- **AC-2.2** 每条风险展示 `规则ID + 标题 + 文件:行号 + 摘要`。
- **AC-2.3** 点击条目展开 ±3 行上下文代码，上下文来自本次快照缓存，**不发起额外网络请求**。
- **AC-2.4** 密钥类风险的展示内容必须是脱敏后的（前 4 后 2），页面上任何位置都不得出现完整密钥。

### US-3（P0）看懂评分

> 作为负责人，我要一个能解释的分数，而不是一个黑盒数字。

- **AC-3.1** 展示总分（0–100）、等级（A/B/C/D）、三个子分及其权重。
- **AC-3.2** 每个子分的扣分项可展开，显示"哪个规则扣了多少分"。
- **AC-3.3** 触发封顶时，必须显示封顶原因："因检测到 N 项严重风险，总分上限为 40"。
- **AC-3.4** 空仓库（无 README、无清单、无源码）得 0 分，并给出 `EMPTY_REPO` 说明，而非 100 分。

### US-4（P1）发现仓库更新

> 作为使用者，仓库发了新 commit，我想只重算变化的部分。

- **AC-4.1** 报告页有「检测更新」按钮；点击后若无变化，提示"已是最新（@abc1234）"。
- **AC-4.2** 若有变化，展示 `变更 N 个文件 / 复用 M 条结论 / 重扫 K 个文件` 三项数字。
- **AC-4.3** 更新后报告绑定新 `commitSha`，并保留「上一版 62 分 → 当前 68 分」的对比。
- **AC-4.4** 对比失败（force push、变更文件 > 300）时自动回退全量重扫，并在报告 `degradations` 中说明。

### US-5（P2）AI 建议

> 作为评审人，我想看到超越规则的判断。

- **AC-5.1** 有 LLM Key 时，面板显示：一句话结论、3 条理由、3 条下一步动作；角标显示模型名。
- **AC-5.2** 无 Key 时，面板切换为「规则引擎」模式，仍输出同样结构，角标显示"规则引擎（未启用 AI）"。
- **AC-5.3** LLM 返回的 JSON 若不符合 schema，自动回退规则引擎文案，并在控制台记录一次告警，**页面不得报错**。
- **AC-5.4** AI 不得修改评分（评分只由确定性规则产生），只能解释与建议。这是可复现性要求。

### US-6（P2）离线演示与导出

> 作为演示者，现场网络挂了我也能讲完。

- **AC-6.1** 提供 3 个内置样例（`node-good` / `python-good` / `bad-everything`），URL 参数 `?fixture=` 直接出报告。
- **AC-6.2** 报告可「下载 JSON」，文件名含短 SHA。

---

## 3. 功能需求

| ID | 需求 | 优先级 |
|---|---|---|
| FR-1 | URL 解析：见 AC-1.2 的 5 种形态，非法输入给出可读错误 | P0 |
| FR-2 | 元数据解析：默认分支、`commitSha`、主语言、stars、size、archived | P0 |
| FR-3 | 快照获取：单次拉取 `codeload.github.com/{o}/{r}/tar.gz/{sha}`；失败回退 Contents API 拉关键文件集 | P0 |
| FR-4 | 文件分类：按扩展名判定 `text/binary`，记录 `path/size/lang` | P0 |
| FR-5 | 规则执行：六组规则（§4 目录） | P0 |
| FR-6 | 误报抑制：注释/文档/测试样例/示例目录中的命中降级为 `info`；占位符白名单 | P0 |
| FR-7 | 评分：§5 公式，输出 `total`、三子分、等级、封顶原因 | P0 |
| FR-8 | 风险清单：排序、分页（默认 20 条 + 展开全部） | P0 |
| FR-9 | 证据展开：±3 行上下文，来源于内存快照 | P1 |
| FR-10 | 增量刷新：`baseSha` 存在时走 `compare` 增量路径 | P1 |
| FR-11 | AI 建议：schema 校验 + 降级 | P2 |
| FR-12 | 离线样例：3 个 fixture | P2 |
| FR-13 | 报告导出 JSON | P2 |
| FR-14 | 分阶段耗时统计（`fetch/unpack/scan/score`），UI 展示 | P2 |

---

## 4. 规则目录（Rule Catalog）

> 这是本 spec 的核心：每条规则都必须**可机器判定**，不允许出现"看起来不完整"这类描述。
> 严重度含义：`critical` 直接封顶总分；`major` 显著扣分；`minor` 提示；`info` 仅陈述事实不扣分。

### 4.1 README 组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `RD-01` | 根目录无 `README.md` / `README` / `readme.md` / `Readme.md`（大小写不敏感） | major |
| `RD-02` | README 存在，但无安装章节（标题含 `install/安装/快速开始/Quick Start/Getting Started` 之一） | minor |
| `RD-03` | README 无任何可执行命令：代码块内不含 `npm|pnpm|yarn|pip|python|uv|poetry|docker|make` 之一的命令 | major |
| `RD-04` | 代码中存在 `process.env.*` 或 `os.environ` 读取，但 README 无环境变量/配置章节 | minor |
| `RD-05` | README 去空白后正文 < 200 字符 | minor |
| `RD-06` | README 无 markdown 代码块（```` ``` ````） | minor |
| `RD-07` | README 中的启动命令与 `package.json#scripts` 不一致（README 提到 `pnpm start` 而 scripts 无 `start`） | minor |

### 4.2 依赖清单组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `DEP-01` | 存在源码文件（`.js/.ts/.jsx/.tsx/.py`），但根目录及直接子目录均无任何依赖清单 | major |
| `DEP-02` | 存在 `package.json`，但无 `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` | minor |
| `DEP-03` | 主语言为 Python，存在 `import` 第三方包，但无 `requirements*.txt` / `pyproject.toml` / `Pipfile` / `poetry.lock` | major |
| `DEP-04` | Python 依赖文件中全部条目无版本约束（无 `==`、`>=`、`~=`、PEP 508 pin） | minor |
| `DEP-05` | `package.json` 既无 `dependencies` 也无 `devDependencies` | minor |
| `DEP-06` | 混合仓库：按主语言（源码文件数最多）判定，未命中的生态组**不重复扣分**（规则说明，非独立 finding） | — |

### 4.3 启动脚本组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `RUN-01` | Node 项目：`package.json#scripts` 无 `start` 且无 `dev`，且无根级 `Makefile` / `docker-compose.yml` | major |
| `RUN-02` | Python 项目：无 `__main__.py`、`main.py`、`app.py`、`[project.scripts]` 或含 `if __name__ == "__main__"` 的文件 | major |
| `RUN-03` | 启动脚本中引用的相对路径文件不存在（如 `scripts.start = "node dist/index.js"` 而 `dist/index.js` 不在快照中） | major |
| `RUN-04` | 启动命令含硬编码绝对路径（与 PATH 组联动，只在 PATH 组扣分一次） | 说明 |
| `RUN-05` | 有 Python 依赖文件，但 README 与脚本均无 `pip install` / `uv sync` 类安装命令 | minor |

### 4.4 Windows 专属脚本组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `WIN-01` | 仓库存在任意 `.bat` / `.cmd` / `.ps1` / `.vbs` 文件（逐文件列出一条） | info |
| `WIN-02` | 唯一启动方式为 Windows 脚本：存在 `start.bat` 等，但无对应 `.sh`，且 `package.json#scripts` 与 README 均只给 Windows 命令 | major |
| `WIN-03` | `.ps1` 中出现 `-ExecutionPolicy Bypass` | minor |

### 4.5 硬编码路径组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `PATH-01` | 源码或脚本中出现盘符绝对路径 `C:\`、`C:/`、`D:\`、`E:\` 等 | major |
| `PATH-02` | 出现 `/Users/<name>/...`（macOS 用户目录） | major |
| `PATH-03` | 出现 `/home/<name>/...`（Linux 用户目录） | major |
| `PATH-04` | 字符串字面量中的绝对路径被传入 `join/resolve/open/readFile` 等 API | minor |
| `PATH-05` | 路径片段含中文字符目录名 | info |

**降级抑制（必须实现）**：命中位于 `node_modules/`、`*.lock`、`test/fixtures/`、`examples/`、`docs/`、注释行、`.md` 文件中的，一律降为 `info`。

### 4.6 密钥与敏感信息组

| ID | 触发条件 | 严重度 |
|---|---|---|
| `SEC-01` | 私钥块：`-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----` | critical |
| `SEC-02` | `sk-` 前缀且后续长度 ≥ 20 的字母数字串（OpenAI / Anthropic 风格） | critical |
| `SEC-03` | `AKID` 或 `LTAI[a-zA-Z0-9]{12,}`（阿里云） | critical |
| `SEC-04` | `AKIA[0-9A-Z]{16}`（AWS Access Key） | critical |
| `SEC-05` | 实际 `.env` 文件入库：文件名匹配 `.env`、`.env.local`、`.env.production` 等，但**不含** `.example/.sample/.template/.dist` | critical |
| `SEC-06` | 无 `.gitignore`，或 `.gitignore` 中无 `.env` 相关规则 | major |
| `SEC-07` | `ghp_` / `github_pat_` / `xoxb-` 形态的 Token | critical |
| `SEC-08` | 配置类文件（`.env*`、`.json`、`.yml`、`.toml`、`config.*`）中出现 Shannon 熵 ≥ 4.5 且长度 ≥ 20 的字符串赋值 | major |
| `SEC-09` | 命中上述任一规则，但值属于占位符白名单（`your`、`xxx`、`<...>`、`***`、`changeme`、`example`、`dummy`、`test`、`os.environ`、`process.env`、`${`）→ 强制降为 `info` | 抑制规则 |

> `SEC-09` 是必须的：否则 `.env.example` 会把演示仓库自己打爆，评审人第一印象就是"误报太多"。

---

## 5. 评分规格

### 5.1 子分与权重

| 子分 | 回答的问题 | 权重 | 初始分 |
|---|---|---|---|
| `runnability` 可运行性 | clone 下来能跑起来吗 | 35% | 100 |
| `configurability` 可配置性 | 换台机器、换个人能配好吗 | 25% | 100 |
| `security` 安全性 | 敢不敢公开 | 40% | 100 |

`total = round(0.35 * runnability + 0.25 * configurability + 0.40 * security)`

安全占 40% 的理由：题面把密钥风险列为一等风险，而"能跑但泄密"的后果重于"跑不起来"。该理由必须写进 README，避免被认为是随意加权。

### 5.2 扣分表

**可运行性（下限 0）**

| 规则 | 扣分 |
|---|---|
| `DEP-01` / `DEP-03` | -45 |
| `RUN-01` / `RUN-02` | -40 / -25 |
| `RUN-03` | -20 |
| `RD-03` | -15 |
| `DEP-02` | -10 |
| `RD-07` | -5 |

**可配置性（下限 0）**

| 规则 | 扣分 |
|---|---|
| `RD-01` | -55 |
| `RD-02` | -20 |
| `RD-04` | -15 |
| `PATH-01/02/03` | 每条 -8，该类合计上限 -30 |
| `SEC-06` 之外的配置缺失项 | 见下 |
| 代码读 env 但无 `.env.example` | -10 |

**安全性（下限 0）**

| 规则 | 扣分 |
|---|---|
| 每条 `critical` | -50 |
| 每条 `major`（安全组内） | -15，合计上限 -45 |
| `SEC-06` | -20 |
| `WIN-02` | -10 |

`info` / `minor` 在安全组不扣分。

### 5.3 封顶与兜底

- **封顶**：存在任一 `critical` → `total = min(total, 40)`，`score.capped = true`，`capReason` 写明命中的规则数。
- **空仓库兜底**：无 README、无依赖清单、无源码 → `total = 0`，标记 `EMPTY_REPO`，避免"什么都没有反而 100 分"。
- **抽样标注**：触发体量上限时，`score.confidence = "sampled"`，UI 显示"抽样分析，结论仅供参考"。

### 5.4 等级

| 分数 | 等级 | 含义 |
|---|---|---|
| 85–100 | A | 可直接接入，照 README 走即可 |
| 70–84 | B | 小修即可接入（补 1–2 处配置） |
| 50–69 | C | 需补齐依赖/脚本/配置后才能接入 |
| 0–49 | D | 不建议接入，先解决安全性或可运行性问题 |

---

## 6. 更新跟踪需求

| ID | 需求 |
|---|---|
| FR-U1 | 报告绑定 `source.commitSha`，缓存键为 `{owner}/{repo}@{sha}` |
| FR-U2 | 「检测更新」：`GET /repos/{o}/{r}/commits?sha={branch}&per_page=1` 取最新 SHA；相同则直接复用缓存报告，零重算 |
| FR-U3 | 差异计算：`GET /repos/{o}/{r}/compare/{base}...{head}` 得到 `files[].filename` 与 `status`；仅对变更文件重跑内容类规则，其余 finding 直接复用 |
| FR-U4 | 复用后必须重算评分（评分是 findings 的纯聚合，成本可忽略） |
| FR-U5 | 兜底矩阵：`compare` 404（force push / 跨 fork）或 `files.length > 300` → 全量重扫；`403/429` → 使用 `If-None-Match` 缓存校验，命中 304 则判定未变更 |
| FR-U6 | 页面展示 `旧分 → 新分` 与 `复用率`，作为增量能力可被肉眼验证的证据 |

> 后台定时调度（cron / GitHub App webhook）不在本期实现，但 README 必须给出设计说明——这是题面的显式要求。

---

## 7. 错误与降级矩阵

| 场景 | 检测方式 | 用户可见行为 | HTTP |
|---|---|---|---|
| 仓库不存在 / 私有 | `404` | "仓库不存在或为私有仓库" + 检查拼写提示 | 404 |
| 限流（匿名 60/h） | `403` + `X-RateLimit-Remaining: 0` | "匿名配额已用尽，请设置 GITHUB_TOKEN 或等待 HH:MM 重置" | 429 |
| 超大仓库 | `size > 50MB` 或文件数 > 5000 | 抽样分析 + 顶部黄色横幅 | 200 |
| tarball 解压失败 | 解析异常 | 回退 Contents API 拉关键文件，`degradations` 记一条 | 200 |
| 空仓库 | 无任何文件 | `EMPTY_REPO`，0 分，说明文案 | 200 |
| 网络超时 | 15s 超时 | "GitHub 响应超时，请重试" + 重试按钮 | 504 |
| LLM 失败 | 非 2xx / schema 不符 | 静默回退规则引擎，面板角标不变 | 200 |

---

## 8. 验收清单（Definition of Done）

- [ ] 干净 clone 后 `pnpm install && pnpm dev` 一条命令跑通，无 `.env` 也能分析至少 1 个真实仓库
- [ ] 六组规则全部有单测，每条规则至少 1 正例 1 反例
- [ ] `SEC-09` 占位符白名单有测试，`.env.example` 不被误报为 critical
- [ ] 同一 SHA 连跑两次 `findings` 与 `score` 完全一致
- [ ] 报告序列化结果中不含任何完整密钥（有断言）
- [ ] 5000 文件 / 50MB 上限有测试（可用生成器构造）
- [ ] 3 个离线 fixture 可出报告
- [ ] 「检测更新」在真实仓库上演示出"复用 N 条"的数字
- [ ] 无 Key 时 AI 面板正常降级，不空白不报错
- [ ] README 含：架构图、评分说明、更新跟踪设计、局限说明
- [ ] `AI_USAGE.md` 含 ≥1 条"AI 答错且被发现"的记录
- [ ] 所有 finding 都有 `file`，UI 无"无证据结论"
