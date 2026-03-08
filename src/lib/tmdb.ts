const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

function getApiKey(): string | null {
  return process.env.TMDB_API_KEY ?? null;
}

export interface TmdbFilmInfo {
  tmdbId: number;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  director: string | null;
  providers: WatchProvider[];
}

export interface WatchProvider {
  name: string;
  logoUrl: string;
  type: "stream" | "rent" | "buy" | "theater";
}

/**
 * Search TMDB by title + year, return film info including poster and streaming.
 * Returns null if no API key is configured or no match found.
 */
export async function lookupFilm(
  title: string,
  year: string | null
): Promise<TmdbFilmInfo | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      query: title,
      include_adult: "false",
    });
    if (year) params.set("year", year);

    const searchRes = await fetch(
      `${TMDB_BASE}/search/movie?${params}`,
      { next: { revalidate: 86400 } }
    );
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const movie = searchData.results?.[0];
    if (!movie) return null;

    const tmdbId = movie.id;

    // Fetch details + credits + watch providers in parallel
    const [detailsRes, creditsRes, providersRes] = await Promise.all([
      fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${apiKey}`, {
        next: { revalidate: 86400 },
      }),
      fetch(`${TMDB_BASE}/movie/${tmdbId}/credits?api_key=${apiKey}`, {
        next: { revalidate: 86400 },
      }),
      fetch(
        `${TMDB_BASE}/movie/${tmdbId}/watch/providers?api_key=${apiKey}`,
        { next: { revalidate: 86400 } }
      ),
    ]);

    const details = detailsRes.ok ? await detailsRes.json() : null;
    const credits = creditsRes.ok ? await creditsRes.json() : null;
    const providersData = providersRes.ok
      ? await providersRes.json()
      : null;

    const director =
      credits?.crew?.find(
        (c: { job: string; name: string }) => c.job === "Director"
      )?.name ?? null;

    const usProviders = providersData?.results?.US;
    const providers: WatchProvider[] = [];

    if (usProviders?.flatrate) {
      for (const p of usProviders.flatrate) {
        providers.push({
          name: p.provider_name,
          logoUrl: `${TMDB_IMG}/w45${p.logo_path}`,
          type: "stream",
        });
      }
    }
    if (usProviders?.rent) {
      for (const p of usProviders.rent.slice(0, 3)) {
        providers.push({
          name: p.provider_name,
          logoUrl: `${TMDB_IMG}/w45${p.logo_path}`,
          type: "rent",
        });
      }
    }
    if (usProviders?.buy) {
      for (const p of usProviders.buy.slice(0, 2)) {
        if (!providers.some((x) => x.name === p.provider_name)) {
          providers.push({
            name: p.provider_name,
            logoUrl: `${TMDB_IMG}/w45${p.logo_path}`,
            type: "buy",
          });
        }
      }
    }

    return {
      tmdbId,
      posterUrl: movie.poster_path
        ? `${TMDB_IMG}/w300${movie.poster_path}`
        : null,
      backdropUrl: movie.backdrop_path
        ? `${TMDB_IMG}/w780${movie.backdrop_path}`
        : null,
      overview: details?.overview ?? null,
      genres: details?.genres?.map((g: { name: string }) => g.name) ?? [],
      runtime: details?.runtime ?? null,
      director,
      providers,
    };
  } catch (e) {
    console.error("TMDB lookup failed:", e);
    return null;
  }
}

/**
 * Batch lookup: given a list of films, look up metadata for all.
 * Uses parallel requests with a concurrency limit.
 */
export async function batchLookup(
  films: { filmTitle: string; filmYear: string | null; filmSlug: string }[]
): Promise<Map<string, TmdbFilmInfo>> {
  const results = new Map<string, TmdbFilmInfo>();
  const apiKey = getApiKey();
  if (!apiKey) return results;

  const CONCURRENCY = 5;
  for (let i = 0; i < films.length; i += CONCURRENCY) {
    const batch = films.slice(i, i + CONCURRENCY);
    const lookups = batch.map(async (film) => {
      const info = await lookupFilm(film.filmTitle, film.filmYear);
      if (info) results.set(film.filmSlug, info);
    });
    await Promise.all(lookups);
  }

  return results;
}
