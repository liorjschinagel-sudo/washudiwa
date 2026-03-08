import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user] = await db
      .select({ streamingServices: users.streamingServices })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const services: string[] = user?.streamingServices
      ? JSON.parse(user.streamingServices)
      : [];

    return NextResponse.json({ services });
  } catch {
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { services } = await req.json();

    if (!Array.isArray(services)) {
      return NextResponse.json({ error: "services must be an array" }, { status: 400 });
    }

    await db
      .update(users)
      .set({ streamingServices: JSON.stringify(services) })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({ success: true, services });
  } catch {
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }
}
