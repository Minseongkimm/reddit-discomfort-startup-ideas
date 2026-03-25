import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataMode, RedditStore } from "./types";

const STORE_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(STORE_DIR, "reddit-store.json");
const STORE_VERSION = 1;

const EMPTY_STORE: RedditStore = {
  version: STORE_VERSION,
  lastSyncAt: null,
  mode: "empty",
  subreddits: {},
  posts: {},
};

let storeMutex: Promise<void> = Promise.resolve();

async function ensureStoreFile() {
  await mkdir(STORE_DIR, { recursive: true });

  try {
    await readFile(STORE_FILE, "utf8");
  } catch {
    await writeFile(STORE_FILE, JSON.stringify(EMPTY_STORE, null, 2), "utf8");
  }
}

function normalizeMode(value: unknown): DataMode {
  if (value === "live" || value === "sample" || value === "empty") {
    return value;
  }
  return "empty";
}

function normalizeStore(value: unknown): RedditStore {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_STORE };
  }

  const candidate = value as Partial<RedditStore>;

  return {
    version: STORE_VERSION,
    lastSyncAt: typeof candidate.lastSyncAt === "string" ? candidate.lastSyncAt : null,
    mode: normalizeMode(candidate.mode),
    subreddits:
      candidate.subreddits && typeof candidate.subreddits === "object"
        ? candidate.subreddits
        : {},
    posts:
      candidate.posts && typeof candidate.posts === "object" ? candidate.posts : {},
  };
}

export async function readStore(): Promise<RedditStore> {
  await ensureStoreFile();
  const raw = await readFile(STORE_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

export async function writeStore(store: RedditStore) {
  await ensureStoreFile();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function withStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const start = storeMutex;
  let release: () => void = () => {};

  storeMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  await start;

  try {
    return await task();
  } finally {
    release();
  }
}

export async function updateStore<T>(
  updater: (store: RedditStore) => Promise<{ store: RedditStore; result: T }> | { store: RedditStore; result: T },
): Promise<T> {
  return withStoreLock(async () => {
    const current = await readStore();
    const next = await updater(current);
    await writeStore(next.store);
    return next.result;
  });
}
