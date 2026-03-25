import type { StoredPost } from "./types";

type RedditTokenResponse = {
  access_token: string;
  expires_in: number;
};

type RedditListingChild = {
  data: {
    id: string;
    subreddit: string;
    title: string;
    selftext?: string;
    score: number;
    num_comments: number;
    created_utc: number;
    permalink: string;
    url?: string;
  };
};

type RedditListingResponse = {
  data: {
    after: string | null;
    children: RedditListingChild[];
  };
};

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

export function isRedditConfigured() {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

function getUserAgent() {
  return process.env.REDDIT_USER_AGENT ?? "web:reddit-discomfort-collector:v0.1 (by /u/local-user)";
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": getUserAgent(),
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Reddit 토큰 발급 실패 (${response.status}): ${detail.slice(0, 200)}`);
  }

  const tokenPayload = (await response.json()) as RedditTokenResponse;
  cachedToken = {
    value: tokenPayload.access_token,
    expiresAt: Date.now() + tokenPayload.expires_in * 1000,
  };

  return tokenPayload.access_token;
}

function normalizeSubreddit(input: string) {
  return input.startsWith("r/") ? input : `r/${input}`;
}

export async function fetchSubredditNew(params: {
  subreddit: string;
  after?: string | null;
  limit?: number;
}) {
  const subreddit = normalizeSubreddit(params.subreddit);
  const token = await getAccessToken();

  const url = new URL(`${API_BASE}/${subreddit}/new`);
  url.searchParams.set("limit", String(params.limit ?? 100));
  url.searchParams.set("raw_json", "1");

  if (params.after) {
    url.searchParams.set("after", params.after);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": getUserAgent(),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `${subreddit} 조회 실패 (${response.status}): ${detail.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as RedditListingResponse;

  const posts: StoredPost[] = payload.data.children.map((child) => {
    const data = child.data;

    return {
      id: data.id,
      subreddit: `r/${data.subreddit}`,
      title: data.title ?? "",
      body: data.selftext ?? "",
      score: data.score ?? 0,
      comments: data.num_comments ?? 0,
      createdUtc: data.created_utc ?? 0,
      permalink: `https://reddit.com${data.permalink}`,
      url: data.url ?? `https://reddit.com${data.permalink}`,
      fetchedAt: new Date().toISOString(),
    };
  });

  return {
    posts,
    after: payload.data.after,
  };
}
