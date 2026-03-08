import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  discoverNewProfiles,
  processNextQueued,
  getPoolSize,
  getQueueSize,
} from "@/lib/engine/discover";

/**
 * POST /api/discover
 * 
 * action = "find"     → discover new usernames from members page + film pages
 * action = "process"  → quick-scrape one queued profile
 * 
 * The client calls "find" once, then loops "process" until the queue is drained
 * or the pool is large enough.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action = "process" } = await req.json();

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
      const result = await discoverNewProfiles(user.profileId);
      const poolSize = await getPoolSize();
      const queueSize = await getQueueSize();

      return NextResponse.json({
        action: "find",
        discovered: result.discovered,
        source: result.source,
        poolSize,
        queueSize,
      });
    }

    if (action === "process") {
      const result = await processNextQueued();
      const poolSize = await getPoolSize();

      return NextResponse.json({
        action: "process",
        ...result,
        poolSize,
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
