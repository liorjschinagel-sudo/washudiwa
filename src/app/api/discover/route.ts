import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  discoverNewProfiles,
  processQueuedBatch,
  getPoolSize,
  getQueueSize,
} from "@/lib/engine/discover";

/**
 * POST /api/discover
 *
 * action = "find"     → crawl film pages + members page for new usernames
 *   - filmOffset: which film to start from (client increments)
 *   - batchSize: how many film pages to crawl per call (default 10)
 *
 * action = "process"  → quick-scrape a batch of queued profiles
 *   - count: how many to process per call (default 3)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = body.action ?? "process";

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

    if (action === "find") {
      const filmOffset = body.filmOffset ?? 0;
      const batchSize = body.batchSize ?? 10;

      const result = await discoverNewProfiles(
        user.profileId,
        filmOffset,
        batchSize
      );
      const queueSize = await getQueueSize();
      const poolSize = await getPoolSize();

      return NextResponse.json({
        action: "find",
        ...result,
        queueSize,
        poolSize,
      });
    }

    if (action === "process") {
      const count = body.count ?? 3;
      const result = await processQueuedBatch(count);

      return NextResponse.json({
        action: "process",
        ...result,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Discover error:", error);
    return NextResponse.json(
      { error: "Discovery failed" },
      { status: 500 }
    );
  }
}
