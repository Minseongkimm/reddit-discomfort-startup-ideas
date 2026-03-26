import { NextResponse } from "next/server";
import { rebuildDashboardSnapshot } from "@/lib/dashboard";

export async function POST() {
  try {
    const data = await rebuildDashboardSnapshot({ forceFullPass: true });

    const missingSolution = data.results.reduce((sum, subreddit) => {
      const missing = subreddit.problems.filter(
        (problem) => !(problem.llmSolution && problem.llmSolution.trim().length > 0),
      ).length;
      return sum + missing;
    }, 0);

    return NextResponse.json({
      ok: true,
      mode: data.mode,
      scannedPostCount: data.scannedPostCount,
      totalProblems: data.totalProblems,
      missingSolution,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "전체 재분석 실패";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
