import {
  LLM_CLASSIFIER_ENABLED,
  LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN,
  LLM_MAX_RUNTIME_MS,
  LLM_TIMEOUT_MS,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
} from "./config";
import {
  aggregateProblemsFromSignals,
  calculateSeverity,
  extractProblemsFromPosts,
  getMatchedProblemRuleIds,
  PROBLEM_RULES,
  type PostProblemSignal,
} from "./extractor";
import {
  buildPostSignature,
  readLlmCache,
  writeLlmCache,
  type LlmPostClassification,
} from "./llm-cache";
import type { StoredPost, SubredditResult } from "./types";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export type AnalyzeOptions = {
  forceFullPass?: boolean;
};

const VALID_RULE_IDS = new Set(PROBLEM_RULES.map((rule) => rule.id));
const PAIN_HINT_PATTERN =
  /(problem|pain|issue|friction|stuck|struggle|frustrat|delay|miss|chaos|manual|cost|expensive|broken|hard|complaint|refund|cancel|불편|문제|어렵|힘들|안되|누락|지연|비용|반복|버그|환불|클레임)/i;

const CLASSIFIER_PROMPT_VERSION = "summary-v4";
const CACHE_MODEL_KEY = `${OLLAMA_MODEL}:${CLASSIFIER_PROMPT_VERSION}`;

const SYSTEM_PROMPT = `You classify whether a Reddit post describes a real user pain point.
You must return strict JSON only.

Allowed rule IDs:
${PROBLEM_RULES.map((rule) => `- ${rule.id}: ${rule.label}`).join("\n")}

Output schema:
{
  "is_problem": boolean,
  "rule_ids": string[],
  "severity": integer 1..5,
  "confidence": number 0..1,
  "reason": string,
  "solution": string
}

Few-shot style examples for solution:
- pain: "분석 대시보드마다 CAC가 다르게 나와 신뢰할 수 없음"
  solution: "광고 채널 CAC 추적 도구"
- pain: "결제 독촉을 수동으로 보내느라 회수 속도가 느림"
  solution: "미수금 리마인드 자동화 앱"
- pain: "문의가 DM/메일/댓글로 흩어져 누락이 발생"
  solution: "옴니채널 문의 통합 보드"

Rules:
- Use only allowed rule_ids.
- If not a pain point, set is_problem=false and rule_ids=[].
- Pick at most 3 rule_ids.
- reason must summarize the core user problem in Korean in 1-2 short sentences.
- solution must be a short Korean product concept (single line, 6~28 chars preferred).
- solution must be noun-style. Avoid endings like "해야 합니다", "필요", "점검", "개선".
- Do not use markdown or bullet points in reason or solution.
`;

function looksLikePainPoint(text: string): boolean {
  return PAIN_HINT_PATTERN.test(text);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function dedupeRuleIds(ids: string[]): string[] {
  const output: string[] = [];

  for (const id of ids) {
    if (!VALID_RULE_IDS.has(id)) {
      continue;
    }
    if (!output.includes(id)) {
      output.push(id);
    }
    if (output.length >= 3) {
      break;
    }
  }

  return output;
}

function normalizeSolutionText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const collapsed = value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[*\-\u2022\d).\s]+/, "")
    .replace(/["'`]/g, "")
    .trim();

  if (!collapsed) {
    return "";
  }

  const firstSentence = collapsed.split(/[.!?。]/)[0]?.trim() ?? "";
  if (!firstSentence) {
    return "";
  }

  const cleaned = firstSentence
    .replace(/(해야 합니다|해야 한다|필요합니다|필요하다|점검|개선|확보)$/g, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  return cleaned.slice(0, 48);
}

function tryParseJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();

  const candidates = [trimmed];
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim());
  }

  const objectLike = trimmed.match(/\{[\s\S]*\}/);
  if (objectLike && objectLike[0]) {
    candidates.push(objectLike[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeClassification(value: Record<string, unknown>): LlmPostClassification {
  const rawRuleIds = Array.isArray(value.rule_ids)
    ? value.rule_ids.filter((item): item is string => typeof item === "string")
    : [];

  const rawSeverity =
    typeof value.severity === "number"
      ? value.severity
      : Number.parseInt(String(value.severity ?? "3"), 10);
  const rawConfidence =
    typeof value.confidence === "number"
      ? value.confidence
      : Number.parseFloat(String(value.confidence ?? "0"));

  return {
    isProblem: Boolean(value.is_problem),
    ruleIds: dedupeRuleIds(rawRuleIds),
    severity: Number.isFinite(rawSeverity)
      ? Math.max(1, Math.min(5, Math.round(rawSeverity)))
      : 3,
    confidence: Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 280) : "",
    solution: normalizeSolutionText(value.solution),
  };
}

function mergeMissingFieldsOnly(
  cached: LlmPostClassification,
  fresh: LlmPostClassification,
): LlmPostClassification {
  return {
    isProblem: cached.isProblem,
    ruleIds: cached.ruleIds.length > 0 ? cached.ruleIds : fresh.ruleIds,
    severity: cached.severity,
    confidence: cached.confidence,
    reason: hasText(cached.reason) ? cached.reason : fresh.reason,
    solution: hasText(cached.solution) ? cached.solution : fresh.solution,
  };
}

async function classifyPostWithOllama(
  post: StoredPost,
  regexRuleIds: string[],
): Promise<LlmPostClassification | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const url = `${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`;
    const userPrompt = [
      `subreddit: ${post.subreddit}`,
      `title: ${post.title}`,
      `body: ${post.body || "(empty)"}`,
      `regex_hint_rule_ids: ${regexRuleIds.join(",") || "none"}`,
    ].join("\n");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1,
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ollama http ${response.status}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    const content = payload.message?.content;

    if (!content || typeof content !== "string") {
      return null;
    }

    const parsed = tryParseJson(content);
    if (!parsed) {
      return null;
    }

    return normalizeClassification(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeProblemsFromPosts(
  posts: StoredPost[],
  options: AnalyzeOptions = {},
): Promise<SubredditResult[]> {
  if (!LLM_CLASSIFIER_ENABLED) {
    return extractProblemsFromPosts(posts);
  }

  const forceFullPass = options.forceFullPass === true;
  const runtimeLimitMs = forceFullPass ? Number.POSITIVE_INFINITY : LLM_MAX_RUNTIME_MS;

  const cache = await readLlmCache();
  let cacheChanged = false;
  let budget = forceFullPass
    ? Number.MAX_SAFE_INTEGER
    : LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN;
  let llmAvailable = true;
  const startedAt = Date.now();

  const sortedPosts = [...posts].sort((a, b) => b.createdUtc - a.createdUtc);
  const signalsByPost = new Map<string, PostProblemSignal[]>();

  for (const post of sortedPosts) {
    const text = `${post.title} ${post.body}`;
    const regexRuleIds = getMatchedProblemRuleIds(text);
    const baseSeverity = calculateSeverity(post);
    const signature = buildPostSignature(post.title, post.body);

    let classification: LlmPostClassification | null = null;

    const cachedEntry = cache.entries[post.id];
    const cachedMatchesSignature = cachedEntry && cachedEntry.signature === signature;
    const cachedResult = cachedMatchesSignature ? cachedEntry.result : null;

    if (cachedResult) {
      classification = cachedResult;
    }

    const missingReason = !cachedResult || !hasText(cachedResult.reason);
    const missingSolution = !cachedResult || !hasText(cachedResult.solution);
    const hasMissingTextField = missingReason || missingSolution;
    const shouldBackfillMissing = cachedResult?.isProblem === true && hasMissingTextField;
    const shouldClassifyFresh = !cachedResult;

    const candidate = regexRuleIds.length > 0 || looksLikePainPoint(text);
    const shouldAttemptLlm = shouldClassifyFresh ? candidate : shouldBackfillMissing;

    const runtimeExceeded = Date.now() - startedAt >= runtimeLimitMs;
    if (runtimeExceeded) {
      llmAvailable = false;
    }

    if (shouldAttemptLlm && llmAvailable && budget > 0) {
      try {
        const freshClassification = await classifyPostWithOllama(post, regexRuleIds);

        if (freshClassification) {
          classification = cachedResult
            ? mergeMissingFieldsOnly(cachedResult, freshClassification)
            : freshClassification;

          cache.entries[post.id] = {
            model: CACHE_MODEL_KEY,
            signature,
            updatedAt: new Date().toISOString(),
            result: classification,
          };
          cacheChanged = true;
        }

        budget -= 1;
      } catch {
        llmAvailable = false;
      }
    }

    let finalRuleIds = [...regexRuleIds];
    let finalSeverity = baseSeverity;

    if (classification) {
      if (
        !classification.isProblem &&
        regexRuleIds.length > 0 &&
        classification.confidence >= 0.85
      ) {
        finalRuleIds = [];
      } else if (classification.isProblem) {
        finalRuleIds = dedupeRuleIds([...regexRuleIds, ...classification.ruleIds]);
      }

      if (finalRuleIds.length > 0) {
        finalSeverity = Math.round((baseSeverity + classification.severity) / 2);
      }
    }

    const llmReason =
      classification && classification.isProblem && hasText(classification.reason)
        ? classification.reason
        : undefined;
    const llmSolution =
      classification && classification.isProblem && hasText(classification.solution)
        ? classification.solution
        : undefined;

    const signals: PostProblemSignal[] = finalRuleIds.map((ruleId) => ({
      ruleId,
      severity: finalSeverity,
      evidence: post.title,
      sourceUrl: post.permalink,
      llmReason,
      llmSolution,
    }));

    signalsByPost.set(post.id, signals);
  }

  if (cacheChanged) {
    await writeLlmCache(cache);
  }

  return aggregateProblemsFromSignals(posts, (post) => signalsByPost.get(post.id) ?? []);
}
