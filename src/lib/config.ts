const DEFAULT_MAX_STORED_POSTS = 25_000;

function getPositiveIntFromEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const DEFAULT_SUBREDDITS = [
  "r/smallbusiness",
  "r/freelance",
  "r/startups",
  "r/SaaS",
  "r/Entrepreneur",
  "r/ecommerce",
  "r/marketing",
  "r/solopreneur",
  "r/agency",
  "r/sideproject",
  "r/indiehackers",
  "r/bootstrapped",
  "r/onlinebusiness",
  "r/sales",
  "r/CRM",
  "r/customer_success",
  "r/productmanagement",
  "r/UXResearch",
  "r/UserExperience",
  "r/SEO",
  "r/PPC",
  "r/content_marketing",
  "r/Emailmarketing",
  "r/webdev",
  "r/nocode",
  "r/shopify",
  "r/EntrepreneurRideAlong",
  "r/remotework",
  "r/digitalnomad",
  "r/growmybusiness",
] as const;

export const SYNC_LIMIT_PER_REQUEST = 100;
export const INITIAL_BACKFILL_PAGES = 2;
export const INCREMENTAL_PAGES = 1;
export const MAX_STORED_POSTS = getPositiveIntFromEnv(
  "MAX_STORED_POSTS",
  DEFAULT_MAX_STORED_POSTS,
);

export function getTargetSubreddits(): string[] {
  const fromEnv = process.env.REDDIT_SUBREDDITS;

  if (!fromEnv) {
    return [...DEFAULT_SUBREDDITS];
  }

  return fromEnv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("r/") ? item : `r/${item}`));
}
