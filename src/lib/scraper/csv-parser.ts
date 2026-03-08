import type { ScrapedRating } from "./letterboxd";

interface RawRating {
  filmTitle: string;
  filmYear: string | null;
  uri: string | null;
  rating: number;
}

/**
 * Parses a Letterboxd ratings.csv export and resolves boxd.it short URLs
 * to real Letterboxd slugs.
 *
 * Format: Date,Name,Year,Letterboxd URI,Rating
 */
export async function parseRatingsCsv(
  csvText: string
): Promise<ScrapedRating[]> {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const nameIdx = headers.findIndex((h) => h.toLowerCase() === "name");
  const yearIdx = headers.findIndex((h) => h.toLowerCase() === "year");
  const ratingIdx = headers.findIndex((h) => h.toLowerCase() === "rating");
  const uriIdx = headers.findIndex(
    (h) => h.toLowerCase() === "letterboxd uri"
  );

  if (nameIdx === -1 || ratingIdx === -1) return [];

  const rawRatings: RawRating[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const filmTitle = cols[nameIdx]?.trim();
    const filmYear = yearIdx >= 0 ? cols[yearIdx]?.trim() || null : null;
    const ratingStr = cols[ratingIdx]?.trim();
    const uri = uriIdx >= 0 ? cols[uriIdx]?.trim() || null : null;

    if (!filmTitle || !ratingStr) continue;

    const rating = parseFloat(ratingStr);
    if (isNaN(rating) || rating < 0.5 || rating > 5.0) continue;

    rawRatings.push({ filmTitle, filmYear, uri, rating });
  }

  // Resolve boxd.it short URLs to real slugs in parallel batches
  const BATCH_SIZE = 20;
  const results: ScrapedRating[] = [];
  const seenSlugs = new Set<string>();

  for (let i = 0; i < rawRatings.length; i += BATCH_SIZE) {
    const batch = rawRatings.slice(i, i + BATCH_SIZE);

    const resolved = await Promise.all(
      batch.map(async (r) => {
        let filmSlug = "";

        if (r.uri) {
          // Try direct slug extraction first (full Letterboxd URLs)
          const directMatch = r.uri.match(/\/film\/([\w-]+)\/?/);
          if (directMatch) {
            filmSlug = directMatch[1];
          } else if (r.uri.includes("boxd.it")) {
            // Resolve short URL via HEAD redirect
            filmSlug = await resolveBoxdIt(r.uri);
          }
        }

        if (!filmSlug) {
          filmSlug = slugFromTitle(r.filmTitle, r.filmYear);
        }

        return { ...r, filmSlug };
      })
    );

    for (const r of resolved) {
      if (seenSlugs.has(r.filmSlug)) continue;
      seenSlugs.add(r.filmSlug);

      results.push({
        filmTitle: r.filmTitle,
        filmYear: r.filmYear,
        filmSlug: r.filmSlug,
        rating: r.rating,
      });
    }
  }

  return results;
}

async function resolveBoxdIt(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location");
    if (location) {
      const match = location.match(/\/film\/([\w-]+)\/?/);
      if (match) return match[1];
    }
  } catch {}
  return "";
}

function slugFromTitle(title: string, year: string | null): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 80);
  if (year) slug += `-${year}`;
  return slug;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
