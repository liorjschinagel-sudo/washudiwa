# Washudiwa — Product Spec & Cursor Prompt

## What It Is

Washudiwa is a web app that finds your movie taste doppelgängers across the Letterboxd universe and recommends films they love that you haven't seen. The core insight: people who both love AND hate the same movies as you are dramatically better recommendation sources than generic popularity or genre matching.

---

## Architecture

### Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API routes (or separate FastAPI if you prefer Python for scraping)
- **Database**: Supabase (Postgres + Auth + Realtime)
- **Scraping**: Python (BeautifulSoup + aiohttp/httpx) — runs server-side
- **Recommendation Engine**: Custom collaborative filtering in Python
- **Deployment**: Vercel (frontend) + Railway or Fly.io (Python scraper worker)

### Why This Stack

Letterboxd has no public API. Every working tool in this space (Sam Learner's letterboxd.samlearner.com, jjoej15's letterboxd-recs) uses server-side Python scraping with BeautifulSoup. The scraper must run server-side — Letterboxd returns 403 to browser requests. Supabase gives you auth, Postgres, and row-level security out of the box.

---

## Data Model

### Tables

```sql
-- Users of Washudiwa
users (
  id uuid PK (from Supabase auth),
  letterboxd_username text UNIQUE NOT NULL,
  display_name text,
  created_at timestamptz,
  last_synced_at timestamptz,
  total_rated int,
  avg_rating numeric(3,2)
)

-- Every rating we've scraped (for Washudiwa users AND reference profiles)
ratings (
  id bigserial PK,
  profile_id uuid FK -> profiles(id),
  film_title text NOT NULL,
  film_year text,
  film_slug text,              -- letterboxd URL slug e.g. "the-godfather"
  rating numeric(2,1) NOT NULL, -- 0.5 to 5.0
  scraped_at timestamptz,
  UNIQUE(profile_id, film_slug)
)

-- Letterboxd profiles we've scraped (users + reference/comparison profiles)
profiles (
  id uuid PK DEFAULT gen_random_uuid(),
  letterboxd_username text UNIQUE NOT NULL,
  profile_type text NOT NULL,  -- 'user' | 'reference' | 'critic' | 'custom'
  display_name text,
  total_films int,
  last_scraped_at timestamptz
)

-- Precomputed taste-twin scores between users and reference profiles
taste_matches (
  id bigserial PK,
  user_profile_id uuid FK -> profiles(id),
  match_profile_id uuid FK -> profiles(id),
  score numeric(5,2),          -- taste twin score (higher = better match)
  overlap_count int,           -- films both have rated
  shared_loves int,            -- both rated 4+
  shared_hates int,            -- both rated 2 or below
  strong_disagrees int,        -- one loves, other hates
  computed_at timestamptz,
  UNIQUE(user_profile_id, match_profile_id)
)

-- Generated recommendations
recommendations (
  id bigserial PK,
  user_id uuid FK -> users(id),
  film_title text NOT NULL,
  film_year text,
  film_slug text,
  predicted_score numeric(3,2),
  source_profile_ids uuid[],   -- which taste twins generated this rec
  confidence text,             -- 'high' | 'medium' | 'speculative'
  tags text[],
  reason text,                 -- why this was recommended
  created_at timestamptz
)

-- User actions on recommendations
user_film_actions (
  id bigserial PK,
  user_id uuid FK -> users(id),
  film_slug text NOT NULL,
  film_title text,
  action text NOT NULL,        -- 'seen' | 'dismissed' | 'watchlisted'
  rating numeric(2,1),         -- if they rate it after watching
  acted_at timestamptz,
  UNIQUE(user_id, film_slug)
)
```

---

## Core Features

### 1. Onboarding — Link Letterboxd

User flow:
1. Sign up (email/Google via Supabase Auth)
2. Enter Letterboxd username
3. Backend validates username exists by fetching `letterboxd.com/{username}/films/`
4. Triggers async scrape job to pull all their ratings
5. Shows progress: "Syncing 247 rated films..." with a progress bar
6. When complete, shows their taste profile (loves, hates, distribution chart)

### 2. Scraper — Real-Time Letterboxd Data

The scraper is the backbone. It needs to:

**Scrape a user's rated films:**
- Hit `letterboxd.com/{username}/films/ratings/page/{n}/` for each page
- Parse the HTML: each film is an `li` inside `ul.poster-list`
  - Film title: `img[alt]`
  - Film slug: `div.film-poster[data-target-link]` (e.g. `/film/the-godfather/`)
  - Rating: `span.rating` class contains rating as class like `rated-8` (divide by 2 for stars)
  - Film ID: `div.film-poster[data-film-id]`
- Paginate until no more pages (check for `li.paginate-page` elements)
- Use async HTTP (aiohttp or httpx) with rate limiting (be respectful — 1-2 req/sec)
- Set a realistic User-Agent header

**Reference pool scraping:**
- Pre-scrape a pool of 500-2000 active Letterboxd users with 100+ ratings
- Source candidates from: Letterboxd's "popular this week" members, HQ reviewers, prolific raters
- Store their full ratings in the same `ratings` table
- Re-scrape monthly to stay current

**On-demand profile scraping:**
- Users can add any public Letterboxd username as a comparison source
- Scrape on demand, cache results for 7 days

### 3. Recommendation Engine — The Math

This is where Washudiwa differentiates. The algorithm:

```python
def compute_taste_twin_score(user_ratings: dict, other_ratings: dict) -> TasteMatch:
    """
    user_ratings: {film_slug: rating} for the Washudiwa user
    other_ratings: {film_slug: rating} for a comparison profile
    
    Returns taste match score with overweighting for shared extremes.
    """
    overlap_films = set(user_ratings.keys()) & set(other_ratings.keys())
    
    if len(overlap_films) < 5:  # minimum overlap threshold
        return None
    
    total_score = 0
    shared_loves = 0
    shared_hates = 0
    strong_disagrees = 0
    
    for film in overlap_films:
        my_r = user_ratings[film]
        their_r = other_ratings[film]
        diff = abs(my_r - their_r)
        
        my_love = my_r >= 4.0
        my_hate = my_r <= 2.0
        their_love = their_r >= 4.0
        their_hate = their_r <= 2.0
        
        if my_love and their_love:
            # Both love it — strongest positive signal
            # Weight: 3.0 base, reduced slightly by rating gap
            total_score += 3.0 - (diff * 0.5)
            shared_loves += 1
            
        elif my_hate and their_hate:
            # Both hate it — equally strong positive signal
            total_score += 3.0 - (diff * 0.5)
            shared_hates += 1
            
        elif (my_love and their_hate) or (my_hate and their_love):
            # Fundamental disagreement — strong negative signal
            total_score -= 3.0
            strong_disagrees += 1
            
        else:
            # Neutral zone — mild signal based on proximity
            total_score += 1.0 - (diff * 0.3)
    
    # Normalize by overlap count, but bonus for larger overlap
    overlap_bonus = min(len(overlap_films) / 50, 1.0)  # caps at 50 films
    normalized = (total_score / len(overlap_films)) * (0.7 + 0.3 * overlap_bonus)
    
    return TasteMatch(
        score=normalized,
        overlap=len(overlap_films),
        shared_loves=shared_loves,
        shared_hates=shared_hates,
        strong_disagrees=strong_disagrees,
    )
```

**Generating recommendations from taste twins:**

```python
def generate_recommendations(user_slug, top_n=30):
    """
    1. Get user's ratings
    2. Score all reference profiles against user
    3. Take top 20 taste twins
    4. Collect films taste twins rated 4+ that user hasn't seen
    5. Weight by: (taste_twin_score * their_rating) summed across twins
    6. Penalize films that appear in too many people's top lists (popularity penalty)
    7. Filter out films user has marked 'seen' or 'dismissed'
    8. Return top N ranked recommendations
    """
    user_ratings = get_user_ratings(user_slug)
    user_seen = get_user_seen_films(user_slug)  # includes rated + manually marked
    
    # Score all reference profiles
    matches = []
    for profile in get_reference_profiles():
        other_ratings = get_profile_ratings(profile.id)
        match = compute_taste_twin_score(user_ratings, other_ratings)
        if match and match.score > 0:
            matches.append((profile, match))
    
    # Take top taste twins
    matches.sort(key=lambda x: x[1].score, reverse=True)
    top_twins = matches[:20]
    
    # Collect candidate films
    film_scores = defaultdict(lambda: {"score": 0, "sources": [], "ratings": []})
    
    for profile, match in top_twins:
        their_ratings = get_profile_ratings(profile.id)
        for film_slug, rating in their_ratings.items():
            if film_slug in user_seen:
                continue
            if rating < 4.0:  # only recommend films they loved
                continue
            
            weight = match.score * (rating / 5.0)
            film_scores[film_slug]["score"] += weight
            film_scores[film_slug]["sources"].append(profile.id)
            film_scores[film_slug]["ratings"].append(rating)
    
    # Popularity penalty: films recommended by 15+ twins are too obvious
    for film_slug, data in film_scores.items():
        source_count = len(data["sources"])
        if source_count > 10:
            data["score"] *= 0.7  # dampen universally popular films
    
    # Rank and return
    ranked = sorted(film_scores.items(), key=lambda x: x[1]["score"], reverse=True)
    return ranked[:top_n]
```

### 4. UI — The Experience

**Dashboard (post-onboarding):**
- Top section: taste profile summary (your top loves, dislikes, stats)
- Main section: recommendation feed — cards for each recommended film
  - Film title, year, director
  - Why it's recommended (tied to specific taste patterns)
  - Confidence badge (high/medium/speculative)
  - Which taste twins surfaced it
  - Action buttons: "Seen it" ✓ | "Add to watchlist" | "Not interested" ✕
- Sidebar: your top taste twins (with overlap stats)

**Film card interactions:**
- Click "Seen it" → card moves to "Seen" section, optionally rate it
- Rating a seen film feeds back into the algorithm for next refresh
- "Not interested" → dismissed, won't show again
- Click film title → opens Letterboxd page in new tab

**Refresh recommendations:**
- Button to re-sync Letterboxd data and regenerate recs
- Auto-refresh weekly

### 5. Search & Compare — The Web Layer

Users can search for and add any public source:
- Other Letterboxd usernames → scraped on demand
- Curated critic profiles (pre-loaded: popular Letterboxd critics)
- Shows taste match score with the user
- Their highly-rated unseen films get weighted into recommendations

---

## File Structure

```
washudiwa/
├── app/                          # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                  # Landing page
│   ├── dashboard/
│   │   └── page.tsx              # Main recommendation dashboard
│   ├── onboarding/
│   │   └── page.tsx              # Link Letterboxd flow
│   ├── profile/
│   │   └── page.tsx              # Your taste profile detail
│   ├── api/
│   │   ├── scrape/
│   │   │   └── route.ts          # Trigger scrape for a username
│   │   ├── recommendations/
│   │   │   └── route.ts          # Get/refresh recommendations
│   │   ├── actions/
│   │   │   └── route.ts          # Mark seen/dismissed/watchlisted
│   │   └── search/
│   │       └── route.ts          # Search/add comparison profiles
│   └── auth/
│       └── callback/route.ts     # Supabase auth callback
├── components/
│   ├── film-card.tsx             # Recommendation card component
│   ├── taste-profile.tsx         # Taste DNA visualization
│   ├── twin-card.tsx             # Taste twin summary card
│   ├── rating-distribution.tsx   # Star distribution chart
│   ├── sync-progress.tsx         # Scraping progress indicator
│   └── ui/                       # shadcn components
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── scraper/
│   │   ├── letterboxd.ts         # Letterboxd HTML scraper (server-side)
│   │   ├── parser.ts             # HTML → structured data
│   │   └── queue.ts              # Scrape job queue management
│   ├── engine/
│   │   ├── taste-score.ts        # Taste twin scoring algorithm
│   │   ├── recommend.ts          # Recommendation generation
│   │   └── profile-builder.ts    # Build taste profile from ratings
│   └── utils.ts
├── supabase/
│   └── migrations/               # Database schema migrations
├── scripts/
│   ├── seed-reference-pool.py    # Pre-scrape reference user pool
│   └── refresh-profiles.py       # Cron job to re-scrape stale profiles
└── public/
```

---

## Non-Obvious Implementation Notes

1. **Scraping rate limiting**: Letterboxd will block aggressive scraping. Use 1-2 requests/sec with random delays. Rotate User-Agent strings. Consider a residential proxy if you scale beyond a few hundred users.

2. **Film matching**: Letterboxd film slugs are the most reliable unique key (e.g. `the-godfather`). Title+year matching is fragile (remakes, special characters, international titles).

3. **Cold start**: New users with <20 ratings won't get great recs. Show them a "rate more films" nudge. Below 5 overlap films with any twin, skip that twin entirely.

4. **Stale data**: Cache scraped profiles for 7 days. User's own profile re-syncs on demand or weekly. Reference pool refreshes monthly via cron.

5. **The watched list is critical**: Must include BOTH rated films AND films marked as watched-but-not-rated on Letterboxd. Scrape `/{username}/films/` (all watched) separately from `/{username}/films/ratings/` (only rated).

6. **Popularity penalty tuning**: The 0.7 multiplier for popular films is a starting point. You may want to make this configurable or use a logarithmic decay based on how many twins recommend it.

---

## Cursor Initial Prompt

Paste this into Cursor to bootstrap the project:

---

```
I'm building Washudiwa, a web app that finds your movie taste doppelgängers across Letterboxd and recommends films they love that you haven't seen.

## Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui 
- Supabase (Postgres + Auth)
- Server-side scraping of Letterboxd (no public API exists)

## What to build first (Phase 1 — MVP)

### 1. Project setup
- Initialize Next.js 14 with App Router, TypeScript, Tailwind, shadcn/ui
- Set up Supabase project with auth (email + Google)
- Create database schema with these tables:
  - `profiles` (letterboxd_username, profile_type ['user'|'reference'|'critic'], display_name, total_films, last_scraped_at)
  - `ratings` (profile_id FK, film_title, film_year, film_slug, rating 0.5-5.0, scraped_at) with unique constraint on (profile_id, film_slug)
  - `users` (id from supabase auth, letterboxd_username, display_name, last_synced_at)
  - `taste_matches` (user_profile_id, match_profile_id, score, overlap_count, shared_loves, shared_hates, strong_disagrees)
  - `recommendations` (user_id, film_title, film_year, film_slug, predicted_score, source_profile_ids uuid[], confidence, tags, reason)
  - `user_film_actions` (user_id, film_slug, film_title, action ['seen'|'dismissed'|'watchlisted'], rating nullable)

### 2. Letterboxd scraper (server-side only — API route)
Build a scraper in `lib/scraper/letterboxd.ts` that:
- Fetches `letterboxd.com/{username}/films/ratings/page/{n}/` 
- Parses HTML to extract: film title (from img alt), film slug (from data-target-link), rating (from span.rating class like "rated-8" → 4.0 stars), film year
- Paginates through all pages (check for paginate-page elements)
- Rate limited: 1 request per second with random jitter
- Returns array of {film_title, film_year, film_slug, rating}
- Also scrapes `/{username}/films/` for the full watched list (films without ratings)
- Create API route POST /api/scrape that takes a username, scrapes their profile, and upserts into profiles + ratings tables

### 3. Onboarding flow
- `/onboarding` page: after auth, user enters their Letterboxd username
- Validates username exists (quick fetch of their profile page, check for 404)
- Triggers scrape, shows progress ("Syncing 142 of ~300 films...")
- When complete, redirects to dashboard

### 4. Taste twin scoring engine
Build in `lib/engine/taste-score.ts`:
- Takes two sets of ratings (user vs comparison profile)
- Computes taste twin score with THIS specific weighting (this is the core differentiator):
  - Both rate a film 4+ stars: +3.0 minus (rating_diff × 0.5) — SHARED LOVE
  - Both rate a film 2 or below: +3.0 minus (rating_diff × 0.5) — SHARED HATE  
  - One rates 4+, other rates 2 or below: -3.0 — FUNDAMENTAL DISAGREEMENT
  - Everything else: +1.0 minus (rating_diff × 0.3) — NEUTRAL ZONE
- Normalize by overlap count with bonus for larger overlap (caps at 50 films)
- Minimum 5 overlapping films or skip
- Returns: score, overlap_count, shared_loves, shared_hates, strong_disagrees

### 5. Recommendation generator  
Build in `lib/engine/recommend.ts`:
- For a given user, score them against all reference profiles in DB
- Take top 20 taste twins
- Collect all films those twins rated 4+ that user hasn't seen/rated
- Score each candidate: sum of (twin_score × their_rating/5.0) across all twins who rated it
- Apply popularity penalty: if 10+ twins recommend same film, multiply score by 0.7
- Filter out user_film_actions (seen/dismissed)
- Return top 30 ranked recommendations with metadata (which twins, confidence level, tags)

### 6. Dashboard UI
`/dashboard` page — the main experience:
- Header: user's taste profile summary (total rated, avg rating, top 3 loves, top 3 hates)
- Main feed: recommendation cards, each showing:
  - Film title, year, director (if available)
  - Why recommended (generated reason connecting to user's taste)
  - Confidence badge: HIGH MATCH / LIKELY / WILD CARD
  - Number of taste twins who surfaced this
  - Action row: "✓ Seen it" | "📋 Watchlist" | "✕ Not for me"
- "Seen it" opens optional star rating (0.5-5) before confirming
- Actions persist to user_film_actions table, card animates out
- "Refresh Recs" button re-syncs Letterboxd and regenerates

### 7. Search & add comparison profiles
- Search bar on dashboard to add any Letterboxd username
- Scrapes their profile on demand
- Shows their taste match score with you
- Their ratings get folded into your recommendation pool

## Design direction
Dark theme. Minimal, editorial feel — think Letterboxd meets Linear. Monospace accents for data/stats, clean sans-serif for body. Green (#4ADE80) as primary accent. Cards should feel tactile — subtle borders, hover states, smooth transitions. No generic AI aesthetic. The vibe is: a tool built by a cinephile for cinephiles.

## Important constraints
- Letterboxd has NO public API. All data comes from scraping public HTML pages server-side.
- Letterboxd blocks browser-side requests (CORS + 403). Scraping MUST happen in API routes / server actions.
- Be respectful with scraping: 1 req/sec max, cache aggressively (7 day TTL for non-user profiles).
- Film slug from Letterboxd URL is the primary unique identifier for films. Do NOT rely on title+year matching.
- The taste twin algorithm weighting described above is the core IP — implement it exactly as specified.

Start with project setup, database schema, and the scraper. Get the onboarding flow working end-to-end first (user signs up → enters username → sees their scraped taste profile). Then build the engine and dashboard.
```
