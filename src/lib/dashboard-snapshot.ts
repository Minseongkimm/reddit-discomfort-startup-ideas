import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DashboardData } from "./types";

type DashboardSnapshotFile = {
  version: number;
  generatedAt: string;
  data: DashboardData;
};

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_DIR = path.join(process.cwd(), ".data");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "dashboard-snapshot.json");
let snapshotMutex: Promise<void> = Promise.resolve();

async function withSnapshotLock<T>(task: () => Promise<T>): Promise<T> {
  const start = snapshotMutex;
  let release: () => void = () => {};

  snapshotMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  await start;

  try {
    return await task();
  } finally {
    release();
  }
}

async function ensureSnapshotDir() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
}

function isValidDashboardData(value: unknown): value is DashboardData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DashboardData>;

  return (
    Array.isArray(candidate.results) &&
    typeof candidate.scannedPostCount === "number" &&
    typeof candidate.totalProblems === "number" &&
    typeof candidate.activeSubredditCount === "number" &&
    (candidate.lastSyncAt === null || typeof candidate.lastSyncAt === "string") &&
    (candidate.mode === "live" || candidate.mode === "sample" || candidate.mode === "empty")
  );
}

function normalizeSnapshot(value: unknown): DashboardData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (isValidDashboardData(value)) {
    return value;
  }

  const candidate = value as Partial<DashboardSnapshotFile>;
  if (!isValidDashboardData(candidate.data)) {
    return null;
  }

  return candidate.data;
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

async function writeSnapshotFile(data: DashboardData): Promise<void> {
  const payload: DashboardSnapshotFile = {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    data,
  };

  const tempFile = `${SNAPSHOT_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempFile, SNAPSHOT_FILE);
}

export async function readDashboardSnapshot(): Promise<DashboardData | null> {
  return withSnapshotLock(async () => {
    await ensureSnapshotDir();

    try {
      const raw = await readFile(SNAPSHOT_FILE, "utf8");
      const parsed = parseJsonWithRecovery(raw);

      if (!parsed) {
        return null;
      }

      const normalized = normalizeSnapshot(parsed.value);
      if (!normalized) {
        return null;
      }

      if (parsed.recovered) {
        await writeSnapshotFile(normalized);
      }

      return normalized;
    } catch {
      return null;
    }
  });
}

export async function writeDashboardSnapshot(data: DashboardData): Promise<void> {
  await withSnapshotLock(async () => {
    await ensureSnapshotDir();
    await writeSnapshotFile(data);
  });
}
