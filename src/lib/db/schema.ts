import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  bigserial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    letterboxdUsername: text("letterboxd_username").notNull(),
    profileType: text("profile_type").notNull().default("user"),
    displayName: text("display_name"),
    totalFilms: integer("total_films"),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("profiles_username_idx").on(table.letterboxdUsername)]
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  letterboxdUsername: text("letterboxd_username").unique(),
  profileId: uuid("profile_id").references(() => profiles.id),
  displayName: text("display_name"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  totalRated: integer("total_rated"),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }),
  tasteIndexComputedAt: timestamp("taste_index_computed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const ratings = pgTable(
  "ratings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    filmTitle: text("film_title").notNull(),
    filmYear: text("film_year"),
    filmSlug: text("film_slug"),
    rating: numeric("rating", { precision: 2, scale: 1 }).notNull(),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("ratings_profile_film_idx").on(
      table.profileId,
      table.filmSlug
    ),
  ]
);

export const tasteMatches = pgTable(
  "taste_matches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userProfileId: uuid("user_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchProfileId: uuid("match_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 5, scale: 2 }),
    overlapCount: integer("overlap_count"),
    sharedLoves: integer("shared_loves"),
    sharedHates: integer("shared_hates"),
    strongDisagrees: integer("strong_disagrees"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("taste_matches_pair_idx").on(
      table.userProfileId,
      table.matchProfileId
    ),
  ]
);

export const recommendations = pgTable("recommendations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  filmTitle: text("film_title").notNull(),
  filmYear: text("film_year"),
  filmSlug: text("film_slug"),
  predictedScore: numeric("predicted_score", { precision: 3, scale: 2 }),
  sourceProfileIds: text("source_profile_ids"),
  confidence: text("confidence"),
  tags: text("tags"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userFilmActions = pgTable(
  "user_film_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filmSlug: text("film_slug").notNull(),
    filmTitle: text("film_title"),
    action: text("action").notNull(),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    actedAt: timestamp("acted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("user_film_actions_idx").on(table.userId, table.filmSlug),
  ]
);
