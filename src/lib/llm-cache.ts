import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type LlmPostClassification = {
  isProblem: boolean;
  ruleIds: string[];
  severity: number;
  confidence: number;
  reason: string;
  solution: string;
};

export type LlmCacheEntry = {
  signature: string;
  model: string;
  updatedAt: string;
  result: LlmPostClassification;
};

export type LlmCacheFile = {
  version: number;
  entries: Record<string, LlmCacheEntry>;
};

const CACHE_VERSION = 1;
const CACHE_DIR = path.join(process.cwd(), ".data");
const CACHE_FILE = path.join(CACHE_DIR, "llm-cache.json");
let cacheMutex: Promise<void> = Promise.resolve();

function emptyCache(): LlmCacheFile {
  return {
    version: CACHE_VERSION,
    entries: {},
  };
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.max(min, Math.min(max, parsed));
  return clamped;
}

function normalizeResult(value: unknown): LlmPostClassification {
  if (!value || typeof value !== "object") {
    return {
      isProblem: false,
      ruleIds: [],
      severity: 3,
      confidence: 0,
      reason: "",
      solution: "",
    };
  }

  const candidate = value as Partial<LlmPostClassification>;

  return {
    isProblem: Boolean(candidate.isProblem),
    ruleIds: Array.isArray(candidate.ruleIds)
      ? candidate.ruleIds.filter((item): item is string => typeof item === "string")
      : [],
    severity: Math.round(normalizeNumber(candidate.severity, 3, 1, 5)),
    confidence: normalizeNumber(candidate.confidence, 0, 0, 1),
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
    solution: typeof candidate.solution === "string" ? candidate.solution : "",
  };
}

function normalizeCache(value: unknown): LlmCacheFile {
  if (!value || typeof value !== "object") {
    return emptyCache();
  }

  const candidate = value as Partial<LlmCacheFile>;
  const entries: Record<string, LlmCacheEntry> = {};

  if (candidate.entries && typeof candidate.entries === "object") {
    for (const [key, rawEntry] of Object.entries(candidate.entries)) {
      if (!rawEntry || typeof rawEntry !== "object") {
        continue;
      }

      const entry = rawEntry as Partial<LlmCacheEntry>;
      if (typeof entry.signature !== "string" || typeof entry.model !== "string") {
        continue;
      }

      entries[key] = {
        signature: entry.signature,
        model: entry.model,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
        result: normalizeResult(entry.result),
      };
    }
  }

  return {
    version: CACHE_VERSION,
    entries,
  };
}

async function withCacheLock<T>(task: () => Promise<T>): Promise<T> {
  const start = cacheMutex;
  let release: () => void = () => {};

  cacheMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  await start;

  try {
    return await task();
  } finally {
    release();
  }
}

function findFirstJsonEnd(raw: string): number {
  let start = -1;

  for (let i = 0; i < raw.length; i += 1) {
    if (!/\s/.test(raw[i])) {
      start = i;
      break;
    }
  }

  if (start === -1) {
    return -1;
  }

  const first = raw[start];
  if (first !== "{" && first !== "[") {
    return -1;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
}

function parseJsonWithRecovery(raw: string): { value: unknown; recovered: boolean } | null {
  try {
    return {
      value: JSON.parse(raw),
      recovered: false,
    };
  } catch {
    const end = findFirstJsonEnd(raw);
    if (end === -1) {
      return null;
    }

    try {
      return {
        value: JSON.parse(raw.slice(0, end)),
        recovered: true,
      };
    } catch {
      return null;
    }
  }
}

async function ensureCacheFile() {
  await mkdir(CACHE_DIR, { recursive: true });

  try {
    await readFile(CACHE_FILE, "utf8");
  } catch {
    await writeFile(CACHE_FILE, JSON.stringify(emptyCache(), null, 2), "utf8");
  }
}

async function writeCacheFile(cache: LlmCacheFile) {
  const payload = JSON.stringify(normalizeCache(cache), null, 2);
  const tempFile = `${CACHE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, payload, "utf8");
  await rename(tempFile, CACHE_FILE);
}

export async function readLlmCache() {
  return withCacheLock(async () => {
    await ensureCacheFile();
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = parseJsonWithRecovery(raw);

    if (!parsed) {
      const fallback = emptyCache();
      await writeCacheFile(fallback);
      return fallback;
    }

    const normalized = normalizeCache(parsed.value);
    if (parsed.recovered) {
      await writeCacheFile(normalized);
    }

    return normalized;
  });
}

export async function writeLlmCache(cache: LlmCacheFile) {
  await withCacheLock(async () => {
    await ensureCacheFile();
    await writeCacheFile(cache);
  });
}

export function buildPostSignature(title: string, body: string): string {
  return createHash("sha1")
    .update(title)
    .update("\n")
    .update(body)
    .digest("hex");
}
