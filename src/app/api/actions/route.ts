import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userFilmActions, ratings, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filmSlug, filmTitle, action, rating } = await req.json();

    if (!filmSlug || !action) {
      return NextResponse.json(
        { error: "filmSlug and action required" },
        { status: 400 }
      );
    }

    if (!["seen", "dismissed", "watchlisted"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [result] = await db
      .insert(userFilmActions)
      .values({
        userId: session.user.id,
        filmSlug,
        filmTitle,
        action,
        rating: rating?.toString() ?? null,
      })
      .onConflictDoUpdate({
        target: [userFilmActions.userId, userFilmActions.filmSlug],
        set: {
          action,
          filmTitle,
          rating: rating?.toString() ?? null,
          actedAt: new Date(),
        },
      })
      .returning();

    // If the user rated it, write back to the ratings table
    // so it enriches their taste profile for future twin scoring
    if (action === "seen" && rating) {
      const [user] = await db
        .select({ profileId: users.profileId })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (user?.profileId) {
        await db
          .insert(ratings)
          .values({
            profileId: user.profileId,
            filmSlug,
            filmTitle: filmTitle || filmSlug,
            rating: rating.toString(),
          })
          .onConflictDoUpdate({
            target: [ratings.profileId, ratings.filmSlug],
            set: {
              rating: rating.toString(),
              scrapedAt: new Date(),
            },
          });
      }
    }

    return NextResponse.json({ success: true, action: result });
  } catch (error) {
    console.error("Action error:", error);
    return NextResponse.json(
      { error: "Failed to save action" },
      { status: 500 }
    );
  }
}
