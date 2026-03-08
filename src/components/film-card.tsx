"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WatchProvider {
  name: string;
  logoUrl: string;
  type: "stream" | "rent" | "buy" | "theater";
}

interface FilmMeta {
  posterUrl: string | null;
  overview: string | null;
  director: string | null;
  runtime: number | null;
  genres: string[];
  providers: WatchProvider[];
}

interface FilmCardProps {
  filmTitle: string;
  filmYear: string | null;
  filmSlug: string | null;
  predictedScore: string | null;
  confidence: string | null;
  reason: string | null;
  onAction: (action: string, rating?: number) => void;
  onMetaLoaded?: (filmSlug: string, providers: string[]) => void;
  hidden?: boolean;
}

const STAR_VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function FilmCard({
  filmTitle,
  filmYear,
  filmSlug,
  confidence,
  reason,
  onAction,
  onMetaLoaded,
  hidden,
}: FilmCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState<FilmMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!meta && !metaLoading) {
      setMetaLoading(true);
      const params = new URLSearchParams({ title: filmTitle });
      if (filmYear) params.set("year", filmYear);

      fetch(`/api/film?${params}`)
        .then((r) => r.json())
        .then((data) => {
          setMeta(data.info);
          if (data.info?.providers && filmSlug) {
            const streamNames = data.info.providers
              .filter((p: WatchProvider) => p.type === "stream")
              .map((p: WatchProvider) => p.name);
            onMetaLoaded?.(filmSlug, streamNames);
          }
        })
        .catch(() => {})
        .finally(() => setMetaLoading(false));
    }
  }, [filmTitle, filmYear]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null;

  function handleAction(action: string, rating?: number) {
    setExiting(true);
    setTimeout(() => onAction(action, rating), 300);
  }

  const confidenceColor =
    confidence === "HIGH MATCH"
      ? "text-primary"
      : confidence === "LIKELY"
        ? "text-muted-foreground"
        : "text-muted-foreground/60";

  return (
    <div
      className={`group transition-all duration-300 ${
        exiting ? "opacity-0 scale-95" : ""
      }`}
    >
      {/* Collapsed: compact poster row */}
      <div
        onClick={() => setExpanded(!expanded)}
        className={`
          flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer
          transition-colors border border-transparent
          hover:bg-secondary/40 hover:border-border/50
          ${expanded ? "bg-secondary/30 border-border/50" : ""}
        `}
      >
        {/* Poster thumbnail */}
        {meta?.posterUrl ? (
          <img
            src={meta.posterUrl}
            alt={filmTitle}
            className="w-10 h-14 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-14 rounded bg-secondary/50 shrink-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground/40">🎬</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm truncate">{filmTitle}</h3>
            {filmYear && (
              <span className="text-xs text-muted-foreground font-mono shrink-0">
                {filmYear}
              </span>
            )}
          </div>
          {reason && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {reason}
            </p>
          )}
        </div>

        {confidence && (
          <span className={`text-[10px] font-mono tracking-wider shrink-0 ${confidenceColor}`}>
            {confidence}
          </span>
        )}
      </div>

      {/* Expanded: full details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-4">
            {/* Larger poster */}
            {meta?.posterUrl && (
              <img
                src={meta.posterUrl}
                alt={filmTitle}
                className="w-24 h-36 rounded-md object-cover shrink-0"
              />
            )}

            <div className="flex-1 space-y-2 min-w-0">
              {meta?.director && (
                <p className="text-xs text-muted-foreground">
                  Directed by{" "}
                  <span className="text-foreground">{meta.director}</span>
                </p>
              )}

              {meta?.runtime && (
                <p className="text-xs text-muted-foreground font-mono">
                  {Math.floor(meta.runtime / 60)}h {meta.runtime % 60}m
                </p>
              )}

              {meta?.genres && meta.genres.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {meta.genres.slice(0, 3).map((g) => (
                    <Badge
                      key={g}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {g}
                    </Badge>
                  ))}
                </div>
              )}

              {meta?.overview && (
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {meta.overview}
                </p>
              )}

              {metaLoading && (
                <p className="text-xs text-muted-foreground animate-pulse">
                  Loading details...
                </p>
              )}
            </div>
          </div>

          {/* Streaming providers */}
          {meta?.providers && meta.providers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono text-muted-foreground tracking-wider">
                WHERE TO WATCH
              </p>
              <div className="flex flex-wrap gap-2">
                {meta.providers.map((p) => (
                  <div
                    key={`${p.name}-${p.type}`}
                    className="flex items-center gap-1.5 bg-secondary/50 rounded-md px-2 py-1"
                  >
                    <img
                      src={p.logoUrl}
                      alt={p.name}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-xs">{p.name}</span>
                    <span className="text-[9px] text-muted-foreground">
                      {p.type === "stream"
                        ? "Stream"
                        : p.type === "rent"
                          ? "Rent"
                          : "Buy"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {showRating ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Your rating:</p>
              <div className="flex gap-1">
                {STAR_VALUES.map((val) => (
                  <button
                    key={val}
                    onMouseEnter={() => setHoveredStar(val)}
                    onMouseLeave={() => setHoveredStar(null)}
                    onClick={() => handleAction("seen", val)}
                    className={`text-base transition-colors px-0.5 ${
                      hoveredStar !== null && val <= hoveredStar
                        ? "text-primary"
                        : "text-muted-foreground/30"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleAction("seen")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Skip rating
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs font-mono h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRating(true);
                }}
              >
                ✓ Seen it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-mono h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction("watchlisted");
                }}
              >
                + Watchlist
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-mono h-7 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction("dismissed");
                }}
              >
                ✕ Pass
              </Button>
              <div className="flex-1" />
              <a
                href={`https://letterboxd.com/film/${filmSlug}/`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-primary transition-colors font-mono"
              >
                Letterboxd →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
