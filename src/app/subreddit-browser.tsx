"use client";

import { useMemo, useState } from "react";
import type { SubredditResult } from "@/lib/types";
import styles from "./subreddit-browser.module.css";

type SubredditBrowserProps = {
  results: SubredditResult[];
};

type SortMode = "problems" | "name";

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/^r\//, "");
}

export default function SubredditBrowser({ results }: SubredditBrowserProps) {
  const [selected, setSelected] = useState(results[0]?.subreddit ?? "");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("problems");

  const sorted = useMemo(() => {
    const copied = [...results];

    if (sortMode === "name") {
      return copied.sort((a, b) => a.subreddit.localeCompare(b.subreddit));
    }

    return copied.sort(
      (a, b) => b.problems.length - a.problems.length || b.scannedPosts - a.scannedPosts,
    );
  }, [results, sortMode]);

  const filtered = useMemo(() => {
    const normalized = normalizeQuery(query);
    if (normalized.length === 0) {
      return sorted;
    }

    return sorted.filter((item) => {
      const name = item.subreddit.toLowerCase();
      const short = name.replace(/^r\//, "");
      return name.includes(normalized) || short.includes(normalized);
    });
  }, [sorted, query]);

  const current = useMemo(() => {
    const inFiltered = filtered.find((item) => item.subreddit === selected);
    return inFiltered ?? filtered[0] ?? sorted[0];
  }, [filtered, selected, sorted]);

  const currentIndex = current ? filtered.findIndex((item) => item.subreddit === current.subreddit) : -1;
  const quickCandidates = filtered.slice(0, 10);

  if (current == null) {
    return (
      <section className={styles.wrapper}>
        <p className={styles.empty}>표시할 서브레딧 데이터가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className={styles.wrapper}>
      <div className={styles.selectorArea}>
        <p className={styles.selectorLabel}>서브레딧 선택</p>

        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="서브레딧 검색 (예: startup, ecommerce)"
          />
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => setQuery("")}
            disabled={query.trim().length === 0}
          >
            초기화
          </button>
          <p className={styles.selectorHint}>총 {results.length}개</p>
        </div>

        {quickCandidates.length > 0 ? (
          <div className={styles.quickRow}>
            {quickCandidates.map((item) => (
              <button
                key={item.subreddit}
                type="button"
                className={`${styles.quickButton} ${item.subreddit === current.subreddit ? styles.quickActive : ""}`}
                onClick={() => setSelected(item.subreddit)}
              >
                {item.subreddit}
                <span>{item.problems.length}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>검색 결과가 없습니다.</p>
        )}

        <div className={styles.selectorControl}>
          <select
            className={styles.select}
            value={current.subreddit}
            onChange={(event) => setSelected(event.target.value)}
            disabled={filtered.length === 0}
          >
            {filtered.map((item) => (
              <option key={item.subreddit} value={item.subreddit}>
                {item.subreddit} · 문제 {item.problems.length}개 · 게시글 {item.scannedPosts}개
              </option>
            ))}
          </select>

          <div className={styles.sortRow}>
            <button
              type="button"
              className={`${styles.sortButton} ${sortMode === "problems" ? styles.sortActive : ""}`}
              onClick={() => setSortMode("problems")}
            >
              문제 많은 순
            </button>
            <button
              type="button"
              className={`${styles.sortButton} ${sortMode === "name" ? styles.sortActive : ""}`}
              onClick={() => setSortMode("name")}
            >
              이름 순
            </button>
          </div>
        </div>
      </div>

      <article className={styles.detailArea}>
        <header className={styles.detailHeader}>
          <h2>{current.subreddit}</h2>
          <p>
            스캔 게시글 {current.scannedPosts}개 · 추출 문제 {current.problems.length}개
            {filtered.length > 0 ? ` · ${Math.max(currentIndex, 0) + 1}/${filtered.length}` : ""}
          </p>
        </header>

        {current.problems.length === 0 ? (
          <p className={styles.empty}>현재 규칙으로는 추출된 문제가 없습니다.</p>
        ) : (
          <ul className={styles.problemGrid}>
            {current.problems.map((problem) => (
              <li key={problem.id} className={styles.problemItem}>
                <p className={styles.statement}>{problem.statement}</p>
                <p className={styles.meta}>신호 {problem.signal}</p>
                <p className={styles.meta}>빈도 {problem.frequency} · 심각도 {problem.severity}/5</p>
                <p className={styles.evidence}>{problem.evidence}</p>
                <a
                  href={problem.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  원문 보기
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
