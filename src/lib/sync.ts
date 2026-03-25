import {
  INCREMENTAL_PAGES,
  INITIAL_BACKFILL_PAGES,
  MAX_STORED_POSTS,
  SYNC_LIMIT_PER_REQUEST,
  getTargetSubreddits,
} from "./config";
import { fetchSubredditNew, isRedditConfigured } from "./reddit-client";
import { getSamplePosts } from "./sample-posts";
import { updateStore } from "./store";
import type { DataMode, RedditStore, StoredPost } from "./types";

export type SyncSummary = {
  ok: boolean;
  mode: DataMode;
  subreddits: number;
  requests: number;
  newPosts: number;
  totalStoredPosts: number;
  lastSyncAt: string;
};

function prunePosts(store: RedditStore): RedditStore {
  const posts = Object.values(store.posts);

  if (posts.length <= MAX_STORED_POSTS) {
    return store;
  }

  posts.sort((a, b) => b.createdUtc - a.createdUtc);
  const kept = posts.slice(0, MAX_STORED_POSTS);

  const nextPosts: Record<string, StoredPost> = {};

  for (const post of kept) {
    nextPosts[post.id] = post;
  }

  return {
    ...store,
    posts: nextPosts,
  };
}

function upsertPosts(store: RedditStore, posts: StoredPost[]) {
  let newPosts = 0;

  for (const post of posts) {
    if (!store.posts[post.id]) {
      newPosts += 1;
    }
    store.posts[post.id] = post;
  }

  return newPosts;
}

export async function syncRedditData(): Promise<SyncSummary> {
  const now = new Date().toISOString();

  if (!isRedditConfigured()) {
    return updateStore(async (store) => {
      const samplePosts = getSamplePosts();
      const newPosts = upsertPosts(store, samplePosts);
      const uniqueSubreddits = Array.from(new Set(samplePosts.map((post) => post.subreddit)));

      for (const subreddit of uniqueSubreddits) {
        store.subreddits[subreddit] = {
          after: null,
          lastFetchedAt: now,
        };
      }

      const pruned = prunePosts({
        ...store,
        lastSyncAt: now,
        mode: "sample",
      });

      return {
        store: pruned,
        result: {
          ok: true,
          mode: "sample",
          subreddits: uniqueSubreddits.length,
          requests: 0,
          newPosts,
          totalStoredPosts: Object.keys(pruned.posts).length,
          lastSyncAt: now,
        },
      };
    });
  }

  const targets = getTargetSubreddits();

  return updateStore(async (store) => {
    if (store.mode === "sample") {
      store.posts = {};
      store.subreddits = {};
    }

    let requests = 0;
    let newPosts = 0;

    for (const subreddit of targets) {
      const key = subreddit.startsWith("r/") ? subreddit : `r/${subreddit}`;
      const state = store.subreddits[key] ?? {
        after: null,
        lastFetchedAt: null,
      };

      const pagesToFetch = state.after ? INCREMENTAL_PAGES : INITIAL_BACKFILL_PAGES;
      let cursor = state.after;

      for (let page = 0; page < pagesToFetch; page += 1) {
        const listing = await fetchSubredditNew({
          subreddit: key,
          after: cursor,
          limit: SYNC_LIMIT_PER_REQUEST,
        });

        requests += 1;
        newPosts += upsertPosts(store, listing.posts);

        if (!listing.after || listing.after === cursor) {
          break;
        }

        cursor = listing.after;
      }

      store.subreddits[key] = {
        after: cursor,
        lastFetchedAt: now,
      };
    }

    const pruned = prunePosts({
      ...store,
      lastSyncAt: now,
      mode: "live",
    });

    return {
      store: pruned,
      result: {
        ok: true,
        mode: "live",
        subreddits: targets.length,
        requests,
        newPosts,
        totalStoredPosts: Object.keys(pruned.posts).length,
        lastSyncAt: now,
      },
    };
  });
}
