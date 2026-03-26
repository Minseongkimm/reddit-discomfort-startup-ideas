import type { ProblemItem, ProblemSourceItem, StoredPost, SubredditResult } from "./types";

export type ProblemRule = {
  id: string;
  label: string;
  signal: string;
  pattern: RegExp;
};

export type PostProblemSignal = {
  ruleId: string;
  severity: number;
  evidence?: string;
  sourceUrl?: string;
  llmReason?: string;
  llmSolution?: string;
};

export const PROBLEM_RULES: ProblemRule[] = [
  {
    id: "message_fragmentation",
    label: "문의 채널 분산으로 요청 누락이 발생함",
    signal: "운영 누수",
    pattern: /(dm|inbox|kakao|phone|channel|slack|email|문의).*(miss|lose|buried|누락|놓치)|chaotic.*inbox/i,
  },
  {
    id: "payment_delay",
    label: "결제 지연으로 현금흐름 리스크가 큼",
    signal: "지불/현금흐름",
    pattern: /(late payment|delay payment|invoice|결제 지연|연체|cashflow|reminder)/i,
  },
  {
    id: "manual_ops",
    label: "수동 프로세스로 시간이 과도하게 소모됨",
    signal: "반복 비효율",
    pattern: /(manual|spreadsheet|repetitive|수동|반복|hours every day|switching between tools)/i,
  },
  {
    id: "knowledge_loss",
    label: "고객 인사이트가 체계적으로 축적되지 않음",
    signal: "학습 손실",
    pattern: /(notes|insight|interview|tagging|인사이트|메모).*(lose|disappear|사라)|version control/i,
  },
  {
    id: "onboarding_dropoff",
    label: "온보딩 구간 이탈로 전환율이 떨어짐",
    signal: "전환 이탈",
    pattern: /(onboarding|activation|drop off|dropoff|trial users|churn)/i,
  },
  {
    id: "analytics_blindspot",
    label: "측정/어트리뷰션 신뢰도가 낮음",
    signal: "측정 불확실성",
    pattern: /(attribution|analytics|funnel|dashboard|tracking|metric|cac)/i,
  },
  {
    id: "support_overload",
    label: "고객지원 요청 폭주로 대응 품질이 떨어짐",
    signal: "지원 병목",
    pattern: /(support|ticket|response time|triage|queue|bug tickets|문의 폭주)/i,
  },
  {
    id: "tooling_cost",
    label: "툴 구독비 누적으로 수익성이 압박됨",
    signal: "비용 압박",
    pattern: /(too expensive|subscription|stack cost|cost keeps growing|pricing)/i,
  },
  {
    id: "scope_creep",
    label: "요구사항 변경이 잦아 납기와 수익성이 악화됨",
    signal: "스코프 리스크",
    pattern: /(scope creep|change requests|revisions|요구사항 변경|margins collapse)/i,
  },
  {
    id: "inventory_mismatch",
    label: "재고/반품 처리 문제로 CS가 증가함",
    signal: "재고 리스크",
    pattern: /(inventory|stock mismatch|overselling|out of stock|refund|returns process)/i,
  },
];

const PROBLEM_RULE_BY_ID = new Map(PROBLEM_RULES.map((rule) => [rule.id, rule]));

export function getProblemRuleById(ruleId: string): ProblemRule | undefined {
  return PROBLEM_RULE_BY_ID.get(ruleId);
}

export function getMatchedProblemRuleIds(text: string): string[] {
  const matched: string[] = [];

  for (const rule of PROBLEM_RULES) {
    if (rule.pattern.test(text)) {
      matched.push(rule.id);
    }
  }

  return matched;
}

export function calculateSeverity(post: StoredPost) {
  const engagementScore = post.score + post.comments * 2;
  if (engagementScore >= 220) return 5;
  if (engagementScore >= 150) return 4;
  if (engagementScore >= 100) return 3;
  if (engagementScore >= 60) return 2;
  return 1;
}

function toSourceItem(signal: PostProblemSignal, post: StoredPost): ProblemSourceItem {
  return {
    url: signal.sourceUrl ?? post.permalink,
    evidence: signal.evidence ?? post.title,
  };
}

function mergeSources(existing: ProblemSourceItem[] | undefined, next: ProblemSourceItem) {
  const output: ProblemSourceItem[] = existing ? [...existing] : [];
  const nextUrl = next.url.trim();

  if (nextUrl.length === 0) {
    return output;
  }

  const alreadyExists = output.some((item) => item.url === nextUrl);
  if (!alreadyExists) {
    output.push({
      url: nextUrl,
      evidence: next.evidence,
    });
  }

  return output;
}

function normalizeByRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }

  if (max <= min) {
    return 1;
  }

  return (value - min) / (max - min);
}

function applyPainIndex(problems: ProblemItem[]): ProblemItem[] {
  if (problems.length === 0) {
    return problems;
  }

  const mentionSignals = problems.map((problem) => {
    const mentionCount = Math.max(0, problem.mentionCount ?? problem.frequency ?? 0);
    return Math.log1p(mentionCount);
  });

  const empathySignals = problems.map((problem) => {
    const score = Math.max(0, problem.totalScore ?? 0);
    const comments = Math.max(0, problem.totalComments ?? 0);
    return Math.log1p(score + comments * 2);
  });

  const mentionMin = Math.min(...mentionSignals);
  const mentionMax = Math.max(...mentionSignals);
  const empathyMin = Math.min(...empathySignals);
  const empathyMax = Math.max(...empathySignals);

  return problems.map((problem, index) => {
    const mentionNorm = normalizeByRange(mentionSignals[index] ?? 0, mentionMin, mentionMax);
    const empathyNorm = normalizeByRange(empathySignals[index] ?? 0, empathyMin, empathyMax);
    const severityNorm = Math.max(0, Math.min(1, problem.severity / 5));

    const painIndex =
      100 * (0.45 * mentionNorm + 0.35 * empathyNorm + 0.2 * severityNorm);

    return {
      ...problem,
      painIndex: Math.round(painIndex * 10) / 10,
    };
  });
}

export function aggregateProblemsFromSignals(
  posts: StoredPost[],
  getSignals: (post: StoredPost) => PostProblemSignal[],
): SubredditResult[] {
  const buckets = new Map<
    string,
    {
      scannedPosts: number;
      problems: Map<string, ProblemItem>;
    }
  >();

  for (const post of posts) {
    if (!buckets.has(post.subreddit)) {
      buckets.set(post.subreddit, {
        scannedPosts: 0,
        problems: new Map<string, ProblemItem>(),
      });
    }

    const subredditBucket = buckets.get(post.subreddit);
    if (!subredditBucket) {
      continue;
    }

    subredditBucket.scannedPosts += 1;

    const signals = getSignals(post);

    for (const signal of signals) {
      const rule = getProblemRuleById(signal.ruleId);
      if (!rule) {
        continue;
      }

      const existing = subredditBucket.problems.get(rule.id);

      if (!existing) {
        const source = toSourceItem(signal, post);

        subredditBucket.problems.set(rule.id, {
          id: `${post.subreddit}-${rule.id}`,
          statement: rule.label,
          signal: rule.signal,
          frequency: 1,
          mentionCount: 1,
          totalScore: post.score,
          totalComments: post.comments,
          empathyScore: post.score + post.comments * 2,
          painIndex: 0,
          severity: signal.severity,
          evidence: source.evidence,
          sourceUrl: source.url,
          sources: source.url ? [source] : [],
          llmReason: signal.llmReason,
          llmSolution: signal.llmSolution,
        });
        continue;
      }

      const prevMentionCount = existing.mentionCount ?? existing.frequency;
      const nextMentionCount = prevMentionCount + 1;
      const averagedSeverity = Math.round(
        (existing.severity * prevMentionCount + signal.severity) / nextMentionCount,
      );
      const nextTotalScore = (existing.totalScore ?? 0) + post.score;
      const nextTotalComments = (existing.totalComments ?? 0) + post.comments;

      const source = toSourceItem(signal, post);

      subredditBucket.problems.set(rule.id, {
        ...existing,
        frequency: nextMentionCount,
        mentionCount: nextMentionCount,
        totalScore: nextTotalScore,
        totalComments: nextTotalComments,
        empathyScore: nextTotalScore + nextTotalComments * 2,
        painIndex: existing.painIndex ?? 0,
        severity: averagedSeverity,
        sources: mergeSources(existing.sources, source),
        llmReason: existing.llmReason ?? signal.llmReason,
        llmSolution: existing.llmSolution ?? signal.llmSolution,
      });
    }
  }

  return Array.from(buckets.entries())
    .map(([subreddit, bucket]) => {
      const problems = applyPainIndex(Array.from(bucket.problems.values()));

      problems.sort((a, b) => {
        const aMentions = a.mentionCount ?? a.frequency;
        const bMentions = b.mentionCount ?? b.frequency;

        return (
          bMentions - aMentions ||
          b.painIndex - a.painIndex ||
          b.empathyScore - a.empathyScore
        );
      });

      return {
        subreddit,
        scannedPosts: bucket.scannedPosts,
        problems,
      };
    })
    .sort((a, b) => b.problems.length - a.problems.length);
}

export function extractProblemsFromPosts(posts: StoredPost[]): SubredditResult[] {
  return aggregateProblemsFromSignals(posts, (post) => {
    const text = `${post.title} ${post.body}`;
    const matchedRuleIds = getMatchedProblemRuleIds(text);
    const severity = calculateSeverity(post);

    return matchedRuleIds.map((ruleId) => ({
      ruleId,
      severity,
      evidence: post.title,
      sourceUrl: post.permalink,
    }));
  });
}
