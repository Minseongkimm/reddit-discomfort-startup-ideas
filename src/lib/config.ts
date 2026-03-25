const DEFAULT_MAX_STORED_POSTS = 25_000;
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "gemma3:4b-it-qat";

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

function getStringFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function getBooleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
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

export const LLM_CLASSIFIER_ENABLED = getBooleanFromEnv(
  "LLM_CLASSIFIER_ENABLED",
  false,
);
export const OLLAMA_BASE_URL = getStringFromEnv(
  "OLLAMA_BASE_URL",
  DEFAULT_OLLAMA_BASE_URL,
);
export const OLLAMA_MODEL = getStringFromEnv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL);
export const LLM_TIMEOUT_MS = getPositiveIntFromEnv("LLM_TIMEOUT_MS", 20_000);
export const LLM_MAX_RUNTIME_MS = getPositiveIntFromEnv(
  "LLM_MAX_RUNTIME_MS",
  6_000,
);
export const LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN = getPositiveIntFromEnv(
  "LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN",
  120,
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
