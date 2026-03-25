import { NextResponse } from "next/server";
import { syncRedditData } from "@/lib/sync";

export async function POST() {
  try {
    const summary = await syncRedditData();
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "동기화 실패";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
