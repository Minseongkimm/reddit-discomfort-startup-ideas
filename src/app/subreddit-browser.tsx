"use client";

import { useEffect, useMemo, useState } from "react";
import type { DataMode, ProblemItem, ProblemSourceItem, SubredditResult } from "@/lib/types";
import styles from "./subreddit-browser.module.css";

type SubredditBrowserProps = {
  results: SubredditResult[];
  mode: DataMode;
};

type SortMode = "problems" | "name";
type FeedbackValue = "like" | "dislike";
type ToastState = { text: string; key: number; kind: FeedbackValue } | null;

const EXPAND_BUTTON_THRESHOLD = 8;
const FEEDBACK_STORAGE_KEY = "reddit-problem-feedback-v1";

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/^r\//, "");
}

function normalizePainScore(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(1, Math.min(100, Math.round(value)));
}

function getPainToneClass(score: number | null) {
  if (score === null) {
    return "";
  }
  if (score >= 81) {
    return styles.painCritical;
  }
  if (score >= 61) {
    return styles.painHigh;
  }
  if (score >= 41) {
    return styles.painMedium;
  }
  if (score >= 21) {
    return styles.painLow;
  }
  return styles.painMinimal;
}

function getSamplePainFallback(problem: ProblemItem): number {
  const mentionCount = problem.mentionCount ?? problem.frequency;
  const score = problem.totalScore ?? 0;
  const comments = problem.totalComments ?? 0;
  const engagement = Math.max(0, score) + Math.max(0, comments) * 2;

  if (mentionCount >= 10 || engagement >= 600) {
    return 100;
  }
  if (mentionCount >= 7 || engagement >= 360) {
    return 80;
  }
  if (mentionCount >= 4 || engagement >= 180) {
    return 60;
  }
  if (mentionCount >= 2 || engagement >= 80) {
    return 40;
  }
  return 20;
}

function getDisplayPainScore(problem: ProblemItem, mode: DataMode): number | null {
  const normalized = normalizePainScore(
    Number.isFinite(problem.painIndex) ? problem.painIndex : null,
  );

  if (normalized !== null) {
    return normalized;
  }

  if (mode === "sample") {
    return getSamplePainFallback(problem);
  }

  return null;
}

function getProblemSources(problem: ProblemItem): ProblemSourceItem[] {
  if (problem.sources && problem.sources.length > 0) {
    return problem.sources.filter((item) => item.url.trim().length > 0);
  }

  if (problem.sourceUrl.trim().length > 0) {
    return [
      {
        url: problem.sourceUrl,
        evidence: problem.evidence,
      },
    ];
  }

  return [];
}

function readFeedbackMap(): Record<string, FeedbackValue> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const next: Record<string, FeedbackValue> = {};
    for (const [problemId, value] of Object.entries(parsed)) {
      if (value === "like" || value === "dislike") {
        next[problemId] = value;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function writeFeedbackMap(next: Record<string, FeedbackValue>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors so UI interaction is not blocked.
  }
}

export default function SubredditBrowser({ results, mode }: SubredditBrowserProps) {
  const [selected, setSelected] = useState(() =>
    results.find((item) => item.problems.some((problem) => Boolean(problem.llmReason?.trim())))
      ?.subreddit ?? results[0]?.subreddit ?? "",
  );
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("problems");
  const [expanded, setExpanded] = useState(false);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  const [feedbackByProblem, setFeedbackByProblem] = useState<Record<string, FeedbackValue>>(() =>
    readFeedbackMap(),
  );
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    writeFeedbackMap(feedbackByProblem);
  }, [feedbackByProblem]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 1600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const handleFeedback = (problemId: string, nextValue: FeedbackValue) => {
    const current = feedbackByProblem[problemId];
    const willSet = current === nextValue ? null : nextValue;

    if (willSet === "dislike") {
      setToast((prev) => ({
        text: "싫어요로 이동되었습니다",
        key: (prev?.key ?? 0) + 1,
        kind: "dislike",
      }));
    } else if (willSet === "like") {
      setToast((prev) => ({
        text: "좋아요로 옮겼어요",
        key: (prev?.key ?? 0) + 1,
        kind: "like",
      }));
    }

    setFeedbackByProblem((prev) => {
      const prevValue = prev[problemId];
      const next = { ...prev };

      if (prevValue === nextValue) {
        delete next[problemId];
      } else {
        next[problemId] = nextValue;
      }

      return next;
    });
  };

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

  const groupedProblems = useMemo(() => {
    if (!current) {
      return {
        primary: [] as ProblemItem[],
        disliked: [] as ProblemItem[],
      };
    }

    const liked: ProblemItem[] = [];
    const neutral: ProblemItem[] = [];
    const disliked: ProblemItem[] = [];

    for (const problem of current.problems) {
      const feedback = feedbackByProblem[problem.id];
      if (feedback === "like") {
        liked.push(problem);
      } else if (feedback === "dislike") {
        disliked.push(problem);
      } else {
        neutral.push(problem);
      }
    }

    const sortByPainDesc = (a: ProblemItem, b: ProblemItem) => {
      const aPain = getDisplayPainScore(a, mode) ?? 0;
      const bPain = getDisplayPainScore(b, mode) ?? 0;
      const aMentions = a.mentionCount ?? a.frequency;
      const bMentions = b.mentionCount ?? b.frequency;

      return (
        bPain - aPain ||
        (b.empathyScore ?? 0) - (a.empathyScore ?? 0) ||
        bMentions - aMentions
      );
    };

    neutral.sort(sortByPainDesc);
    disliked.sort(sortByPainDesc);

    return {
      primary: [...liked, ...neutral],
      disliked,
    };
  }, [current, feedbackByProblem, mode]);

  const renderProblemCard = (problem: ProblemItem) => {
    const sources = getProblemSources(problem);
    const isOpen = Boolean(openSources[problem.id]);
    const feedback = feedbackByProblem[problem.id];
    const mentionCount = problem.mentionCount ?? problem.frequency;
    const totalScore = problem.totalScore ?? 0;
    const totalComments = problem.totalComments ?? 0;
    const empathyScore = problem.empathyScore ?? totalScore + totalComments * 2;
    const painScore = getDisplayPainScore(problem, mode);
    const painToneClass = getPainToneClass(painScore);

    return (
      <li
        key={problem.id}
        className={[
          styles.problemItem,
          feedback === "like" ? styles.problemItemLike : "",
          feedback === "dislike" ? styles.problemItemDislike : "",
        ].join(" ").trim()}
      >
        <div className={styles.cardTop}>
          <p className={styles.statement}>{problem.statement}</p>
          <div className={styles.feedbackIcons}>
            <button
              type="button"
              className={[styles.feedbackIconButton, feedback === "like" ? styles.feedbackIconButtonLikeActive : ""].join(" ").trim()}
              onClick={() => handleFeedback(problem.id, "like")}
              aria-label="좋아요"
              title="좋아요"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M2.25 10.5h4.5v10.5h-4.5zM8.25 10.5l4.2-7.56A1.5 1.5 0 0 1 13.77 2.25H15a1.5 1.5 0 0 1 1.5 1.5V8.25h3.98a2.25 2.25 0 0 1 2.21 2.66l-1.2 6.75a2.25 2.25 0 0 1-2.21 1.84H8.25V10.5z" />
              </svg>
            </button>
            <button
              type="button"
              className={[styles.feedbackIconButton, feedback === "dislike" ? styles.feedbackIconButtonDislikeActive : ""].join(" ").trim()}
              onClick={() => handleFeedback(problem.id, "dislike")}
              aria-label="싫어요"
              title="싫어요"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M2.25 3h4.5v10.5h-4.5zM8.25 3h11.03a2.25 2.25 0 0 1 2.21 1.84l1.2 6.75a2.25 2.25 0 0 1-2.21 2.66H16.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-1.23a1.5 1.5 0 0 1-1.32-.69l-4.2-7.56V3z" />
              </svg>
            </button>
          </div>
        </div>
        <p className={styles.meta}>
          언급 {mentionCount} ·
          <span className={[styles.painValue, painToneClass].join(" ").trim()}>
            고통지수 {painScore !== null ? painScore : "-"}
          </span>
        </p>
        <p className={styles.metaSub}>공감 {empathyScore} (점수 {totalScore} · 댓글 {totalComments})</p>
        <p className={styles.evidenceLabel}>원문 근거</p>
        <p className={styles.evidence}>{problem.evidence}</p>
        <p className={styles.llmLabel}>LLM 요약</p>
        <p className={`${styles.llmReason} ${problem.llmReason ? "" : styles.llmReasonEmpty}`.trim()}>
          {problem.llmReason ? problem.llmReason : "없음(생성 전)"}
        </p>
        <p className={styles.solutionLabel}>솔루션 제안</p>
        <p className={`${styles.solutionText} ${problem.llmSolution ? "" : styles.llmReasonEmpty}`.trim()}>
          {problem.llmSolution ? problem.llmSolution : "없음(생성 전)"}
        </p>
        {sources.length > 0 ? (
          <>
            <button
              type="button"
              className={styles.sourceToggle}
              onClick={() => {
                setOpenSources((prev) => ({
                  ...prev,
                  [problem.id]: !prev[problem.id],
                }));
              }}
            >
              원문링크 ({sources.length})
              <span className={styles.sourceChevron} aria-hidden>
                {isOpen ? "▾" : "▸"}
              </span>
            </button>

            <div className={`${styles.sourcePanel} ${isOpen ? styles.sourcePanelOpen : ""}`.trim()}>
              <div className={styles.sourceBox}>
                {sources.map((source, index) => (
                  <div key={`${problem.id}-${source.url}-${index}`} className={styles.sourceEntry}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.sourceTitleLink}
                    >
                      {source.evidence && source.evidence.trim().length > 0
                        ? source.evidence
                        : "제목 없음"}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </li>
    );
  };

  if (current == null) {
    return (
      <section className={styles.wrapper}>
        <p className={styles.empty}>표시할 서브레딧 데이터가 없습니다.</p>
      </section>
    );
  }

  const hasAnyProblems =
    groupedProblems.primary.length > 0 || groupedProblems.disliked.length > 0;

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

                <div className={styles.painLegend}>
          <span className={styles.painLegendTitle}>고통지수 예시</span>
          <span className={[styles.painValue, styles.painMinimal].join(" ")}>10점 - 만들지마</span>
          <span className={[styles.painValue, styles.painLow].join(" ")}>40점 - 낮은 우선순위</span>
          <span className={[styles.painValue, styles.painHigh].join(" ")}>70점 - 검토 필요</span>
          <span className={[styles.painValue, styles.painCritical].join(" ")}>100점 - 꼭 만들어줘</span>
        </div>

        {toast ? (
          <p
            className={[styles.moveToast, toast.kind === "like" ? styles.moveToastLike : styles.moveToastDislike].join(" ")}
          >
            {toast.text}
          </p>
        ) : null}

        {!hasAnyProblems ? (
          <p className={styles.empty}>현재 규칙으로는 추출된 문제가 없습니다.</p>
        ) : (
          <>
            {groupedProblems.primary.length > 0 ? (
              <ul className={styles.problemGrid}>{groupedProblems.primary.map(renderProblemCard)}</ul>
            ) : (
              <p className={styles.empty}>일반 카드가 없습니다. (싫어요 카드만 존재)</p>
            )}

            {groupedProblems.disliked.length > 0 ? (
              <section className={styles.dislikedSection}>
                <p className={styles.dislikedTitle}>싫어요 모음 ({groupedProblems.disliked.length})</p>
                <ul className={styles.problemGrid}>
                  {groupedProblems.disliked.map(renderProblemCard)}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </article>
    </section>
  );
}
