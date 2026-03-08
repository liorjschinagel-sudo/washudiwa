import { db } from "@/lib/db";
import {
  profiles,
  ratings,
  tasteMatches,
  userFilmActions,
  users,
} from "@/lib/db/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { computeTasteTwinScore } from "./taste-score";

interface CandidateFilm {
  filmSlug: string;
  filmTitle: string;
  filmYear: string | null;
  score: number;
  sources: string[];
  ratings: number[];
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Background-only: computes taste twin scores for a user against all
 * reference profiles and persists them to the taste_matches table.
 * This can be slow — no user request is waiting on it.
 */
export async function recomputeTasteMatches(
  userProfileId: string
): Promise<{ matchesComputed: number }> {
  const userRatingRows = await db
    .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
    .from(ratings)
    .where(eq(ratings.profileId, userProfileId));

  const userRatings: Record<string, number> = {};
  for (const r of userRatingRows) {
    if (r.filmSlug) userRatings[r.filmSlug] = parseFloat(r.rating);
  }

  if (Object.keys(userRatings).length === 0) {
    return { matchesComputed: 0 };
  }

  const allCandidateProfiles = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      sql`${profiles.profileType} IN ('reference', 'user', 'discovered', 'critic') AND ${profiles.id} != ${userProfileId}`
    );

  let matchesComputed = 0;

  for (const profile of allCandidateProfiles) {
    const profileRatingRows = await db
      .select({ filmSlug: ratings.filmSlug, rating: ratings.rating })
      .from(ratings)
      .where(eq(ratings.profileId, profile.id));

    const otherRatings: Record<string, number> = {};
    for (const r of profileRatingRows) {
      if (r.filmSlug) otherRatings[r.filmSlug] = parseFloat(r.rating);
    }

    const match = computeTasteTwinScore(userRatings, otherRatings);
    if (match && match.score > 0) {
      await db
        .insert(tasteMatches)
        .values({
          userProfileId,
          matchProfileId: profile.id,
          score: match.score.toString(),
          overlapCount: match.overlapCount,
          sharedLoves: match.sharedLoves,
          sharedHates: match.sharedHates,
          strongDisagrees: match.strongDisagrees,
        })
        .onConflictDoUpdate({
          target: [tasteMatches.userProfileId, tasteMatches.matchProfileId],
          set: {
            score: match.score.toString(),
            overlapCount: match.overlapCount,
            sharedLoves: match.sharedLoves,
            sharedHates: match.sharedHates,
            strongDisagrees: match.strongDisagrees,
            computedAt: new Date(),
          },
        });

      matchesComputed++;
    }
  }

  await db
    .update(users)
    .set({ tasteIndexComputedAt: new Date() })
    .where(eq(users.profileId, userProfileId));

  return { matchesComputed };
}

/**
 * Fast path: generates recommendations by reading pre-computed taste matches.
 * Only loads ratings for the top 20 twins (batched). Typically < 5 seconds.
 */
export async function generateRecommendations(
  userProfileId: string,
  userId: string,
  topN: number = 200
): Promise<CandidateFilm[]> {
  const topMatches = await db
    .select({
      matchProfileId: tasteMatches.matchProfileId,
      score: tasteMatches.score,
    })
    .from(tasteMatches)
    .where(eq(tasteMatches.userProfileId, userProfileId))
    .orderBy(desc(tasteMatches.score))
    .limit(20);

  if (topMatches.length === 0) {
    return [];
  }

  const userRatingRows = await db
    .select({ filmSlug: ratings.filmSlug })
    .from(ratings)
    .where(eq(ratings.profileId, userProfileId));

  const dismissedRows = await db
    .select({ filmSlug: userFilmActions.filmSlug })
    .from(userFilmActions)
    .where(
      and(
        eq(userFilmActions.userId, userId),
        inArray(userFilmActions.action, ["seen", "dismissed"])
      )
    );

  const seenSlugs = new Set([
    ...userRatingRows.map((r) => r.filmSlug).filter(Boolean),
    ...dismissedRows.map((r) => r.filmSlug),
  ]);

  const twinProfileIds = topMatches.map((m) => m.matchProfileId);
  const twinRatingRows = await db
    .select({
      profileId: ratings.profileId,
      filmSlug: ratings.filmSlug,
      filmTitle: ratings.filmTitle,
      filmYear: ratings.filmYear,
      rating: ratings.rating,
    })
    .from(ratings)
    .where(inArray(ratings.profileId, twinProfileIds));

  const scoreByProfileId: Record<string, number> = {};
  for (const m of topMatches) {
    scoreByProfileId[m.matchProfileId] = parseFloat(m.score ?? "0");
  }

  const filmScores: Record<string, CandidateFilm> = {};

  for (const r of twinRatingRows) {
    if (!r.filmSlug || seenSlugs.has(r.filmSlug)) continue;
    const ratingNum = parseFloat(r.rating);
    if (ratingNum < 4.0) continue;

    const twinScore = scoreByProfileId[r.profileId] ?? 0;
    const weight = twinScore * (ratingNum / 5.0);

    if (!filmScores[r.filmSlug]) {
      filmScores[r.filmSlug] = {
        filmSlug: r.filmSlug,
        filmTitle: r.filmTitle,
        filmYear: r.filmYear,
        score: 0,
        sources: [],
        ratings: [],
      };
    }

    filmScores[r.filmSlug].score += weight;
    filmScores[r.filmSlug].sources.push(r.profileId);
    filmScores[r.filmSlug].ratings.push(ratingNum);
  }

  for (const slug in filmScores) {
    if (filmScores[slug].sources.length > 10) {
      filmScores[slug].score *= 0.7;
    }
  }

  const ranked = Object.values(filmScores).sort((a, b) => b.score - a.score);
  return ranked.slice(0, topN);
}

/**
 * Check whether a user's taste index is fresh (computed within the last 24h).
 */
export async function isTasteIndexFresh(
  userProfileId: string
): Promise<{ fresh: boolean; computedAt: Date | null }> {
  const [user] = await db
    .select({ tasteIndexComputedAt: users.tasteIndexComputedAt })
    .from(users)
    .where(eq(users.profileId, userProfileId))
    .limit(1);

  const computedAt = user?.tasteIndexComputedAt ?? null;
  if (!computedAt) return { fresh: false, computedAt: null };

  const age = Date.now() - computedAt.getTime();
  return { fresh: age < STALE_THRESHOLD_MS, computedAt };
}

/**
 * Returns all user profile IDs whose taste index is stale or missing.
 */
export async function getStaleUserProfileIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const staleUsers = await db
    .select({ profileId: users.profileId })
    .from(users)
    .where(
      sql`${users.profileId} IS NOT NULL AND (${users.tasteIndexComputedAt} IS NULL OR ${users.tasteIndexComputedAt} < ${cutoff})`
    );

  return staleUsers
    .map((u) => u.profileId)
    .filter((id): id is string => id !== null);
}

export function getConfidence(
  sourceCount: number,
  avgRating: number
): "HIGH MATCH" | "LIKELY" | "WILD CARD" {
  if (sourceCount >= 5 && avgRating >= 4.5) return "HIGH MATCH";
  if (sourceCount >= 3 || avgRating >= 4.0) return "LIKELY";
  return "WILD CARD";
}
