import * as cheerio from "cheerio";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number): Promise<void> {
  const jitter = Math.random() * 300;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

async function fetchPage(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": randomUA(),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;
  return res.text();
}

export interface ScrapedRating {
  filmTitle: string;
  filmYear: string | null;
  filmSlug: string;
  rating: number;
}

export interface ScrapedFilm {
  filmTitle: string;
  filmYear: string | null;
  filmSlug: string;
}

/**
 * Validates a Letterboxd username by fetching their profile page.
 * Profile pages bypass Cloudflare challenges.
 */
export async function validateUsername(username: string): Promise<boolean> {
  const html = await fetchPage(`https://letterboxd.com/${username}/`);
  return html !== null && !html.includes("Error 404");
}

/**
 * Scrapes ALL rated films via the paginated RSS feed.
 * RSS bypasses Cloudflare and returns structured XML with ratings.
 */
export async function scrapeUserRatings(
  username: string,
  onProgress?: (scraped: number, page: number) => void
): Promise<ScrapedRating[]> {
  const allRatings: ScrapedRating[] = [];
  const seenSlugs = new Set<string>();
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/rss/?page=${page}`;
    const xml = await fetchPage(url);
    if (!xml) break;

    const $ = cheerio.load(xml, { xmlMode: true });
    const items = $("item");
    if (items.length === 0) break;

    items.each((_, el) => {
      const $el = $(el);
      const ratingText = $el.find("letterboxd\\:memberRating").text();
      if (!ratingText) return;

      const rating = parseFloat(ratingText);
      if (isNaN(rating) || rating < 0.5 || rating > 5.0) return;

      const link = $el.find("link").text();
      const slugMatch = link.match(/\/film\/([\w-]+)\/?/);
      if (!slugMatch) return;
      const filmSlug = slugMatch[1];

      if (seenSlugs.has(filmSlug)) return;
      seenSlugs.add(filmSlug);

      const filmTitle =
        $el.find("letterboxd\\:filmTitle").text() ||
        $el.find("title").text().replace(/,\s*\d{4}\s*-\s*★.*$/, "").trim();
      const filmYear = $el.find("letterboxd\\:filmYear").text() || null;

      allRatings.push({ filmTitle, filmYear, filmSlug, rating });
    });

    onProgress?.(allRatings.length, page);

    if (items.length < 100) break;
    page++;
    await sleep(800);
  }

  return allRatings;
}

/**
 * Scrapes all watched films (including unrated) from the RSS feed.
 */
export async function scrapeUserWatchedSlugs(
  username: string
): Promise<Set<string>> {
  const slugs = new Set<string>();
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/rss/?page=${page}`;
    const xml = await fetchPage(url);
    if (!xml) break;

    const $ = cheerio.load(xml, { xmlMode: true });
    const items = $("item");
    if (items.length === 0) break;

    items.each((_, el) => {
      const link = $(el).find("link").text();
      const slugMatch = link.match(/\/film\/([\w-]+)\/?/);
      if (slugMatch) slugs.add(slugMatch[1]);
    });

    if (items.length < 100) break;
    page++;
    await sleep(800);
  }

  return slugs;
}

/**
 * Gets profile stats from the profile page (bypasses Cloudflare).
 */
export async function scrapeProfileStats(
  username: string
): Promise<{ displayName: string | null; totalFilms: number }> {
  const html = await fetchPage(`https://letterboxd.com/${username}/`);
  if (!html) return { displayName: null, totalFilms: 0 };

  const $ = cheerio.load(html);
  const displayName = $(".displayname").first().text().trim() || null;
  const statsText = $(".profile-stats a[href*='/films/'] .value").first().text();
  const totalFilms = parseInt(statsText.replace(/[,.\s]/g, ""), 10) || 0;

  return { displayName, totalFilms };
}

/**
 * Quick check: how many rated films does a user have? Uses page 1 of RSS.
 */
export async function quickRatingCount(
  username: string
): Promise<number> {
  const xml = await fetchPage(`https://letterboxd.com/${username}/rss/`);
  if (!xml) return 0;

  const $ = cheerio.load(xml, { xmlMode: true });
  return $("letterboxd\\:memberRating").length;
}

// ─── Discovery: finding new Letterboxd usernames at scale ───

const IGNORED_SLUGS = new Set([
  "film", "films", "list", "lists", "members", "activity", "about", "pro",
  "help", "privacy", "terms", "search", "settings", "welcome", "apps", "crew",
  "contact", "developer", "patron", "legal", "journal", "tag", "styleguide",
  "reviews", "csi", "login", "register", "hq", "mubi", "letterboxd",
]);

/**
 * Scrapes /members/ page for featured + popular usernames.
 * This page bypasses Cloudflare and rotates content.
 */
export async function discoverFromMembersPage(): Promise<string[]> {
  const html = await fetchPage("https://letterboxd.com/members/");
  if (!html) return [];

  const $ = cheerio.load(html);
  const usernames = new Set<string>();

  // data-owner attributes contain reviewer usernames
  $("[data-owner]").each((_, el) => {
    const owner = $(el).attr("data-owner");
    if (owner) usernames.add(owner.toLowerCase());
  });

  // Profile links with name class
  $("a.name").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const match = href.match(/^\/([\w]+)\/?$/);
      if (match && !IGNORED_SLUGS.has(match[1].toLowerCase())) {
        usernames.add(match[1].toLowerCase());
      }
    }
  });

  return [...usernames];
}

/**
 * Scrapes a film's detail page for reviewer usernames.
 * Film pages bypass Cloudflare and show ~10 popular reviewers.
 */
export async function discoverFromFilmPage(filmSlug: string): Promise<string[]> {
  const html = await fetchPage(`https://letterboxd.com/film/${filmSlug}/`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const usernames = new Set<string>();

  $("[data-owner]").each((_, el) => {
    const owner = $(el).attr("data-owner");
    if (owner) usernames.add(owner.toLowerCase());
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/^\/([\w]+)\/?$/);
    if (match && !IGNORED_SLUGS.has(match[1].toLowerCase()) && match[1].length > 2) {
      const cls = $(el).attr("class") ?? "";
      if (cls.includes("name") || cls.includes("avatar") || $(el).closest(".film-detail-content, .review, .activity-row").length) {
        usernames.add(match[1].toLowerCase());
      }
    }
  });

  return [...usernames];
}

/**
 * Quick-scrapes a user's RSS feed until we have enough rated films.
 * The RSS feed returns ~100 diary entries per page, but only ~30% have
 * ratings. We keep paginating until we reach minRatings rated films or
 * exhaust available pages (capped at maxPages to avoid scraping forever).
 */
export async function quickScrapeUserRatings(
  username: string,
  minRatings: number = 150,
  maxPages: number = 15
): Promise<ScrapedRating[]> {
  const allRatings: ScrapedRating[] = [];
  const seenSlugs = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://letterboxd.com/${username}/rss/?page=${page}`;
    const xml = await fetchPage(url);
    if (!xml) break;

    const $ = cheerio.load(xml, { xmlMode: true });
    const items = $("item");
    if (items.length === 0) break;

    items.each((_, el) => {
      const $el = $(el);
      const ratingText = $el.find("letterboxd\\:memberRating").text();
      if (!ratingText) return;

      const rating = parseFloat(ratingText);
      if (isNaN(rating) || rating < 0.5 || rating > 5.0) return;

      const link = $el.find("link").text();
      const slugMatch = link.match(/\/film\/([\w-]+)\/?/);
      if (!slugMatch) return;
      const filmSlug = slugMatch[1];

      if (seenSlugs.has(filmSlug)) return;
      seenSlugs.add(filmSlug);

      const filmTitle =
        $el.find("letterboxd\\:filmTitle").text() ||
        $el.find("title").text().replace(/,\s*\d{4}\s*-\s*★.*$/, "").trim();
      const filmYear = $el.find("letterboxd\\:filmYear").text() || null;

      allRatings.push({ filmTitle, filmYear, filmSlug, rating });
    });

    if (items.length < 100) break;
    if (allRatings.length >= minRatings) break;
    await sleep(800);
  }

  return allRatings;
}

export interface RssPageResult {
  ratings: ScrapedRating[];
  totalItems: number;
  hasMore: boolean;
}

/**
 * Scrapes a single RSS page. Returns ratings found and whether more pages exist.
 * Designed for incremental client-driven polling.
 */
export async function scrapeRssPage(
  username: string,
  page: number
): Promise<RssPageResult> {
  const url = `https://letterboxd.com/${username}/rss/?page=${page}`;
  const xml = await fetchPage(url);
  if (!xml) return { ratings: [], totalItems: 0, hasMore: false };

  const $ = cheerio.load(xml, { xmlMode: true });
  const items = $("item");
  const pageRatings: ScrapedRating[] = [];

  items.each((_, el) => {
    const $el = $(el);
    const ratingText = $el.find("letterboxd\\:memberRating").text();
    if (!ratingText) return;

    const rating = parseFloat(ratingText);
    if (isNaN(rating) || rating < 0.5 || rating > 5.0) return;

    const link = $el.find("link").text();
    const slugMatch = link.match(/\/film\/([\w-]+)\/?/);
    if (!slugMatch) return;

    const filmTitle =
      $el.find("letterboxd\\:filmTitle").text() ||
      $el.find("title").text().replace(/,\s*\d{4}\s*-\s*★.*$/, "").trim();
    const filmYear = $el.find("letterboxd\\:filmYear").text() || null;

    pageRatings.push({
      filmTitle,
      filmYear,
      filmSlug: slugMatch[1],
      rating,
    });
  });

  return {
    ratings: pageRatings,
    totalItems: items.length,
    hasMore: items.length >= 100,
  };
}
