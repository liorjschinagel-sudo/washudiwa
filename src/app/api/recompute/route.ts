import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  recomputeTasteMatches,
  getStaleUserProfileIds,
} from "@/lib/engine/recommend";

/**
 * GET /api/recompute — called by Vercel Cron daily.
 * Vercel validates the cron invocation automatically.
 */
export async function GET() {
  return handleCronRecompute();
}

/**
 * POST /api/recompute — called by authenticated users or internal triggers.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return handleCronRecompute();
  }

  return handleUserRecompute();
}

async function handleUserRecompute() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user?.profileId) {
      return NextResponse.json(
        { error: "Link your Letterboxd account first" },
        { status: 400 }
      );
    }

    const result = await recomputeTasteMatches(user.profileId);

    return NextResponse.json({
      status: "completed",
      matchesComputed: result.matchesComputed,
    });
  } catch (error) {
    console.error("Recompute error:", error);
    return NextResponse.json(
      { error: "Failed to recompute taste index" },
      { status: 500 }
    );
  }
}

async function handleCronRecompute() {
  try {
    const staleProfileIds = await getStaleUserProfileIds();

    if (staleProfileIds.length === 0) {
      return NextResponse.json({
        status: "done",
        message: "No stale users",
        recomputed: 0,
      });
    }

    let recomputed = 0;
    for (const profileId of staleProfileIds) {
      try {
        await recomputeTasteMatches(profileId);
        recomputed++;
      } catch (error) {
        console.error(
          `Cron recompute failed for profile ${profileId}:`,
          error
        );
      }
    }

    return NextResponse.json({
      status: "done",
      recomputed,
      total: staleProfileIds.length,
    });
  } catch (error) {
    console.error("Cron recompute error:", error);
    return NextResponse.json(
      { error: "Cron recompute failed" },
      { status: 500 }
    );
  }
}
