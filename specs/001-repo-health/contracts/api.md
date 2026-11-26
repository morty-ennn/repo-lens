# 接口契约 · HTTP API

Base: `http://localhost:3000`　|　全部响应 `application/json; charset=utf-8`

---

## 错误信封（所有端点统一）

```json
{
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "仓库不存在或为私有仓库",
    "hint": "请检查 owner/repo 拼写，或确认仓库已公开",
    "retryable": false,
    "resetAt": null
  }
}
```

| code | HTTP | 含义 | retryable |
|---|---|---|---|
| `INVALID_URL` | 400 | 无法解析为 GitHub 仓库 | false |
| `UNSUPPORTED_HOST` | 400 | 非 github.com | false |
| `REPO_NOT_FOUND` | 404 | 不存在或私有 | false |
| `RATE_LIMITED` | 429 | 配额耗尽，`resetAt` 给出 ISO 时间 | true |
| `REPO_TOO_LARGE` | 413 | 超过 5000 文件 / 50MB 且拒绝抽样 | true |
| `UPSTREAM_TIMEOUT` | 504 | GitHub 超时 | true |
| `UNPACK_FAILED` | 502 | tarball 解析失败且回退也失败 | true |
| `INTERNAL` | 500 | 未预期错误，堆栈只写日志 | true |

---

## 1. `POST /api/analyze`

**请求**

```json
{
  "url": "https://github.com/vercel/next.js",
  "ref": "canary",              // 可选，缺省用 default_branch
  "baseSha": "a1b2c3d...",      // 可选，存在则走增量
  "options": { "useLLM": true, "maxFiles": 5000 }
}
```

**响应 200（节选，完整结构见 `data-model.md`）**

```json
{
  "id": "vercel__next.js__a1b2c3d",
  "schemaVersion": 1,
  "rulesetVersion": "1.0.0",
  "source": {
    "owner": "vercel", "repo": "next.js", "ref": "canary",
    "commitSha": "a1b2c3d4e5f6...", "shortSha": "a1b2c3d",
    "fetchedAt": "2026-01-01T02:03:04.000Z",
    "stars": 128000, "language": "JavaScript", "archived": false, "sizeKb": 480000
  },
  "score": {
    "total": 62, "grade": "C",
    "sub": {
      "runnability":      { "score": 78, "weight": 0.35, "deductions": [{ "ruleId": "DEP-02", "points": -10, "note": "无 lockfile" }] },
      "configurability":  { "score": 55, "weight": 0.25, "deductions": [{ "ruleId": "PATH-01", "points": -8, "note": "2 处 C:\\ 路径" }] },
      "security":         { "score": 52, "weight": 0.40, "deductions": [{ "ruleId": "SEC-06", "points": -20, "note": ".gitignore 未忽略 .env" }] }
    },
    "capped": false, "capReason": null, "confidence": "exact"
  },
  "findings": [
    {
      "ruleId": "PATH-01", "group": "path", "severity": "major",
      "title": "硬编码 Windows 绝对路径",
      "file": "scripts/build.js", "line": 12,
      "excerpt": "const out = 'C:\\\\Users\\\\dev\\\\build';",
      "detail": "路径绑定开发者本机目录，换机即失败",
      "remediation": "改为 path.resolve(__dirname, 'build')",
      "weight": 8
    }
  ],
  "stats": { "filesScanned": 4210, "filesSkipped": 790, "textFiles": 4100, "binaryFiles": 110 },
  "timings": { "meta": 320, "fetch": 2100, "unpack": 410, "scan": 980, "score": 12, "explain": 1400, "total": 5222 },
  "sampling": null,
  "degradations": [],
  "advice": {
    "source": "llm", "model": "deepseek-chat",
    "verdict": "结构完整但存在路径绑定与环境配置缺失，修复后可接入",
    "reasons": ["依赖齐全", "启动脚本存在", "配置说明缺失"],
    "actions": [{ "title": "补齐 .env 说明", "detail": "README 增加环境变量章节", "severity": "minor" }]
  },
  "diff": {
    "baseSha": "fffffff...", "headSha": "a1b2c3d...",
    "changedFiles": ["package.json", "scripts/build.js"],
    "reusedFindings": 41, "rescannedFiles": 2,
    "scoreBefore": 58, "fallbackReason": null
  },
  "analyzedAt": "2026-01-01T02:03:09.000Z"
}
```

---

## 2. `GET /api/report?url=&sha=`

读缓存报告，用于刷新页面不重算。

- 命中：`200` + `Report`
- 未命中：`404` + `{ error: { code: "NOT_CACHED" } }`

响应头附 `X-Cache: HIT|MISS`。

---

## 3. `GET /api/fixture/{name}`

离线样例，`name ∈ {node-good, python-good, bad-everything}`。

- 响应与 `POST /api/analyze` 的 200 完全同构，`source.owner = "fixture"`，`degradations` 含 `"离线样例数据，非实时分析"`。
- 用于网络不可用时的演示兜底（Constitution 第二条）。

---

## 4. `GET /api/health`

**只返回布尔，不泄漏任何配置值。**

```json
{ "ok": true, "githubToken": false, "llm": true, "llmModel": "deepseek-chat", "rulesetVersion": "1.0.0", "cacheReports": 12 }
```

UI 用它在首页显示"当前为匿名模式，60 次/小时"的提示条。

---

## 5. CORS 与缓存头

- 同源，不开放 CORS（`Access-Control-Allow-Origin` 不设置）。
- `POST /api/analyze` 响应 `Cache-Control: no-store`（避免中间层缓存带密钥的报告）。
- `GET /api/fixture/*` 可 `public, max-age=3600`。
