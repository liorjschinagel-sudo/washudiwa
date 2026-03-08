import { db } from "@/lib/db";
import { profiles, ratings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  discoverFromMembersPage,
  discoverFromFilmPage,
  quickScrapeUserRatings,
  scrapeProfileStats,
} from "@/lib/scraper/letterboxd";

const MIN_RATINGS_FOR_TWIN = 10;

/**
 * Phase 1 of discovery: finds new Letterboxd usernames and queues them.
 * Sources: the /members/ page + film pages for the user's top-rated films.
 * Returns the number of new profiles queued.
 */
export async function discoverNewProfiles(
  userProfileId: string
): Promise<{ discovered: number; source: string }> {
  const existing = await db
    .select({ username: profiles.letterboxdUsername })
    .from(profiles);
  const known = new Set(existing.map((p) => p.username.toLowerCase()));

  let newUsernames: string[] = [];
  let source = "";

  // Pull from /members/ page first
  const membersUsers = await discoverFromMembersPage();
  const freshFromMembers = membersUsers.filter((u) => !known.has(u));

  if (freshFromMembers.length > 0) {
    newUsernames = freshFromMembers;
    source = "members-page";
  }

  // Pull from user's top-rated films
  const userTopFilms = await db
    .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
    .from(ratings)
    .where(eq(ratings.profileId, userProfileId));

  const topFilmSlugs = userTopFilms
    .filter((r) => parseFloat(r.rating) >= 4.0 && r.filmSlug)
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
    .slice(0, 20)
    .map((r) => r.filmSlug!);

  // Pick a random subset of 3 films to scrape per call (keeps each call fast)
  const shuffled = topFilmSlugs.sort(() => Math.random() - 0.5);
  const filmBatch = shuffled.slice(0, 3);

  for (const slug of filmBatch) {
    const filmUsers = await discoverFromFilmPage(slug);
    const fresh = filmUsers.filter(
      (u) => !known.has(u) && !newUsernames.includes(u)
    );
    newUsernames.push(...fresh);
    if (!source && fresh.length > 0) source = `film:${slug}`;
  }

  // Queue all discovered usernames
  let queued = 0;
  for (const username of newUsernames) {
    try {
      await db
        .insert(profiles)
        .values({
          letterboxdUsername: username,
          profileType: "queued",
        })
        .onConflictDoNothing();
      queued++;
    } catch {
      // username already exists
    }
  }

  return { discovered: queued, source: source || "none" };
}

/**
 * Phase 2 of discovery: picks one queued profile, quick-scrapes their ratings,
 * and promotes them to 'discovered'. Returns info about what was processed.
 */
export async function processNextQueued(): Promise<{
  status: "processed" | "skipped" | "empty";
  username: string | null;
  ratingsFound: number;
  queueRemaining: number;
}> {
  // Pick the next queued profile
  const [next] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.profileType, "queued"))
    .limit(1);

  if (!next) {
    return { status: "empty", username: null, ratingsFound: 0, queueRemaining: 0 };
  }

  const username = next.letterboxdUsername;

  try {
    const scrapedRatings = await quickScrapeUserRatings(username);

    if (scrapedRatings.length < MIN_RATINGS_FOR_TWIN) {
      // Not enough data — remove from queue
      await db.delete(profiles).where(eq(profiles.id, next.id));
      const remaining = await getQueueSize();
      return { status: "skipped", username, ratingsFound: 0, queueRemaining: remaining };
    }

    // Get their profile stats
    const stats = await scrapeProfileStats(username);

    // Promote to discovered
    await db
      .update(profiles)
      .set({
        profileType: "discovered",
        displayName: stats.displayName,
        totalFilms: stats.totalFilms,
        lastScrapedAt: new Date(),
      })
      .where(eq(profiles.id, next.id));

    // Deduplicate (rewatches produce duplicate slugs in RSS)
    const seenSlugs = new Set<string>();
    const dedupedRatings = scrapedRatings.filter((r) => {
      if (seenSlugs.has(r.filmSlug)) return false;
      seenSlugs.add(r.filmSlug);
      return true;
    });

    const batchSize = 50;
    for (let i = 0; i < dedupedRatings.length; i += batchSize) {
      const batch = dedupedRatings.slice(i, i + batchSize);
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

    const remaining = await getQueueSize();
    return {
      status: "processed",
      username,
      ratingsFound: scrapedRatings.length,
      queueRemaining: remaining,
    };
  } catch {
    // On error, remove from queue so we don't get stuck
    await db.delete(profiles).where(eq(profiles.id, next.id));
    const remaining = await getQueueSize();
    return { status: "skipped", username, ratingsFound: 0, queueRemaining: remaining };
  }
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
