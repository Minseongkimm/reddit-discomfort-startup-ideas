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
import type { ProblemServiceItem, StoredPost, SubredditResult } from "./types";

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

const CLASSIFIER_PROMPT_VERSION = "summary-v5-services";
const CACHE_MODEL_KEY = `${OLLAMA_MODEL}:${CLASSIFIER_PROMPT_VERSION}`;
const SERVICE_VERIFY_TIMEOUT_MS = 4_500;
const SERVICE_VERIFY_MAX_PER_RUN = 80;

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
  "solution": string,
  "similar_services": [
    {
      "name": string,
      "url": string,
      "summary": string
    }
  ]
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
- If not a pain point, set is_problem=false and rule_ids=[] and similar_services=[].
- Pick at most 3 rule_ids.
- reason must summarize the core user problem in Korean in 1-2 short sentences.
- solution must be a short Korean product concept (single line, 6~28 chars preferred).
- solution must be noun-style. Avoid endings like "해야 합니다", "필요", "점검", "개선".
- similar_services must include 1~4 real products when is_problem=true.
- For each similar service, return concise name and one-line Korean summary.
- If an official URL is uncertain, leave url as empty string.
- Do not use markdown or bullet points in reason, solution, or summary.
`;

function looksLikePainPoint(text: string): boolean {
  return PAIN_HINT_PATTERN.test(text);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasServices(value: ProblemServiceItem[] | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
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

function normalizeServiceText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .trim();
}

function normalizeServiceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeSimilarServices(value: unknown): ProblemServiceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: ProblemServiceItem[] = [];

  for (const rawItem of value) {
    let name = "";
    let url = "";
    let summary = "";

    if (typeof rawItem === "string") {
      name = normalizeServiceText(rawItem);
    } else if (rawItem && typeof rawItem === "object") {
      const candidate = rawItem as Record<string, unknown>;
      name =
        normalizeServiceText(candidate.name) ||
        normalizeServiceText(candidate.service) ||
        normalizeServiceText(candidate.company);
      url =
        normalizeServiceText(candidate.url) ||
        normalizeServiceText(candidate.website) ||
        normalizeServiceText(candidate.link);
      summary =
        normalizeServiceText(candidate.summary) ||
        normalizeServiceText(candidate.description) ||
        normalizeServiceText(candidate.why);
    }

    name = name.slice(0, 80);
    url = normalizeServiceUrl(url.slice(0, 220));
    summary = summary.slice(0, 180);

    if (!name && !url) {
      continue;
    }

    const normalizedName = name || url.replace(/^https?:\/\//, "").split("/")[0];
    const dedupeKey = `${normalizedName.toLowerCase()}::${url.toLowerCase()}`;

    const exists = output.some(
      (service) => `${service.name.toLowerCase()}::${service.url.toLowerCase()}` === dedupeKey,
    );

    if (!exists) {
      output.push({
        name: normalizedName,
        url,
        summary: summary || undefined,
        verification: url ? "unchecked" : "missing",
      });
    }

    if (output.length >= 4) {
      break;
    }
  }

  return output;
}

function needsServiceVerification(services: ProblemServiceItem[]): boolean {
  return services.some((service) => {
    if (!service.url.trim()) {
      return false;
    }

    return service.verification !== "verified" && service.verification !== "failed";
  });
}

async function verifyService(service: ProblemServiceItem): Promise<ProblemServiceItem> {
  const checkedAt = new Date().toISOString();
  const normalizedUrl = normalizeServiceUrl(service.resolvedUrl || service.url);

  if (!normalizedUrl) {
    return {
      ...service,
      verification: "missing",
      checkedAt,
    };
  }

  const verifyWithMethod = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVICE_VERIFY_TIMEOUT_MS);

    try {
      return await fetch(normalizedUrl, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers:
          method === "GET"
            ? {
                accept: "text/html,application/xhtml+xml",
              }
            : undefined,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let response = await verifyWithMethod("HEAD");

    if (!response.ok || response.status >= 500 || response.status === 405) {
      response = await verifyWithMethod("GET");
    }

    const reachable = response.status > 0 && response.status < 500;

    return {
      ...service,
      url: normalizedUrl,
      resolvedUrl: response.url || normalizedUrl,
      verification: reachable ? "verified" : "failed",
      checkedAt,
    };
  } catch {
    return {
      ...service,
      url: normalizedUrl,
      verification: "failed",
      checkedAt,
    };
  }
}

async function verifySimilarServices(services: ProblemServiceItem[]): Promise<ProblemServiceItem[]> {
  return Promise.all(services.map((service) => verifyService(service)));
}

function getServiceVerificationUrl(service: ProblemServiceItem): string {
  return normalizeServiceUrl(service.resolvedUrl || service.url);
}

function needsSingleServiceVerification(service: ProblemServiceItem): boolean {
  const url = getServiceVerificationUrl(service);
  if (!url) {
    return false;
  }

  return service.verification !== "verified" && service.verification !== "failed";
}

async function verifyServicesInResults(results: SubredditResult[]): Promise<SubredditResult[]> {
  const pendingByUrl = new Map<string, ProblemServiceItem>();

  outer: for (const subreddit of results) {
    for (const problem of subreddit.problems) {
      const services = problem.similarServices ?? [];

      for (const service of services) {
        if (!needsSingleServiceVerification(service)) {
          continue;
        }

        const url = getServiceVerificationUrl(service);
        if (!url || pendingByUrl.has(url)) {
          continue;
        }

        pendingByUrl.set(url, {
          ...service,
          url,
        });

        if (pendingByUrl.size >= SERVICE_VERIFY_MAX_PER_RUN) {
          break outer;
        }
      }
    }
  }

  const verifiedByUrl = new Map<string, ProblemServiceItem>();
  await Promise.all(
    Array.from(pendingByUrl.entries()).map(async ([url, service]) => {
      const verified = await verifyService(service);
      verifiedByUrl.set(url, verified);
    }),
  );

  return results.map((subreddit) => ({
    ...subreddit,
    problems: subreddit.problems.map((problem) => {
      const services = problem.similarServices ?? [];
      if (services.length === 0) {
        return problem;
      }

      const nextServices = services.map((service) => {
        const url = getServiceVerificationUrl(service);

        if (!url) {
          if (service.verification) {
            return service;
          }

          return {
            ...service,
            verification: "missing" as const,
          };
        }

        const verified = verifiedByUrl.get(url);
        if (verified) {
          return {
            ...service,
            url: verified.url,
            resolvedUrl: verified.resolvedUrl || service.resolvedUrl,
            verification: verified.verification,
            checkedAt: verified.checkedAt,
          };
        }

        if (needsSingleServiceVerification(service)) {
          return {
            ...service,
            url,
            verification: "unchecked" as const,
          };
        }

        return {
          ...service,
          url,
        };
      });

      return {
        ...problem,
        similarServices: nextServices,
      };
    }),
  }));
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

  const rawSimilarServices = Array.isArray(value.similar_services)
    ? value.similar_services
    : Array.isArray(value.similarServices)
      ? value.similarServices
      : Array.isArray(value.competitors)
        ? value.competitors
        : [];

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
    similarServices: normalizeSimilarServices(rawSimilarServices),
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
    similarServices: hasServices(cached.similarServices)
      ? cached.similarServices
      : fresh.similarServices,
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
    const extracted = extractProblemsFromPosts(posts);
    return verifyServicesInResults(extracted);
  }

  const forceFullPass = options.forceFullPass === true;
  const runtimeLimitMs = forceFullPass ? Number.POSITIVE_INFINITY : LLM_MAX_RUNTIME_MS;

  const cache = await readLlmCache();
  let cacheChanged = false;
  let budget = forceFullPass
    ? Number.MAX_SAFE_INTEGER
    : LLM_MAX_NEW_CLASSIFICATIONS_PER_RUN;
  let verifyBudget = forceFullPass ? Number.MAX_SAFE_INTEGER : SERVICE_VERIFY_MAX_PER_RUN;
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
    const missingSimilarServices = !cachedResult || !hasServices(cachedResult.similarServices);
    const hasMissingTextField = missingReason || missingSolution || missingSimilarServices;
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

    if (
      classification &&
      classification.isProblem &&
      hasServices(classification.similarServices) &&
      verifyBudget > 0 &&
      needsServiceVerification(classification.similarServices)
    ) {
      try {
        classification = {
          ...classification,
          similarServices: await verifySimilarServices(classification.similarServices),
        };

        cache.entries[post.id] = {
          model: CACHE_MODEL_KEY,
          signature,
          updatedAt: new Date().toISOString(),
          result: classification,
        };
        cacheChanged = true;
        verifyBudget -= 1;
      } catch {
        // Ignore verification errors and keep raw model output.
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
    const llmSimilarServices =
      classification && classification.isProblem && hasServices(classification.similarServices)
        ? classification.similarServices
        : undefined;

    const signals: PostProblemSignal[] = finalRuleIds.map((ruleId) => ({
      ruleId,
      severity: finalSeverity,
      evidence: post.title,
      sourceUrl: post.permalink,
      llmReason,
      llmSolution,
      llmSimilarServices,
    }));

    signalsByPost.set(post.id, signals);
  }

  if (cacheChanged) {
    await writeLlmCache(cache);
  }

  const aggregated = aggregateProblemsFromSignals(
    posts,
    (post) => signalsByPost.get(post.id) ?? [],
  );
  return verifyServicesInResults(aggregated);
}
