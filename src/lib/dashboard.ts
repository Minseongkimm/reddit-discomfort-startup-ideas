import { readDashboardSnapshot, writeDashboardSnapshot } from "./dashboard-snapshot";
import { analyzeProblemsFromPosts, type AnalyzeOptions } from "./problem-analyzer";
import { readStore } from "./store";
import type { DashboardData } from "./types";

function isSnapshotFresh(snapshot: DashboardData, expected: { lastSyncAt: string | null; mode: DashboardData["mode"]; scannedPostCount: number; }): boolean {
  return (
    snapshot.lastSyncAt === expected.lastSyncAt &&
    snapshot.mode === expected.mode &&
    snapshot.scannedPostCount === expected.scannedPostCount
  );
}

function hasPainIndexCoverage(snapshot: DashboardData): boolean {
  return snapshot.results.every((subreddit) =>
    subreddit.problems.every((problem) => Number.isFinite(problem.painIndex)),
  );
}

function buildDashboardData(params: {
  lastSyncAt: string | null;
  mode: DashboardData["mode"];
  scannedPostCount: number;
  results: DashboardData["results"];
}): DashboardData {
  const totalProblems = params.results.reduce(
    (sum, subreddit) => sum + subreddit.problems.length,
    0,
  );

  return {
    results: params.results,
    scannedPostCount: params.scannedPostCount,
    totalProblems,
    activeSubredditCount: params.results.length,
    lastSyncAt: params.lastSyncAt,
    mode: params.mode,
  };
}

export async function rebuildDashboardSnapshot(options: AnalyzeOptions = {}): Promise<DashboardData> {
  const store = await readStore();
  const posts = Object.values(store.posts);
  const results = await analyzeProblemsFromPosts(posts, options);

  const data = buildDashboardData({
    lastSyncAt: store.lastSyncAt,
    mode: store.mode,
    scannedPostCount: posts.length,
    results,
  });

  await writeDashboardSnapshot(data);

  return data;
}

export async function getDashboardData(): Promise<DashboardData> {
  const store = await readStore();
  const posts = Object.values(store.posts);
  const expected = {
    lastSyncAt: store.lastSyncAt,
    mode: store.mode,
    scannedPostCount: posts.length,
  };

  const snapshot = await readDashboardSnapshot();
  if (snapshot && isSnapshotFresh(snapshot, expected) && hasPainIndexCoverage(snapshot)) {
    return snapshot;
  }

  return rebuildDashboardSnapshot();
}
