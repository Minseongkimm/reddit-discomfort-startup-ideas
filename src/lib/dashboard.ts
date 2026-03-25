import { extractProblemsFromPosts } from "./extractor";
import { readStore } from "./store";
import type { DashboardData } from "./types";

export async function getDashboardData(): Promise<DashboardData> {
  const store = await readStore();
  const posts = Object.values(store.posts);
  const results = extractProblemsFromPosts(posts);

  const totalProblems = results.reduce(
    (sum, subreddit) => sum + subreddit.problems.length,
    0,
  );

  return {
    results,
    scannedPostCount: posts.length,
    totalProblems,
    activeSubredditCount: results.length,
    lastSyncAt: store.lastSyncAt,
    mode: store.mode,
  };
}
