import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profiles, ratings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  discoverFromMembersPage,
  scrapeUserRatings,
  scrapeProfileStats,
} from "@/lib/scraper/letterboxd";

const MIN_RATINGS = 10;
const MAX_RUNTIME_MS = 4.5 * 60 * 1000; // 4.5 min (Vercel hobby cron limit is 5 min)

/**
 * GET /api/cron/grow-pool
 *
 * Nightly cron job that:
 * 1. Discovers new usernames from the /members/ page
 * 2. Drains the queued profiles
 * 3. Deepens shallow profiles (re-scrapes with full RSS pagination)
 *
 * Designed to run within Vercel's 5-minute cron timeout.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const elapsed = () => Date.now() - start;
  const stats = { discovered: 0, queued_processed: 0, deepened: 0, skipped: 0 };

  try {
    // Phase 1: Discover new usernames from /members/ (rotates daily)
    const existing = await db
      .select({ username: profiles.letterboxdUsername })
      .from(profiles);
    const known = new Set(existing.map((p) => p.username.toLowerCase()));

    const membersUsers = await discoverFromMembersPage();
    for (const username of membersUsers) {
      if (known.has(username)) continue;
      await db
        .insert(profiles)
        .values({ letterboxdUsername: username, profileType: "queued" })
        .onConflictDoNothing();
      stats.discovered++;
    }

    // Phase 2: Drain queued profiles
    while (elapsed() < MAX_RUNTIME_MS) {
      const [next] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.profileType, "queued"))
        .limit(1);

      if (!next) break;

      try {
        const scrapedRatings = await scrapeUserRatings(next.letterboxdUsername);

        if (scrapedRatings.length < MIN_RATINGS) {
          await db.delete(profiles).where(eq(profiles.id, next.id));
          stats.skipped++;
          continue;
        }

        const profileStats = await scrapeProfileStats(next.letterboxdUsername);

        await db
          .update(profiles)
          .set({
            profileType: "discovered",
            displayName: profileStats.displayName,
            totalFilms: profileStats.totalFilms,
            lastScrapedAt: new Date(),
          })
          .where(eq(profiles.id, next.id));

        const seenSlugs = new Set<string>();
        const deduped = scrapedRatings.filter((r) => {
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
                profileId: next.id,
                filmTitle: r.filmTitle,
                filmYear: r.filmYear,
                filmSlug: r.filmSlug,
                rating: r.rating.toString(),
              }))
            )
            .onConflictDoNothing();
        }

        stats.queued_processed++;
      } catch {
        await db.delete(profiles).where(eq(profiles.id, next.id));
        stats.skipped++;
      }
    }

    // Phase 3: Deepen shallow profiles (those with ≤50 ratings that probably have more)
    while (elapsed() < MAX_RUNTIME_MS) {
      const [shallow] = await db
        .select({
          id: profiles.id,
          username: profiles.letterboxdUsername,
          ratingCount: sql<number>`(SELECT count(*) FROM ratings WHERE profile_id = ${profiles.id})`,
        })
        .from(profiles)
        .where(
          sql`${profiles.profileType} = 'discovered' AND ${profiles.totalFilms} > 100`
        )
        .orderBy(sql`(SELECT count(*) FROM ratings WHERE profile_id = ${profiles.id}) ASC`)
        .limit(1);

      if (!shallow || shallow.ratingCount > 100) break;

      try {
        const fullRatings = await scrapeUserRatings(shallow.username);

        const seenSlugs = new Set<string>();
        const deduped = fullRatings.filter((r) => {
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
                profileId: shallow.id,
                filmTitle: r.filmTitle,
                filmYear: r.filmYear,
                filmSlug: r.filmSlug,
                rating: r.rating.toString(),
              }))
            )
            .onConflictDoNothing();
        }

        await db
          .update(profiles)
          .set({ lastScrapedAt: new Date() })
          .where(eq(profiles.id, shallow.id));

        stats.deepened++;
      } catch {
        stats.skipped++;
      }
    }

    return NextResponse.json({
      status: "done",
      elapsed_ms: elapsed(),
      ...stats,
    });
  } catch (error) {
    console.error("Cron grow-pool error:", error);
    return NextResponse.json(
      { error: "Cron job failed", elapsed_ms: elapsed(), ...stats },
      { status: 500 }
    );
  }
}
