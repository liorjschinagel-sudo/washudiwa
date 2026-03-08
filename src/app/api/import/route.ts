import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, ratings, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseRatingsCsv } from "@/lib/scraper/csv-parser";
import { scrapeProfileStats } from "@/lib/scraper/letterboxd";
import { recomputeTasteMatches } from "@/lib/engine/recommend";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const username = formData.get("username") as string | null;

    if (!file || !username) {
      return NextResponse.json(
        { error: "File and username required" },
        { status: 400 }
      );
    }

    const text = await file.text();
    const parsedRatings = await parseRatingsCsv(text);

    if (parsedRatings.length === 0) {
      return NextResponse.json(
        { error: "No ratings found in CSV. Make sure you uploaded ratings.csv from the Letterboxd export." },
        { status: 400 }
      );
    }

    // Ensure profile exists
    const stats = await scrapeProfileStats(username);

    let [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.letterboxdUsername, username))
      .limit(1);

    if (!profile) {
      [profile] = await db
        .insert(profiles)
        .values({
          letterboxdUsername: username,
          profileType: "user",
          displayName: stats.displayName,
          totalFilms: stats.totalFilms,
          lastScrapedAt: new Date(),
        })
        .returning();
    } else {
      await db
        .update(profiles)
        .set({
          profileType: "user",
          displayName: stats.displayName,
          totalFilms: stats.totalFilms,
          lastScrapedAt: new Date(),
        })
        .where(eq(profiles.id, profile.id));
    }

    // Link user to profile
    await db
      .update(users)
      .set({
        letterboxdUsername: username,
        profileId: profile.id,
        displayName: stats.displayName,
        lastSyncedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    // Insert all ratings (deduplicated)
    const seenSlugs = new Set<string>();
    const deduped = parsedRatings.filter((r) => {
      if (seenSlugs.has(r.filmSlug)) return false;
      seenSlugs.add(r.filmSlug);
      return true;
    });

    const batchSize = 50;
    for (let i = 0; i < deduped.length; i += batchSize) {
      const batch = deduped.slice(i, i + batchSize);
      await db
        .insert(ratings)
        .values(
          batch.map((r) => ({
            profileId: profile.id,
            filmTitle: r.filmTitle,
            filmYear: r.filmYear,
            filmSlug: r.filmSlug,
            rating: r.rating.toString(),
          }))
        )
        .onConflictDoUpdate({
          target: [ratings.profileId, ratings.filmSlug],
          set: {
            rating: sql`EXCLUDED.rating`,
            filmTitle: sql`EXCLUDED.film_title`,
            scrapedAt: new Date(),
          },
        });
    }

    // Update user stats
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ratings)
      .where(eq(ratings.profileId, profile.id));

    const [avgResult] = await db
      .select({ avg: sql<string>`avg(${ratings.rating}::numeric)` })
      .from(ratings)
      .where(eq(ratings.profileId, profile.id));

    const totalRated = countResult?.count ?? 0;
    const avgRating = avgResult?.avg
      ? parseFloat(avgResult.avg).toFixed(2)
      : "0";

    await db
      .update(users)
      .set({ totalRated, avgRating })
      .where(eq(users.id, session.user.id));

    // Recompute taste index in background
    after(async () => {
      try {
        await recomputeTasteMatches(profile.id);
      } catch (e) {
        console.error("Background recompute after import failed:", e);
      }
    });

    return NextResponse.json({
      success: true,
      totalRated,
      avgRating,
      displayName: stats.displayName || username,
      imported: deduped.length,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import ratings" },
      { status: 500 }
    );
  }
}
