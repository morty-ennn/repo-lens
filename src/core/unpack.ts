import { gunzipSync } from 'node:zlib';
import { AnalyzeError } from './errors.ts';
import { isTextPath, langOf, MAX_FILE_BYTES, MAX_FILES } from './lexicon.ts';
import type { FileRecord } from './types.ts';

export interface UnpackResult {
  files: Map<string, FileRecord>;
  skipped: number;
  archivePrefix: string | null;
}

interface TarEntry {
  name: string;
  size: number;
  offset: number;
  type: string;
}

/**
 * 最小 tar 解析器：只认 GitHub tarball 会出现的几种 header。
 * 支持 ustar 前缀、GNU longname（L）、PAX 扩展头（x）——长路径在 GitHub 上很常见。
 */
function parseTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let pos = 0;
  let pendingName: string | null = null;

  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;

    const rawName = readStr(header, 0, 100);
    const magic = readStr(header, 257, 6);
    const prefix = magic.startsWith('ustar') ? readStr(header, 345, 155) : '';
    const size = parseInt(readStr(header, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = pos + 512;

    if (type === 'L') {
      pendingName = readStr(buf.subarray(dataStart, dataStart + size), 0, size).replace(/\0+$/, '');
    } else if (type === 'x' || type === 'g') {
      const body = buf.subarray(dataStart, dataStart + size).toString('utf8');
      const m = body.match(/(?:^|\n)\d+ path=([^\n]*)/);
      if (m) pendingName = m[1];
    } else {
      let name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      pendingName = null;
      name = name.replace(/\0+$/, '');
      if (name) out.push({ name, size, offset: dataStart, type });
    }

    pos = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

function readStr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, Math.min(start + len, buf.length));
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8');
}

export function unpackTarball(buf: Buffer): UnpackResult {
  let raw: Buffer;
  try {
    raw = gunzipSync(buf, { maxOutputLength: 400 * 1024 * 1024 });
  } catch {
    throw new AnalyzeError('UNPACK_FAILED', '仓库快照解压失败，可能不是合法的 tar.gz', {
      httpStatus: 502,
      retryable: true,
    });
  }

  const entries = parseTar(raw);
  const files = new Map<string, FileRecord>();
  let skipped = 0;
  let archivePrefix: string | null = null;

  for (const entry of entries) {
    if (entry.type !== '0' && entry.type !== '\0') continue;

    const name = entry.name.replace(/^\.\//, '');
    const slash = name.indexOf('/');
    if (slash > 0 && archivePrefix === null) archivePrefix = name.slice(0, slash);
    const rel = slash > 0 ? name.slice(slash + 1) : name;
    if (!rel || rel.endsWith('/')) continue;

    if (files.size >= MAX_FILES) {
      skipped++;
      continue;
    }

    if (!isTextPath(rel) || entry.size > MAX_FILE_BYTES) {
      skipped++;
      files.set(rel, { path: rel, size: entry.size, kind: 'binary', lang: langOf(rel), lines: null });
      continue;
    }

    const content = raw.subarray(entry.offset, entry.offset + entry.size).toString('utf8');
    files.set(rel, {
      path: rel,
      size: entry.size,
      kind: 'text',
      lang: langOf(rel),
      lines: content.replace(/^\uFEFF/, '').split(/\r?\n/),
    });
  }

  return { files, skipped, archivePrefix };
}
