import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, ratings, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  validateUsername,
  scrapeProfileStats,
  scrapeRssPage,
} from "@/lib/scraper/letterboxd";
import { recomputeTasteMatches } from "@/lib/engine/recommend";

/**
 * Incremental scraper: scrapes one RSS page per request.
 * Client polls with increasing page numbers until done.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { username, page = 1 } = await req.json();
    if (!username) {
      return NextResponse.json(
        { error: "Username required" },
        { status: 400 }
      );
    }

    // On first page, validate + create profile
    if (page === 1) {
      const isValid = await validateUsername(username);
      if (!isValid) {
        return NextResponse.json(
          { error: "Letterboxd username not found" },
          { status: 404 }
        );
      }

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

      await db
        .update(users)
        .set({
          letterboxdUsername: username,
          profileId: profile.id,
          displayName: stats.displayName,
          lastSyncedAt: new Date(),
        })
        .where(eq(users.id, session.user.id));
    }

    // Get the user's profile
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user?.profileId) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 400 }
      );
    }

    // Scrape one RSS page
    const pageResult = await scrapeRssPage(username, page);

    // Deduplicate within the page (rewatches produce duplicate slugs)
    if (pageResult.ratings.length > 0) {
      const seen = new Set<string>();
      const dedupedRatings = pageResult.ratings.filter((r) => {
        if (!r.filmSlug || seen.has(r.filmSlug)) return false;
        seen.add(r.filmSlug);
        return true;
      });

      const batchSize = 50;
      for (let i = 0; i < dedupedRatings.length; i += batchSize) {
        const batch = dedupedRatings.slice(i, i + batchSize);
        await db
          .insert(ratings)
          .values(
            batch.map((r) => ({
              profileId: user.profileId!,
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
    }

    // Get running total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ratings)
      .where(eq(ratings.profileId, user.profileId));

    const totalSoFar = countResult?.count ?? 0;

    // Calculate avg rating
    const [avgResult] = await db
      .select({ avg: sql<string>`avg(${ratings.rating}::numeric)` })
      .from(ratings)
      .where(eq(ratings.profileId, user.profileId));

    const avgRating = avgResult?.avg
      ? parseFloat(avgResult.avg).toFixed(2)
      : "0";

    // Update user stats
    await db
      .update(users)
      .set({ totalRated: totalSoFar, avgRating })
      .where(eq(users.id, session.user.id));

    if (!pageResult.hasMore && user.profileId) {
      after(async () => {
        try {
          await recomputeTasteMatches(user.profileId!);
        } catch (e) {
          console.error("Background recompute after scrape failed:", e);
        }
      });
    }

    return NextResponse.json({
      page,
      ratingsThisPage: pageResult.ratings.length,
      totalItemsThisPage: pageResult.totalItems,
      totalRatedSoFar: totalSoFar,
      avgRating,
      hasMore: pageResult.hasMore,
      done: !pageResult.hasMore,
    });
  } catch (error) {
    console.error("Scrape error:", error);
    return NextResponse.json(
      { error: "Failed to scrape profile" },
      { status: 500 }
    );
  }
}
