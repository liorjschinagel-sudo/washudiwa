import { NextResponse } from "next/server";

/**
 * @deprecated — replaced by /api/discover. Kept for backwards compat.
 */
export async function POST() {
  return NextResponse.json({
    status: "done",
    message: "Use /api/discover instead",
    poolSize: 0,
    remaining: 0,
  });
}
