import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, recommendations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  generateRecommendations,
  getConfidence,
  isTasteIndexFresh,
} from "@/lib/engine/recommend";
import { getPoolSize } from "@/lib/engine/discover";

export async function GET() {
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

    const existingRecs = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.userId, session.user.id));

    const poolSize = await getPoolSize();

    let tasteIndexStatus: { fresh: boolean; computedAt: string | null } = {
      fresh: false,
      computedAt: null,
    };
    if (user?.profileId) {
      const freshness = await isTasteIndexFresh(user.profileId);
      tasteIndexStatus = {
        fresh: freshness.fresh,
        computedAt: freshness.computedAt?.toISOString() ?? null,
      };
    }

    return NextResponse.json({
      recommendations: existingRecs,
      poolSize,
      tasteIndexStatus,
    });
  } catch (error) {
    console.error("Recommendations error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recommendations" },
      { status: 500 }
    );
  }
}

/**
 * Generates recommendations from pre-computed taste matches (fast path).
 * Taste matches should already exist via /api/recompute.
 * If no matches exist, falls back to computing them inline.
 */
export async function POST() {
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

    const recs = await generateRecommendations(user.profileId, user.id);

    if (recs.length === 0) {
      return NextResponse.json({
        recommendations: [],
        totalGenerated: 0,
        needsRecompute: true,
      });
    }

    await db
      .delete(recommendations)
      .where(eq(recommendations.userId, session.user.id));

    const savedRecs = [];
    for (const rec of recs) {
      const avgRating =
        rec.ratings.reduce((s, r) => s + r, 0) / rec.ratings.length;
      const confidence = getConfidence(rec.sources.length, avgRating);

      const [saved] = await db
        .insert(recommendations)
        .values({
          userId: user.id,
          filmTitle: rec.filmTitle,
          filmYear: rec.filmYear,
          filmSlug: rec.filmSlug,
          predictedScore: rec.score.toFixed(2),
          sourceProfileIds: JSON.stringify(rec.sources),
          confidence,
          reason: `${rec.sources.length} taste twin${rec.sources.length > 1 ? "s" : ""} rated this ${avgRating.toFixed(1)}★ avg`,
        })
        .returning();

      savedRecs.push(saved);
    }

    return NextResponse.json({
      recommendations: savedRecs,
      totalGenerated: savedRecs.length,
    });
  } catch (error) {
    console.error("Generate recs error:", error);
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
