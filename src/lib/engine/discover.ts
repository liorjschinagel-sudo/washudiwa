import { db } from "@/lib/db";
import { profiles, ratings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  discoverFromMembersPage,
  discoverFromFilmPage,
  quickScrapeUserRatings,
  scrapeProfileStats,
} from "@/lib/scraper/letterboxd";

const MIN_RATINGS_FOR_TWIN = 30;

/**
 * Discovery Phase 1: finds new Letterboxd usernames from the user's films.
 *
 * Takes an offset to crawl different films on each call. The client
 * increments the offset until all top films have been crawled.
 *
 * Each call scrapes `batchSize` film pages (~10 users each) plus the
 * /members/ page on the first call.
 */
export async function discoverNewProfiles(
  userProfileId: string,
  filmOffset: number = 0,
  batchSize: number = 10
): Promise<{
  discovered: number;
  filmsScanned: number;
  totalTopFilms: number;
  hasMoreFilms: boolean;
}> {
  const existing = await db
    .select({ username: profiles.letterboxdUsername })
    .from(profiles);
  const known = new Set(existing.map((p) => p.username.toLowerCase()));
  let newUsernames: string[] = [];

  // On first batch, also pull from /members/
  if (filmOffset === 0) {
    const membersUsers = await discoverFromMembersPage();
    const fresh = membersUsers.filter((u) => !known.has(u));
    newUsernames.push(...fresh);
    for (const u of fresh) known.add(u);
  }

  // Get user's top-rated films (loves + hates — both matter for twin discovery)
  const userFilms = await db
    .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
    .from(ratings)
    .where(eq(ratings.profileId, userProfileId));

  const significantFilms = userFilms
    .filter(
      (r) =>
        r.filmSlug &&
        (parseFloat(r.rating) >= 4.0 || parseFloat(r.rating) <= 2.0)
    )
    .sort((a, b) => {
      const aExtreme = Math.abs(parseFloat(a.rating) - 2.5);
      const bExtreme = Math.abs(parseFloat(b.rating) - 2.5);
      return bExtreme - aExtreme;
    });

  const totalTopFilms = significantFilms.length;
  const filmBatch = significantFilms.slice(filmOffset, filmOffset + batchSize);

  for (const film of filmBatch) {
    if (!film.filmSlug) continue;
    try {
      const filmUsers = await discoverFromFilmPage(film.filmSlug);
      const fresh = filmUsers.filter(
        (u) => !known.has(u) && !newUsernames.includes(u)
      );
      newUsernames.push(...fresh);
      for (const u of fresh) known.add(u);
    } catch {}
  }

  // Queue all discovered usernames
  let queued = 0;
  for (const username of newUsernames) {
    try {
      await db
        .insert(profiles)
        .values({ letterboxdUsername: username, profileType: "queued" })
        .onConflictDoNothing();
      queued++;
    } catch {}
  }

  return {
    discovered: queued,
    filmsScanned: filmBatch.length,
    totalTopFilms,
    hasMoreFilms: filmOffset + batchSize < totalTopFilms,
  };
}

/**
 * Discovery Phase 2: quick-scrapes queued profiles in a batch.
 * Processes up to `count` profiles per call.
 */
export async function processQueuedBatch(
  count: number = 3
): Promise<{
  processed: number;
  skipped: number;
  queueRemaining: number;
  poolSize: number;
  details: string[];
}> {
  const queued = await db
    .select()
    .from(profiles)
    .where(eq(profiles.profileType, "queued"))
    .limit(count);

  if (queued.length === 0) {
    const ps = await getPoolSize();
    return { processed: 0, skipped: 0, queueRemaining: 0, poolSize: ps, details: [] };
  }

  let processed = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const profile of queued) {
    const username = profile.letterboxdUsername;
    try {
      const scrapedRatings = await quickScrapeUserRatings(username);

      if (scrapedRatings.length < MIN_RATINGS_FOR_TWIN) {
        await db.delete(profiles).where(eq(profiles.id, profile.id));
        skipped++;
        details.push(`${username}: skipped (${scrapedRatings.length} ratings)`);
        continue;
      }

      const stats = await scrapeProfileStats(username);

      await db
        .update(profiles)
        .set({
          profileType: "discovered",
          displayName: stats.displayName,
          totalFilms: stats.totalFilms,
          lastScrapedAt: new Date(),
        })
        .where(eq(profiles.id, profile.id));

      // Deduplicate and insert ratings
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
              profileId: profile.id,
              filmTitle: r.filmTitle,
              filmYear: r.filmYear,
              filmSlug: r.filmSlug,
              rating: r.rating.toString(),
            }))
          )
          .onConflictDoNothing();
      }

      processed++;
      details.push(`${username}: ${deduped.length} ratings`);
    } catch {
      await db.delete(profiles).where(eq(profiles.id, profile.id));
      skipped++;
      details.push(`${username}: error`);
    }
  }

  const remaining = await getQueueSize();
  const ps = await getPoolSize();

  return {
    processed,
    skipped,
    queueRemaining: remaining,
    poolSize: ps,
    details,
  };
}

export async function getPoolSize(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(profiles)
    .where(
      sql`${profiles.profileType} IN ('reference', 'user', 'discovered', 'critic')`
    );
  return result[0]?.count ?? 0;
}

export async function getQueueSize(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(profiles)
    .where(eq(profiles.profileType, "queued"));
  return result[0]?.count ?? 0;
}
