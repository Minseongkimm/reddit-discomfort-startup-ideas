"use client";

import { useMemo, useState } from "react";
import type { SubredditResult } from "@/lib/types";
import styles from "./subreddit-browser.module.css";

type SubredditBrowserProps = {
  results: SubredditResult[];
};

type SortMode = "problems" | "name";

const EXPAND_BUTTON_THRESHOLD = 8;

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/^r\//, "");
}

export default function SubredditBrowser({ results }: SubredditBrowserProps) {
  const [selected, setSelected] = useState(() =>
    results.find((item) => item.problems.some((problem) => Boolean(problem.llmReason?.trim())))
      ?.subreddit ?? results[0]?.subreddit ?? "",
  );
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("problems");
  const [expanded, setExpanded] = useState(false);

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
            onChange={(event) => {
              setQuery(event.target.value);
              setExpanded(false);
            }}
            placeholder="서브레딧 검색 (예: startup, ecommerce)"
          />
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              setQuery("");
              setExpanded(false);
            }}
            disabled={query.trim().length === 0}
          >
            초기화
          </button>
          <p className={styles.selectorHint}>총 {results.length}개</p>
        </div>

        <div className={styles.selectorControl}>
          {filtered.length > 0 ? (
            <>
              <div
                className={`${styles.chipWrap} ${expanded ? styles.chipWrapExpanded : styles.chipWrapCollapsed}`}
              >
                {filtered.map((item) => (
                  <button
                    key={item.subreddit}
                    type="button"
                    className={`${styles.subredditChip} ${item.subreddit === current.subreddit ? styles.subredditChipActive : ""}`}
                    onClick={() => setSelected(item.subreddit)}
                  >
                    <span className={styles.chipName}>{item.subreddit}</span>
                    <span className={styles.chipCount}>{item.problems.length}</span>
                  </button>
                ))}
              </div>

              <div className={styles.controlRow}>
                <div className={styles.sortRow}>
                  <button
                    type="button"
                    className={`${styles.sortButton} ${sortMode === "problems" ? styles.sortActive : ""}`}
                    onClick={() => {
                      setSortMode("problems");
                      setExpanded(false);
                    }}
                  >
                    문제 많은 순
                  </button>
                  <button
                    type="button"
                    className={`${styles.sortButton} ${sortMode === "name" ? styles.sortActive : ""}`}
                    onClick={() => {
                      setSortMode("name");
                      setExpanded(false);
                    }}
                  >
                    이름 순
                  </button>
                </div>

                <div className={styles.expandRow}>
                  {!expanded && filtered.length > EXPAND_BUTTON_THRESHOLD ? (
                    <button
                      type="button"
                      className={styles.moreButton}
                      onClick={() => setExpanded(true)}
                    >
                      더보기
                    </button>
                  ) : null}
                  {expanded ? (
                    <button
                      type="button"
                      className={styles.collapseButton}
                      onClick={() => setExpanded(false)}
                    >
                      닫기
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className={styles.empty}>검색 결과가 없습니다.</p>
          )}
        </div>
      </div>

      <article className={styles.detailArea}>
        <header className={styles.detailHeader}>
          <h2>{current.subreddit}</h2>
        </header>

        {current.problems.length === 0 ? (
          <p className={styles.empty}>현재 규칙으로는 추출된 문제가 없습니다.</p>
        ) : (
          <ul className={styles.problemGrid}>
            {current.problems.map((problem) => (
              <li key={problem.id} className={styles.problemItem}>
                <p className={styles.statement}>{problem.statement}</p>
                <p className={styles.meta}>빈도 {problem.frequency} · 심각도 {problem.severity}/5</p>
                <p className={styles.evidenceLabel}>원문 근거</p>
                <p className={styles.evidence}>{problem.evidence}</p>
                <p className={styles.llmLabel}>LLM 요약</p>
                <p
                  className={`${styles.llmReason} ${problem.llmReason ? "" : styles.llmReasonEmpty}`.trim()}
                >
                  {problem.llmReason ? problem.llmReason : "없음 (분류 대기 가능)"}
                </p>
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
