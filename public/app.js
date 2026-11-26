/* Repo Lens 前端：无框架、无构建，直接操作 DOM */

const output = document.getElementById('output');
const form = document.getElementById('form');
const input = document.getElementById('url');
const submitBtn = document.getElementById('submit');
const healthEl = document.getElementById('health');

let timer = null;
let elapsed = 0;
let findingsExpanded = false;
const FINDINGS_PAGE = 20;

/* ---------------- 工具 ---------------- */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);

const SEV_LABEL = { critical: '严重', major: '高', minor: '中', info: '提示' };
const GRADE_COLOR = { A: '#3ddc97', B: '#7fd8ff', C: '#f5b544', D: '#ff5f5f' };
const SUB_META = [
  { key: 'runnability', label: '可运行性', hint: 'clone 下来能跑起来吗', color: '#3ddc97' },
  { key: 'configurability', label: '可配置性', hint: '换台机器能配好吗', color: '#6aa8ff' },
  { key: 'security', label: '安全性', hint: '敢不敢公开', color: '#a78bfa' },
];
const GROUPS = [
  { key: 'readme', label: 'README 文档', color: '#6aa8ff' },
  { key: 'deps', label: '依赖清单', color: '#3ddc97' },
  { key: 'run', label: '启动脚本', color: '#7fd8ff' },
  { key: 'win', label: 'Windows 脚本', color: '#f5b544' },
  { key: 'path', label: '硬编码路径', color: '#a78bfa' },
  { key: 'secrets', label: '密钥风险', color: '#ff5f5f' },
];

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? '分析中…' : '开始体检';
}

/* ---------------- 渲染：加载 / 错误 ---------------- */

function renderLoading(url) {
  stopTimer();
  elapsed = 0;
  output.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>
        <div class="loading-title">正在分析 ${esc(url)}</div>
        <div class="loading-sub">拉取快照 → 解包 → 六组规则扫描 → 计算评分 · 已用 <span id="elapsed">0.0</span>s</div>
      </div>
    </div>`;
  timer = setInterval(() => {
    elapsed += 100;
    const el = document.getElementById('elapsed');
    if (el) el.textContent = (elapsed / 1000).toFixed(1);
  }, 100);
}

function renderError(err, url) {
  stopTimer();
  output.innerHTML = `
    <div class="error-card">
      <div class="error-code">${esc(err.code || 'ERROR')}</div>
      <div class="error-msg">${esc(err.message || '分析失败')}</div>
      ${err.hint ? `<div class="error-hint">${esc(err.hint)}</div>` : ''}
      ${err.resetAt ? `<div class="error-hint" style="margin-top:4px">配额重置时间：${esc(new Date(err.resetAt).toLocaleString('zh-CN'))}</div>` : ''}
      <button class="btn" style="margin-top:16px;padding:9px 18px;font-size:13px" id="retry">重试</button>
    </div>`;
  document.getElementById('retry').addEventListener('click', () => run(url));
}

/* ---------------- 渲染：报告 ---------------- */

function ringSvg(total, grade) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const dash = (total / 100) * c;
  const color = GRADE_COLOR[grade] || '#8695a6';
  return `<svg width="168" height="168" viewBox="0 0 168 168">
    <circle cx="84" cy="84" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="9"/>
    <circle cx="84" cy="84" r="${r}" fill="none" stroke="${color}" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 84 84)"/>
  </svg>
  <div class="ring-value">
    <div class="ring-num" style="color:${color}">${total}</div>
    <div class="ring-unit">接入就绪度</div>
  </div>`;
}

function barHtml(meta, sub) {
  const negatives = sub.deductions.filter((d) => d.points < 0);
  const details =
    negatives.length > 0
      ? `<details class="deductions"><summary>扣分明细（${negatives.length}）</summary>
          <ul class="ded-list">${negatives
            .map(
              (d) =>
                `<li><span class="pts">${d.points}</span><span class="rid">${esc(d.ruleId)}</span><span>${esc(d.note)}</span></li>`,
            )
            .join('')}</ul></details>`
      : `<div style="font-size:11.5px;color:var(--dim);margin-top:6px">${esc(meta.hint)} · 无扣分</div>`;

  return `<div>
    <div class="bar-head">
      <div><strong style="font-weight:600">${esc(meta.label)}</strong>
        <span style="color:var(--dim)">· 权重 ${Math.round(sub.weight * 100)}%</span></div>
      <b style="color:${meta.color}">${sub.score}</b>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${sub.score}%;background:${meta.color};opacity:.85"></div></div>
    ${details}
  </div>`;
}

function groupsHtml(findings) {
  return GROUPS.map((g) => {
    const items = findings.filter((f) => f.group === g.key);
    const serious = items.filter((f) => f.severity === 'critical' || f.severity === 'major').length;
    return `<div class="group-card" style="border-left:2px solid ${g.color}">
      <div class="group-name"><span>${esc(g.label)}</span>
        ${serious > 0 ? `<span style="color:${g.color};font-family:var(--mono);font-size:11px">${serious} 需处理</span>` : ''}
      </div>
      <div class="group-count" style="color:${serious > 0 ? g.color : 'var(--text)'}">${items.length}<small>条</small></div>
    </div>`;
  }).join('');
}

function findingsHtml(findings, expanded) {
  if (findings.length === 0) {
    return `<div class="empty-hint">没有发现问题。这个仓库在 README、依赖、启动脚本、跨平台与密钥五方面都没踩到规则。</div>`;
  }

  const counts = findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {});
  const summary = ['critical', 'major', 'minor', 'info']
    .filter((s) => counts[s])
    .map((s) => `<span class="sev sev-${s}">${SEV_LABEL[s]} ${counts[s]}</span>`)
    .join('');

  const visible = expanded ? findings : findings.slice(0, FINDINGS_PAGE);
  const rows = visible
    .map((f, i) => {
      const ctx = (f.context || [])
        .map(
          (c) =>
            `<div class="code-line${c.line === f.line ? ' hit' : ''}"><span class="ln">${c.line}</span><span>${esc(c.text) || ' '}</span></div>`,
        )
        .join('');
      return `<div class="finding" data-idx="${i}">
        <div class="finding-row">
          <span class="sev sev-${f.severity}">${SEV_LABEL[f.severity]}</span>
          <div class="finding-main">
            <div class="finding-title">${esc(f.title)}</div>
            <div class="finding-sub"><span class="rid">${esc(f.ruleId)}</span> · ${esc(f.file)}${f.line ? ':' + f.line : ''}${
              f.downgradedFrom ? `<span style="color:var(--dim)"> · 已从 ${esc(f.downgradedFrom)} 降级</span>` : ''
            }</div>
            ${f.detail ? `<div class="finding-detail">${esc(f.detail)}</div>` : ''}
          </div>
          <span class="caret">▼</span>
        </div>
        <div class="finding-body" hidden>
          ${ctx ? `<div class="code-block">${ctx}</div>` : ''}
          ${f.remediation ? `<div class="remediation">${esc(f.remediation)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');

  const more =
    findings.length > FINDINGS_PAGE
      ? `<button class="btn" id="toggle-findings" style="margin-top:14px;padding:8px 16px;font-size:12.5px">
          ${expanded ? '收起，只看前 20 条' : `展开全部 ${findings.length} 条（当前显示 ${FINDINGS_PAGE} 条）`}
        </button>`
      : '';

  return `<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;font-size:12.5px">
      <span style="color:var(--muted)">共 ${findings.length} 条</span>${summary}
    </div>
    <div class="risk-list">${rows}</div>
    ${more}`;
}

function adviceHtml(advice) {
  const isLLM = advice.source === 'llm';
  return `<div class="card">
    <div class="advice-head">
      <p class="card-title" style="margin:0">接入建议</p>
      <span class="badge" title="${esc(advice.degradedReason || '')}">
        <span class="dot${isLLM ? '' : ' warn'}"></span>
        ${isLLM ? 'AI · ' + esc(advice.model || 'llm') : '规则引擎（未启用 AI）'}
      </span>
    </div>
    <div class="advice-verdict">${esc(advice.verdict)}</div>
    <ul class="advice-list">${advice.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="actions">${advice.actions
      .map(
        (a, i) => `<div class="action"><span class="action-index">${i + 1}</span>
          <div><div class="action-title">${esc(a.title)}</div><div class="action-detail">${esc(a.detail)}</div></div></div>`,
      )
      .join('')}</div>
    ${advice.degradedReason ? `<div style="font-size:11.5px;color:var(--dim);margin-top:12px">降级原因：${esc(advice.degradedReason)}</div>` : ''}
  </div>`;
}

function bindFindings(report) {
  output.querySelectorAll('.finding-row').forEach((row) => {
    row.addEventListener('click', () => {
      const body = row.parentElement.querySelector('.finding-body');
      const caret = row.querySelector('.caret');
      if (!body) return;
      body.hidden = !body.hidden;
      caret.textContent = body.hidden ? '▼' : '▲';
    });
  });

  const toggle = document.getElementById('toggle-findings');
  if (toggle) {
    toggle.addEventListener('click', () => {
      findingsExpanded = !findingsExpanded;
      const wrap = document.getElementById('risk-list-wrap');
      if (!wrap) return;
      wrap.innerHTML = findingsHtml(report.findings, findingsExpanded);
      bindFindings(report);
    });
  }
}

function bindExport(report) {
  const btn = document.getElementById('export-json');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const name = `repo-lens-${report.source.owner}-${report.source.repo}-${report.source.shortSha}.json`;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
}

function renderReport(r) {
  stopTimer();
  findingsExpanded = false;
  const s = r.source;
  const color = GRADE_COLOR[r.score.grade] || '#8695a6';

  output.innerHTML = `<div class="report">
    <div class="card">
      <div class="repo-head">
        <div>
          <div class="repo-name">
            <a href="https://github.com/${esc(s.owner)}/${esc(s.repo)}" target="_blank" rel="noreferrer">
              <span class="owner">${esc(s.owner)}/</span>${esc(s.repo)}
            </a>
          </div>
          ${s.description ? `<div class="repo-desc">${esc(s.description)}</div>` : ''}
          <div class="meta-row">
            ${s.language ? `<span class="meta-item">${esc(s.language)}</span>` : ''}
            <span class="meta-item">★ ${Number(s.stars).toLocaleString()}</span>
            <span class="meta-item">${(s.sizeKb / 1024).toFixed(1)} MB</span>
            <span class="meta-item">commit <code>${esc(s.shortSha)}</code></span>
            <span class="meta-item">${r.stats.textFiles} 文本 / ${r.stats.totalFiles} 文件</span>
            <span class="meta-item">分析 ${ms(r.timings.total)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <span class="badge"><span class="dot"></span>规则集 v${esc(r.rulesetVersion)}</span>
          ${r.score.confidence === 'sampled' ? '<span class="badge" style="color:var(--warn)">抽样 / 降级分析</span>' : ''}
          ${s.archived ? '<span class="badge" style="color:var(--warn)">仓库已归档</span>' : ''}
          <button class="btn" id="export-json" style="padding:7px 14px;font-size:12.5px">下载 JSON</button>
        </div>
      </div>
    </div>

    <div class="score-grid">
      <div class="card ring-card">
        <div class="ring-wrap">${ringSvg(r.score.total, r.score.grade)}</div>
        <div class="grade-pill" style="color:${color}">${esc(r.score.grade)} 级</div>
        ${r.score.capReason ? `<div class="cap-note">${esc(r.score.capReason)}</div>` : ''}
      </div>
      <div class="card">
        <p class="card-title">三个维度</p>
        <div class="bars">${SUB_META.map((m) => barHtml(m, r.score.sub[m.key])).join('')}</div>
      </div>
    </div>

    ${
      r.degradations && r.degradations.length
        ? `<div class="degradations">${r.degradations.map((d) => `<div>· ${esc(d)}</div>`).join('')}</div>`
        : ''
    }

    <div class="card"><p class="card-title">检测覆盖面</p><div class="groups">${groupsHtml(r.findings)}</div></div>
    <div class="card"><p class="card-title">主要风险清单</p><div id="risk-list-wrap">${findingsHtml(r.findings, findingsExpanded)}</div></div>

    ${adviceHtml(r.advice)}

    <div class="foot">
      <span>报告基于 commit ${esc(s.shortSha)} · ${esc(s.ref)}</span>
      <span>meta ${ms(r.timings.meta)} · fetch ${ms(r.timings.fetch)} · unpack ${ms(r.timings.unpack)} · scan ${ms(r.timings.scan)}</span>
    </div>
  </div>`;

  bindFindings(r);
  bindExport(r);
}

/* ---------------- 交互 ---------------- */

async function run(target) {
  const url = String(target || '').trim();
  if (!url) return;
  input.value = url;
  setBusy(true);
  renderLoading(url);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderError(data.error || { message: '分析失败' }, url);
    } else {
      renderReport(data);
    }
  } catch {
    renderError({ code: 'NETWORK', message: '无法连接本地服务', hint: '确认服务仍在运行后重试' }, url);
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  run(input.value);
});

document.getElementById('samples').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  run(`https://github.com/${chip.dataset.repo}`);
});

fetch('/api/health')
  .then((r) => r.json())
  .then((h) => {
    healthEl.hidden = false;
    healthEl.title = '未配置 token 时走匿名配额（60 次/小时）';
    healthEl.innerHTML = `<span class="dot${h.githubToken ? '' : ' warn'}"></span>
      ${h.githubToken ? 'Token 已配置' : '匿名模式 60/h'}
      <span style="color:var(--dim)">·</span>
      ${h.llm ? 'AI 已启用' : 'AI 未启用'}`;
  })
  .catch(() => {});

/* 支持 /?url=https://github.com/o/r 或 /?repo=o/r 直接出报告（便于分享链接） */
const params = new URLSearchParams(location.search);
const initial = params.get('url') || params.get('repo');
if (initial) {
  run(initial.startsWith('http') ? initial : `https://github.com/${initial}`);
}
