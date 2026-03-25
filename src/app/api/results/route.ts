import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "결과 조회 실패";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
