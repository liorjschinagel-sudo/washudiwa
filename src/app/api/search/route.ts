import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, ratings, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  validateUsername,
  scrapeUserRatings,
  scrapeProfileStats,
} from "@/lib/scraper/letterboxd";
import { computeTasteTwinScore } from "@/lib/engine/taste-score";
import { recomputeTasteMatches } from "@/lib/engine/recommend";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { username } = await req.json();
    if (!username) {
      return NextResponse.json(
        { error: "Username required" },
        { status: 400 }
      );
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

    const isValid = await validateUsername(username);
    if (!isValid) {
      return NextResponse.json(
        { error: "Letterboxd username not found" },
        { status: 404 }
      );
    }

    let [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.letterboxdUsername, username))
      .limit(1);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const needsScrape =
      !profile || !profile.lastScrapedAt || profile.lastScrapedAt < sevenDaysAgo;

    if (needsScrape) {
      const stats = await scrapeProfileStats(username);

      if (!profile) {
        [profile] = await db
          .insert(profiles)
          .values({
            letterboxdUsername: username,
            profileType: "reference",
            displayName: stats.displayName,
            totalFilms: stats.totalFilms,
            lastScrapedAt: new Date(),
          })
          .returning();
      } else {
        await db
          .update(profiles)
          .set({
            displayName: stats.displayName,
            totalFilms: stats.totalFilms,
            lastScrapedAt: new Date(),
          })
          .where(eq(profiles.id, profile.id));
      }

      const scrapedRatings = await scrapeUserRatings(username);
      for (const r of scrapedRatings) {
        await db
          .insert(ratings)
          .values({
            profileId: profile.id,
            filmTitle: r.filmTitle,
            filmYear: r.filmYear,
            filmSlug: r.filmSlug,
            rating: r.rating.toString(),
          })
          .onConflictDoNothing();
      }
    }

    const userRatingRows = await db
      .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
      .from(ratings)
      .where(eq(ratings.profileId, user.profileId));

    const userRatings: Record<string, number> = {};
    for (const r of userRatingRows) {
      if (r.filmSlug) userRatings[r.filmSlug] = parseFloat(r.rating);
    }

    const otherRatingRows = await db
      .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
      .from(ratings)
      .where(eq(ratings.profileId, profile.id));

    const otherRatings: Record<string, number> = {};
    for (const r of otherRatingRows) {
      if (r.filmSlug) otherRatings[r.filmSlug] = parseFloat(r.rating);
    }

    const tasteMatch = computeTasteTwinScore(userRatings, otherRatings);

    if (needsScrape) {
      after(async () => {
        try {
          await recomputeTasteMatches(user.profileId!);
        } catch (e) {
          console.error("Background recompute after search failed:", e);
        }
      });
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        username: profile.letterboxdUsername,
        displayName: profile.displayName,
        totalFilms: profile.totalFilms,
      },
      tasteMatch,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search profile" },
      { status: 500 }
    );
  }
}
