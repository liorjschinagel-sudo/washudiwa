import { NextRequest, NextResponse } from "next/server";
import { lookupFilm } from "@/lib/tmdb";

/**
 * GET /api/film?title=...&year=...
 * Returns TMDB metadata: poster, overview, director, streaming providers.
 */
export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  const year = req.nextUrl.searchParams.get("year");

  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const info = await lookupFilm(title, year);

  if (!info) {
    return NextResponse.json({ info: null });
  }

  return NextResponse.json({ info });
}
