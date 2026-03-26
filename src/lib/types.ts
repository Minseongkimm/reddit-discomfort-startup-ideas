export type DataMode = "live" | "sample" | "empty";

export type StoredPost = {
  id: string;
  subreddit: string;
  title: string;
  body: string;
  score: number;
  comments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  fetchedAt: string;
};

export type SubredditState = {
  after: string | null;
  lastFetchedAt: string | null;
};

export type RedditStore = {
  version: number;
  lastSyncAt: string | null;
  mode: DataMode;
  subreddits: Record<string, SubredditState>;
  posts: Record<string, StoredPost>;
};

export type ProblemItem = {
  id: string;
  statement: string;
  signal: string;
  frequency: number;
  severity: number;
  evidence: string;
  sourceUrl: string;
  llmReason?: string;
  llmSolution?: string;
};

export type SubredditResult = {
  subreddit: string;
  scannedPosts: number;
  problems: ProblemItem[];
};

export type DashboardData = {
  results: SubredditResult[];
  scannedPostCount: number;
  totalProblems: number;
  activeSubredditCount: number;
  lastSyncAt: string | null;
  mode: DataMode;
};
