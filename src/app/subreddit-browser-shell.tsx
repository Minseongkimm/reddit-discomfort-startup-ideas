"use client";

import dynamic from "next/dynamic";
import type { DataMode, SubredditResult } from "@/lib/types";

const SubredditBrowser = dynamic(() => import("./subreddit-browser"), {
  ssr: false,
});

type Props = {
  results: SubredditResult[];
  mode: DataMode;
};

export default function SubredditBrowserShell({ results, mode }: Props) {
  return <SubredditBrowser results={results} mode={mode} />;
}
