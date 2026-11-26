import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { analyzeUrl } from './src/core/analyze.ts';
import { AnalyzeError } from './src/core/errors.ts';
import { hasToken } from './src/core/github.ts';
import { RULESET_VERSION } from './src/core/lexicon.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');
const MAX_BODY = 1_000_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res: ServerResponse, filePath: string): void {
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new AnalyzeError('INVALID_URL', '请求体过大', { httpStatus: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: { url?: unknown; useLLM?: unknown };
  try {
    payload = JSON.parse(await readBody(req)) as { url?: unknown };
  } catch (err) {
    if (err instanceof AnalyzeError) return sendJson(res, err.httpStatus, { error: { code: err.code, message: err.message } });
    return sendJson(res, 400, { error: { code: 'INVALID_URL', message: '请求体不是合法的 JSON' } });
  }

  const url = typeof payload?.url === 'string' ? payload.url : '';
  if (!url) {
    return sendJson(res, 400, { error: { code: 'INVALID_URL', message: '缺少 url 参数' } });
  }

  try {
    const report = await analyzeUrl(url, { useLLM: payload.useLLM !== false });
    sendJson(res, 200, report);
  } catch (err) {
    if (err instanceof AnalyzeError) {
      return sendJson(res, err.httpStatus, {
        error: {
          code: err.code,
          message: err.message,
          hint: err.hint,
          retryable: err.retryable,
          resetAt: err.resetAt,
        },
      });
    }
    console.error('[analyze] unexpected', err);
    sendJson(res, 500, {
      error: { code: 'INTERNAL', message: '分析过程中出现未预期错误', hint: '请查看终端日志' },
    });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    await handleAnalyze(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      githubToken: hasToken(),
      llm: Boolean(process.env.LLM_API_KEY),
      llmModel: process.env.LLM_MODEL ?? 'deepseek-chat',
      rulesetVersion: RULESET_VERSION,
    });
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = normalize(join(PUBLIC_DIR, rel));
    if (!target.startsWith(PUBLIC_DIR) || !existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    return sendFile(res, target);
  }

  sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的方法' } });
});

server.listen(PORT, () => {
  console.log(`\n  Repo Lens 已启动 → http://localhost:${PORT}`);
  console.log(`  GitHub Token: ${hasToken() ? '已配置' : '未配置（匿名 60 次/小时）'}`);
  console.log(`  LLM: ${process.env.LLM_API_KEY ? process.env.LLM_MODEL ?? 'deepseek-chat' : '未配置（走规则引擎）'}\n`);
});
