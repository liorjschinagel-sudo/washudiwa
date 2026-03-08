import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userFilmActions } from "@/lib/db/schema";

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

    return NextResponse.json({ success: true, action: result });
  } catch (error) {
    console.error("Action error:", error);
    return NextResponse.json(
      { error: "Failed to save action" },
      { status: 500 }
    );
  }
}
