import { getTargetSubreddits } from "./config";
import type { StoredPost } from "./types";

type Seed = {
  subreddit: string;
  title: string;
  body: string;
  score: number;
  comments: number;
};

const SAMPLE_POSTS_PER_SUBREDDIT = 36;

const BASE_SEEDS: Seed[] = [
  {
    subreddit: "r/startups",
    title: "User onboarding drop-off is killing trial conversions",
    body: "Activation is low and we do not know where users quit the flow.",
    score: 182,
    comments: 44,
  },
  {
    subreddit: "r/startups",
    title: "Support inbox is chaotic after launch week",
    body: "No triage process and urgent bug tickets are buried in mixed channels.",
    score: 131,
    comments: 30,
  },
  {
    subreddit: "r/startups",
    title: "Funnel attribution still unclear across dashboards",
    body: "Analytics and tracking numbers never match, CAC is hard to trust.",
    score: 148,
    comments: 36,
  },
  {
    subreddit: "r/smallbusiness",
    title: "We keep missing booking requests from DMs",
    body: "Messages come from DM, phone and email. Some requests are lost every week.",
    score: 123,
    comments: 29,
  },
  {
    subreddit: "r/smallbusiness",
    title: "Manual invoices take too much time",
    body: "Still using spreadsheets and reminder emails for late payment follow-up.",
    score: 97,
    comments: 18,
  },
  {
    subreddit: "r/smallbusiness",
    title: "Returns process creates repeated customer complaints",
    body: "Return approvals are manual and support response time is slow.",
    score: 88,
    comments: 16,
  },
  {
    subreddit: "r/freelance",
    title: "Clients delay payment and cashflow gets unstable",
    body: "No clear invoice automation and payment reminders are repetitive work.",
    score: 169,
    comments: 42,
  },
  {
    subreddit: "r/freelance",
    title: "Scope creep makes margins collapse",
    body: "Change requests keep increasing and revisions are not priced properly.",
    score: 117,
    comments: 24,
  },
  {
    subreddit: "r/freelance",
    title: "Switching between tools causes deadline misses",
    body: "Task updates are split between email, chat and docs, context gets lost.",
    score: 92,
    comments: 21,
  },
  {
    subreddit: "r/SaaS",
    title: "Tool stack cost keeps growing every quarter",
    body: "Subscription overlap across teams is too expensive for current revenue.",
    score: 111,
    comments: 27,
  },
  {
    subreddit: "r/SaaS",
    title: "Support queue explodes after each release",
    body: "No ticket categorization, support workload is a bottleneck.",
    score: 136,
    comments: 31,
  },
  {
    subreddit: "r/SaaS",
    title: "Trial users churn before activation",
    body: "Onboarding dropoff remains high, no clear metric for activation steps.",
    score: 154,
    comments: 40,
  },
  {
    subreddit: "r/Entrepreneur",
    title: "Paid ads are expensive and attribution is weak",
    body: "Campaign performance is hard to read, dashboard numbers conflict.",
    score: 128,
    comments: 34,
  },
  {
    subreddit: "r/Entrepreneur",
    title: "Back office operations are still manual",
    body: "Order checks, invoice updates and reminders consume hours every day.",
    score: 95,
    comments: 19,
  },
  {
    subreddit: "r/ecommerce",
    title: "Inventory mismatch leads to overselling",
    body: "Stock sync issues cause refunds and support tickets.",
    score: 162,
    comments: 39,
  },
  {
    subreddit: "r/ecommerce",
    title: "Customer returns are too expensive to process",
    body: "Returns process is manual and inconsistent across channels.",
    score: 109,
    comments: 22,
  },
  {
    subreddit: "r/marketing",
    title: "Campaign reporting takes forever every week",
    body: "Data is split across dashboards and tracking attribution is unclear.",
    score: 104,
    comments: 23,
  },
  {
    subreddit: "r/marketing",
    title: "Creative approval process is a bottleneck",
    body: "Feedback in Slack and email has no version control.",
    score: 83,
    comments: 14,
  },
  {
    subreddit: "r/solopreneur",
    title: "Leads go cold without automated follow-up",
    body: "No simple CRM workflow, reminders are easy to miss.",
    score: 101,
    comments: 25,
  },
  {
    subreddit: "r/solopreneur",
    title: "Too many tools for support and scheduling",
    body: "Context switching is repetitive and wastes time daily.",
    score: 90,
    comments: 17,
  },
  {
    subreddit: "r/agency",
    title: "Client communication spread across channels",
    body: "Important requests get buried in Slack, DM and email threads.",
    score: 96,
    comments: 20,
  },
  {
    subreddit: "r/agency",
    title: "Revision requests keep expanding project scope",
    body: "Scope creep and late change requests hurt delivery quality.",
    score: 119,
    comments: 28,
  },
  {
    subreddit: "r/sideproject",
    title: "No reliable way to track early user feedback",
    body: "Interview notes disappear and learning is not retained.",
    score: 87,
    comments: 13,
  },
  {
    subreddit: "r/sideproject",
    title: "Post-launch bug reports are hard to prioritize",
    body: "Support tickets and feature requests are mixed in one inbox.",
    score: 94,
    comments: 15,
  },
];

const TEMPLATE_SEEDS: Array<Omit<Seed, "subreddit">> = [
  {
    title: "DM and email requests are buried without triage",
    body: "The inbox is chaotic and support response time keeps slipping.",
    score: 84,
    comments: 12,
  },
  {
    title: "Late payment follow-up is still manual every week",
    body: "Invoice reminders are repetitive and cashflow visibility is poor.",
    score: 91,
    comments: 15,
  },
  {
    title: "Spreadsheet workflow takes hours every day",
    body: "Manual handoff between tools creates repetitive mistakes.",
    score: 88,
    comments: 14,
  },
  {
    title: "Interview notes disappear before we can tag insights",
    body: "No version control for research notes, so knowledge gets lost.",
    score: 76,
    comments: 10,
  },
  {
    title: "Onboarding activation keeps dropping after trial signup",
    body: "Users churn before activation and the dropoff point is unclear.",
    score: 107,
    comments: 19,
  },
  {
    title: "Analytics dashboard and funnel tracking do not agree",
    body: "Attribution and CAC metrics conflict across reports.",
    score: 102,
    comments: 18,
  },
  {
    title: "Support queue spikes after each small release",
    body: "Bug tickets pile up and triage quality drops fast.",
    score: 98,
    comments: 16,
  },
  {
    title: "Subscription stack cost keeps growing too quickly",
    body: "The current pricing footprint is too expensive for this stage.",
    score: 95,
    comments: 14,
  },
  {
    title: "Change requests turn into scope creep every sprint",
    body: "Revisions keep expanding work and margins collapse.",
    score: 96,
    comments: 17,
  },
  {
    title: "Inventory mismatch triggers refunds and returns process pain",
    body: "Overselling and out of stock errors increase support tickets.",
    score: 100,
    comments: 18,
  },
  {
    title: "Slack and email communication causes channel fragmentation",
    body: "Important requests are missed when context is split between channels.",
    score: 86,
    comments: 13,
  },
  {
    title: "Switching between chat and docs keeps context fragmented",
    body: "Tracking updates across tools is repetitive manual work.",
    score: 82,
    comments: 11,
  },
];

function subredditSlug(subreddit: string) {
  return subreddit
    .replace(/^r\//, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();
}

function buildGeneratedSeeds(targetSubreddits: string[]): Seed[] {
  const generated: Seed[] = [];

  for (const [subredditIndex, subreddit] of targetSubreddits.entries()) {
    const label = subreddit.replace(/^r\//, "");

    for (let i = 0; i < SAMPLE_POSTS_PER_SUBREDDIT; i += 1) {
      const template = TEMPLATE_SEEDS[(subredditIndex * 5 + i) % TEMPLATE_SEEDS.length];
      const round = Math.floor(i / TEMPLATE_SEEDS.length) + 1;
      const scoreBoost = (subredditIndex * 7 + i * 9) % 70;
      const commentBoost = (subredditIndex * 3 + i * 5) % 26;

      generated.push({
        subreddit,
        title: `${template.title} (${label} case ${i + 1})`,
        body: `${template.body} This issue appears repeatedly in ${label} week ${round}.`,
        score: template.score + scoreBoost,
        comments: template.comments + commentBoost,
      });
    }
  }

  return generated;
}

export function getSamplePosts(): StoredPost[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const targets = getTargetSubreddits();
  const seeds = [...BASE_SEEDS, ...buildGeneratedSeeds(targets)];

  return seeds.map((seed, index) => {
    const createdUtc = nowSec - index * 300;
    const noPrefix = seed.subreddit.replace(/^r\//, "");
    const slug = subredditSlug(seed.subreddit);
    const sequence = index + 1;

    return {
      id: `sample-${slug}-${sequence}`,
      subreddit: seed.subreddit,
      title: seed.title,
      body: seed.body,
      score: seed.score,
      comments: seed.comments,
      createdUtc,
      permalink: `https://reddit.com/r/${noPrefix}/comments/sample_${slug}_${sequence}`,
      url: `https://reddit.com/r/${noPrefix}/comments/sample_${slug}_${sequence}`,
      fetchedAt: new Date(createdUtc * 1000).toISOString(),
    };
  });
}
