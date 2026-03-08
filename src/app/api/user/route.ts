import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, ratings, tasteMatches, profiles, userFilmActions } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

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

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let topLoves: { filmTitle: string; rating: string }[] = [];
    let topHates: { filmTitle: string; rating: string }[] = [];
    let twins: {
      username: string;
      displayName: string | null;
      score: number;
      overlapCount: number;
      sharedLoves: number;
      sharedHates: number;
    }[] = [];

    if (user.profileId) {
      topLoves = await db
        .select({ filmTitle: ratings.filmTitle, rating: ratings.rating })
        .from(ratings)
        .where(eq(ratings.profileId, user.profileId))
        .orderBy(desc(ratings.rating))
        .limit(5);

      topHates = await db
        .select({ filmTitle: ratings.filmTitle, rating: ratings.rating })
        .from(ratings)
        .where(eq(ratings.profileId, user.profileId))
        .orderBy(ratings.rating)
        .limit(5);

      const matchRows = await db
        .select({
          matchProfileId: tasteMatches.matchProfileId,
          score: tasteMatches.score,
          overlapCount: tasteMatches.overlapCount,
          sharedLoves: tasteMatches.sharedLoves,
          sharedHates: tasteMatches.sharedHates,
        })
        .from(tasteMatches)
        .where(eq(tasteMatches.userProfileId, user.profileId))
        .orderBy(desc(tasteMatches.score))
        .limit(10);

      if (matchRows.length > 0) {
        const profileIds = matchRows.map((m) => m.matchProfileId);
        const matchProfiles = await db
          .select()
          .from(profiles)
          .where(sql`${profiles.id} IN (${sql.join(profileIds.map(id => sql`${id}`), sql`, `)})`);

        const profileMap = new Map(matchProfiles.map((p) => [p.id, p]));

        twins = matchRows
          .map((m) => {
            const profile = profileMap.get(m.matchProfileId);
            if (!profile) return null;
            return {
              username: profile.letterboxdUsername,
              displayName: profile.displayName,
              score: parseFloat(m.score ?? "0"),
              overlapCount: m.overlapCount ?? 0,
              sharedLoves: m.sharedLoves ?? 0,
              sharedHates: m.sharedHates ?? 0,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);
      }
    }

    let totalFilmsOnLetterboxd: number | null = null;
    if (user.profileId) {
      const [profile] = await db
        .select({ totalFilms: profiles.totalFilms })
        .from(profiles)
        .where(eq(profiles.id, user.profileId))
        .limit(1);
      totalFilmsOnLetterboxd = profile?.totalFilms ?? null;
    }

    const activityRows = await db
      .select({
        filmSlug: userFilmActions.filmSlug,
        filmTitle: userFilmActions.filmTitle,
        action: userFilmActions.action,
        rating: userFilmActions.rating,
        actedAt: userFilmActions.actedAt,
      })
      .from(userFilmActions)
      .where(eq(userFilmActions.userId, user.id))
      .orderBy(desc(userFilmActions.actedAt));

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        letterboxdUsername: user.letterboxdUsername,
        displayName: user.displayName,
        profileId: user.profileId,
        totalRated: user.totalRated,
        avgRating: user.avgRating,
        lastSyncedAt: user.lastSyncedAt,
        totalFilmsOnLetterboxd,
      },
      topLoves,
      topHates,
      twins,
      activity: activityRows,
    });
  } catch (error) {
    console.error("User API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
