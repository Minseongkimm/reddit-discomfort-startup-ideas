"use client";

import dynamic from "next/dynamic";
import type { SubredditResult } from "@/lib/types";

const SubredditBrowser = dynamic(() => import("./subreddit-browser"), {
  ssr: false,
});

type Props = {
  results: SubredditResult[];
};

export default function SubredditBrowserShell({ results }: Props) {
  return <SubredditBrowser results={results} />;
}
