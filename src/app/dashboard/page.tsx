"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FilmCard } from "@/components/film-card";
import { TwinCard } from "@/components/twin-card";
import { LoadingAnimation } from "@/components/loading-animation";
import { toast } from "sonner";
import JSZip from "jszip";

interface Recommendation {
  id: number;
  filmTitle: string;
  filmYear: string | null;
  filmSlug: string | null;
  predictedScore: string | null;
  confidence: string | null;
  reason: string | null;
}

interface TasteTwin {
  username: string;
  displayName: string | null;
  score: number;
  overlapCount: number;
  sharedLoves: number;
  sharedHates: number;
}

interface UserData {
  letterboxdUsername: string | null;
  displayName: string | null;
  totalRated: number | null;
  avgRating: string | null;
  totalFilmsOnLetterboxd: number | null;
}

interface TasteIndexStatus {
  fresh: boolean;
  computedAt: string | null;
}

type GeneratingPhase = null | "seeding" | "recomputing" | "scoring" | "done";
type DiscoveryDepth = "quick" | "deep" | "full";

const DEPTH_CONFIG = {
  quick: { filmPages: 5, maxQueue: 10, label: "Quick", desc: "~1 min", detail: "Top 5 films, 10 profiles" },
  deep:  { filmPages: 30, maxQueue: 50, label: "Deep", desc: "~5 min", detail: "Top 30 films, 50 profiles" },
  full:  { filmPages: Infinity, maxQueue: Infinity, label: "Full scan", desc: "10-20 min", detail: "Every film, every profile" },
} as const;

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [twins, setTwins] = useState<TasteTwin[]>([]);
  const [topLoves, setTopLoves] = useState<
    { filmTitle: string; rating: string }[]
  >([]);
  const [poolSize, setPoolSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generatingPhase, setGeneratingPhase] = useState<GeneratingPhase>(null);
  const [seedProgress, setSeedProgress] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    profile: {
      username: string;
      displayName: string | null;
      totalFilms: number;
    };
    tasteMatch: TasteTwin | null;
  } | null>(null);
  const [backgroundUpdating, setBackgroundUpdating] = useState(false);
  const [tasteIndexStatus, setTasteIndexStatus] =
    useState<TasteIndexStatus | null>(null);
  const abortRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recsExpanded, setRecsExpanded] = useState(true);
  const [showDepthPicker, setShowDepthPicker] = useState(false);
  const [eta, setEta] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [userRes, recsRes] = await Promise.all([
        fetch("/api/user"),
        fetch("/api/recommendations"),
      ]);

      if (userRes.ok) {
        const data = await userRes.json();
        if (!data.user.letterboxdUsername) {
          router.replace("/onboarding");
          return;
        }
        setUserData(data.user);
        setTwins(data.twins || []);
        setTopLoves(data.topLoves || []);
      }

      if (recsRes.ok) {
        const data = await recsRes.json();
        setRecs(data.recommendations || []);
        setPoolSize(data.poolSize || 0);
        if (data.tasteIndexStatus) {
          setTasteIndexStatus(data.tasteIndexStatus);
        }
      }
    } catch {
      console.error("Failed to fetch dashboard data");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchAll();
    }
  }, [status, fetchAll]);

  // Auto-trigger background recompute when taste index is stale
  useEffect(() => {
    if (
      tasteIndexStatus &&
      !tasteIndexStatus.fresh &&
      recs.length > 0 &&
      !backgroundUpdating &&
      !generatingPhase
    ) {
      setBackgroundUpdating(true);
      fetch("/api/recompute", { method: "POST" })
        .then(async (res) => {
          if (res.ok) {
            const recsRes = await fetch("/api/recommendations", {
              method: "POST",
            });
            if (recsRes.ok) {
              const data = await recsRes.json();
              if (data.recommendations?.length > 0) {
                setRecs(data.recommendations);
              }
            }
            setTasteIndexStatus({ fresh: true, computedAt: new Date().toISOString() });
          }
        })
        .catch(() => {})
        .finally(() => setBackgroundUpdating(false));
    }
  }, [tasteIndexStatus, recs.length, backgroundUpdating, generatingPhase]);

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingAnimation stepLabel="LOADING" />
      </div>
    );
  }

  if (!session) {
    router.push("/auth/signin");
    return null;
  }

  function formatEta(seconds: number): string {
    if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return s > 0 ? `~${m}m ${s}s left` : `~${m}m left`;
  }

  async function handleGenerateRecs(depth: DiscoveryDepth = "deep") {
    abortRef.current = false;
    setShowDepthPicker(false);
    const config = DEPTH_CONFIG[depth];

    // Phase 1: Crawl films for user discovery
    setGeneratingPhase("seeding");
    setEta(null);
    setSeedProgress(`${config.label} scan — discovering taste twin candidates...`);

    let filmOffset = 0;
    let totalDiscovered = 0;
    let totalTopFilms = 0;
    let filmsCrawled = 0;
    const crawlStart = Date.now();

    while (!abortRef.current) {
      try {
        const findRes = await fetch("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "find", filmOffset, batchSize: 10 }),
        });
        const data = await findRes.json();

        totalDiscovered += data.discovered;
        totalTopFilms = data.totalTopFilms;
        filmOffset += data.filmsScanned;
        filmsCrawled += data.filmsScanned;

        const targetFilms = Math.min(config.filmPages, totalTopFilms);
        const crawlElapsed = (Date.now() - crawlStart) / 1000;
        const crawlRate = filmsCrawled / Math.max(crawlElapsed, 1);
        const filmsLeft = targetFilms - filmsCrawled;
        const crawlEtaSec = filmsLeft / Math.max(crawlRate, 0.1);
        // Rough estimate: scraping takes ~8s per profile, ~60% of discovered survive
        const scrapeEtaSec = Math.min(totalDiscovered * 0.6, config.maxQueue) * 8;
        setEta(formatEta(crawlEtaSec + scrapeEtaSec + 30));

        setSeedProgress(
          `Crawled ${filmOffset} of ${targetFilms} films — ${totalDiscovered} new profiles found`
        );
        setPoolSize(data.poolSize);

        if (!data.hasMoreFilms || filmsCrawled >= config.filmPages) break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (abortRef.current) { setGeneratingPhase(null); setEta(null); return; }

    // Phase 2: Quick-scrape queued profiles (up to maxQueue)
    let scraped = 0;
    const scrapeStart = Date.now();
    let queueTotal = 0;

    while (!abortRef.current) {
      try {
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process", count: 3 }),
        });
        const data = await res.json();

        if (data.queueRemaining === 0 && data.processed === 0) break;

        scraped += data.processed + data.skipped;
        if (queueTotal === 0) queueTotal = scraped + data.queueRemaining;

        // Live ETA based on actual scrape rate
        const scrapeElapsed = (Date.now() - scrapeStart) / 1000;
        const scrapeRate = scraped / Math.max(scrapeElapsed, 1);
        const remaining = Math.min(data.queueRemaining, config.maxQueue - scraped);
        const scrapeEtaSec = remaining / Math.max(scrapeRate, 0.05);
        setEta(formatEta(scrapeEtaSec + 30));

        const names = data.details?.filter((d: string) => !d.includes("skipped") && !d.includes("error")).join(", ") ?? "";
        setSeedProgress(
          `${data.poolSize} profiles scraped, ${data.queueRemaining} queued${names ? ` — ${names}` : ""}`
        );
        setPoolSize(data.poolSize);

        if (data.queueRemaining <= 0) break;
        if (scraped >= config.maxQueue) break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (abortRef.current) { setGeneratingPhase(null); setEta(null); return; }

    // Phase 3: Compute taste matches
    setGeneratingPhase("recomputing");
    setEta(formatEta(Math.max(poolSize * 0.3, 10)));
    try {
      const res = await fetch("/api/recompute", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to compute taste matches");
        setGeneratingPhase(null);
        return;
      }
    } catch {
      toast.error("Network error computing taste matches");
      setGeneratingPhase(null);
      return;
    }

    if (abortRef.current) { setGeneratingPhase(null); setEta(null); return; }

    // Phase 4: Generate recommendations
    setGeneratingPhase("scoring");
    setEta("~10s left");
    try {
      const res = await fetch("/api/recommendations", { method: "POST" });
      const data = await res.json();

      if (data.recommendations?.length > 0) {
        setRecs(data.recommendations);
        setTasteIndexStatus({ fresh: true, computedAt: new Date().toISOString() });
        toast.success(`${data.totalGenerated} recs from ${poolSize}+ profiles (${config.label.toLowerCase()} scan)`);
        const userRes = await fetch("/api/user");
        if (userRes.ok) {
          const ud = await userRes.json();
          setTwins(ud.twins || []);
        }
      } else if (data.needsRecompute) {
        toast.error("Not enough overlap. Try a deeper scan.");
      } else {
        toast.error(data.error || "No recommendations generated");
      }
    } catch {
      toast.error("Network error generating recommendations");
    }

    setGeneratingPhase(null);
    setEta(null);
  }

  async function handleResync() {
    if (!userData?.letterboxdUsername) return;
    setSyncing(true);
    toast.info("Re-syncing your Letterboxd ratings...");

    let page = 1;
    try {
      while (true) {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: userData.letterboxdUsername,
            page,
          }),
        });

        if (!res.ok) break;
        const data = await res.json();

        if (data.done) {
          toast.success(
            `Synced ${data.totalRatedSoFar} rated films. Taste index is updating in the background.`
          );
          setUserData((prev) =>
            prev
              ? {
                  ...prev,
                  totalRated: data.totalRatedSoFar,
                  avgRating: data.avgRating,
                }
              : prev
          );
          setTasteIndexStatus({ fresh: false, computedAt: null });
          break;
        }
        page++;
      }
    } catch {
      toast.error("Failed to re-sync");
    } finally {
      setSyncing(false);
    }
  }

  async function findRatingsCsv(files: File[]): Promise<string | null> {
    for (const file of files) {
      if (file.name.toLowerCase() === "ratings.csv") return file.text();
      if (file.name.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(file);
          const r = zip.file("ratings.csv") ?? zip.file(/ratings\.csv$/i)[0] ?? null;
          if (r) return r.async("text");
        } catch {}
      }
    }
    for (const file of files) {
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        if (text.includes("Letterboxd URI") && text.includes("Rating")) return text;
      }
    }
    return null;
  }

  async function handleImportFiles(files: File[]) {
    if (!userData?.letterboxdUsername || files.length === 0) return;
    setImporting(true);

    try {
      const csvText = await findRatingsCsv(files);

      if (!csvText) {
        toast.error("No ratings.csv found. Drop the Letterboxd export folder, ZIP, or ratings.csv.");
        setImporting(false);
        return;
      }

      const csvBlob = new Blob([csvText], { type: "text/csv" });
      const csvFile = new File([csvBlob], "ratings.csv", { type: "text/csv" });

      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("username", userData.letterboxdUsername);

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Import failed");
      } else {
        toast.success(`Imported ${data.imported} ratings (${data.totalRated} total). Taste index updating in background.`);
        setUserData((prev) =>
          prev ? { ...prev, totalRated: data.totalRated, avgRating: data.avgRating } : prev
        );
        setTasteIndexStatus({ fresh: false, computedAt: null });
      }
    } catch {
      toast.error("Failed to process file");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  function handleImportInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleImportFiles(Array.from(e.target.files));
  }

  function handleImportDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.some((en) => en.isDirectory)) {
        Promise.all(entries.map(collectFilesFromEntry)).then((results) => {
          handleImportFiles(results.flat());
        });
        return;
      }
    }

    if (e.dataTransfer.files.length > 0) {
      handleImportFiles(Array.from(e.dataTransfer.files));
    }
  }

  async function handleAction(
    recId: number,
    filmSlug: string,
    filmTitle: string,
    action: string,
    rating?: number
  ) {
    try {
      await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filmSlug, filmTitle, action, rating }),
      });

      setRecs((prev) => prev.filter((r) => r.id !== recId));

      const label =
        action === "seen"
          ? "Marked as seen"
          : action === "watchlisted"
            ? "Added to watchlist"
            : "Dismissed";
      toast.success(label);
    } catch {
      toast.error("Failed to save action");
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchUsername.trim()) return;
    setSearching(true);
    setSearchResult(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: searchUsername.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Search failed");
        setSearching(false);
        return;
      }

      setSearchResult(data);
    } catch {
      toast.error("Network error");
    } finally {
      setSearching(false);
    }
  }

  const isGenerating = generatingPhase !== null;

  function getPhaseLabel() {
    switch (generatingPhase) {
      case "seeding":
        return "Discovering & scraping profiles...";
      case "recomputing":
        return "Finding your taste twins...";
      case "scoring":
        return "Ranking unwatched films...";
      default:
        return "";
    }
  }

  function getPhaseDescription() {
    switch (generatingPhase) {
      case "seeding":
        return "Crawling Letterboxd film pages and the members directory to find users, then pulling their ratings via RSS.";
      case "recomputing":
        return "Scoring every discovered profile against your taste — shared loves, shared hates, disagreements.";
      case "scoring":
        return "Collecting films your taste twins rated 4+ stars that you haven't seen, weighted by twin strength.";
      default:
        return "";
    }
  }


  return (
    <div className="min-h-screen">
      <nav className="border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <span className="font-mono text-sm tracking-wider text-primary">
          WASHUDIWA
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {session.user?.email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign out
          </Button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {userData && (
          <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold">
                {userData.displayName || userData.letterboxdUsername}
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground font-mono">
                <span>{userData.totalRated} rated</span>
                {userData.avgRating && (
                  <span>
                    {parseFloat(userData.avgRating).toFixed(1)}★ avg
                  </span>
                )}
                {topLoves.length > 0 && (
                  <span className="text-primary">
                    Loves:{" "}
                    {topLoves
                      .slice(0, 3)
                      .map((f) => f.filmTitle)
                      .join(", ")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.zip"
                onChange={handleImportInput}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                className="font-mono text-xs"
              >
                {importing ? "UPLOADING..." : "UPLOAD RATINGS"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResync}
                disabled={syncing}
                className="font-mono text-xs"
              >
                {syncing ? "SYNCING..." : "RE-SYNC RSS"}
              </Button>
            </div>
          </div>
        )}

        {userData &&
          userData.totalFilmsOnLetterboxd &&
          (userData.totalRated ?? 0) > 0 &&
          userData.totalFilmsOnLetterboxd > (userData.totalRated ?? 0) * 1.5 && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleImportDrop}
            className={`mb-6 flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-primary/20 bg-primary/5"
            }`}
          >
            <p className="text-sm text-muted-foreground flex-1">
              <span className="font-mono text-primary">{userData.totalRated}</span> of your{" "}
              <span className="font-mono text-foreground">{userData.totalFilmsOnLetterboxd}</span>{" "}
              Letterboxd films are synced.{" "}
              <a
                href="https://letterboxd.com/settings/data/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Export your data
              </a>
              {" "}and {dragOver ? "drop it here" : "drag it here"} for better recs.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importFileRef.current?.click()}
              disabled={importing}
              className="font-mono text-xs shrink-0"
            >
              {importing ? "..." : "UPLOAD"}
            </Button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1 space-y-6">
            <div className="flex items-center justify-between">
              <button
                onClick={() => recs.length > 0 && setRecsExpanded(!recsExpanded)}
                className="flex items-center gap-2 text-left"
              >
                <span
                  className={`text-xs text-muted-foreground transition-transform ${
                    recsExpanded ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
                <div>
                  <h1 className="text-2xl font-bold">
                    Your Recommendations
                    {recs.length > 0 && (
                      <span className="text-base font-normal text-muted-foreground ml-2">
                        ({recs.length})
                      </span>
                    )}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Films your taste twins love that you haven&apos;t seen
                  </p>
                </div>
              </button>
              <div className="relative">
                <Button
                  onClick={() => isGenerating ? null : setShowDepthPicker(!showDepthPicker)}
                  disabled={isGenerating}
                  className="font-mono text-sm"
                >
                  {isGenerating
                    ? "WORKING..."
                    : recs.length > 0
                      ? "REFRESH RECS ▾"
                      : "GENERATE RECS ▾"}
                </Button>

                {showDepthPicker && !isGenerating && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                    {(["quick", "deep", "full"] as DiscoveryDepth[]).map((depth) => {
                      const c = DEPTH_CONFIG[depth];
                      return (
                        <button
                          key={depth}
                          onClick={() => handleGenerateRecs(depth)}
                          className="w-full px-4 py-3 text-left hover:bg-secondary/50 transition-colors border-b border-border/30 last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold">{c.label}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{c.desc}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {backgroundUpdating && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/50 border border-border/50">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <p className="text-xs font-mono text-muted-foreground">
                  Updating taste index in the background...
                </p>
              </div>
            )}

            {isGenerating && (
              <div className="py-16 flex justify-center">
                <LoadingAnimation
                  stepLabel={getPhaseLabel()}
                  stepDescription={getPhaseDescription()}
                  detail={generatingPhase === "seeding" ? seedProgress : undefined}
                  timeEstimate={eta ?? undefined}
                />
              </div>
            )}

            {recs.length === 0 && !isGenerating && (
              <Card>
                <CardContent className="pt-6 text-center space-y-3">
                  <p className="text-muted-foreground">
                    No recommendations yet.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Hit &quot;Generate Recs&quot; and pick your depth — quick for
                    instant results, full scan to search the entire Letterboxd galaxy.
                    {poolSize > 0
                      ? ` ${poolSize} profiles already in the pool.`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            )}

            {recsExpanded && (
              <div className="divide-y divide-border/30">
                {recs.map((rec) => (
                  <FilmCard
                    key={rec.id}
                    filmTitle={rec.filmTitle}
                    filmYear={rec.filmYear}
                    filmSlug={rec.filmSlug}
                    predictedScore={rec.predictedScore}
                    confidence={rec.confidence}
                    reason={rec.reason}
                    onAction={(action, rating) =>
                      handleAction(
                        rec.id,
                        rec.filmSlug || "",
                        rec.filmTitle,
                        action,
                        rating
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-full lg:w-80 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-mono tracking-wide">
                  COMPARE WITH ANYONE
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSearch} className="flex gap-2">
                  <Input
                    placeholder="Letterboxd username"
                    value={searchUsername}
                    onChange={(e) => setSearchUsername(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={searching}
                    className="font-mono text-xs shrink-0"
                  >
                    {searching ? "..." : "GO"}
                  </Button>
                </form>

                {searchResult && (
                  <div className="mt-4 space-y-2 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <a
                        href={`https://letterboxd.com/${searchResult.profile.username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold hover:text-primary transition-colors"
                      >
                        {searchResult.profile.displayName ||
                          searchResult.profile.username}
                      </a>
                      <span className="text-xs text-muted-foreground font-mono">
                        {searchResult.profile.totalFilms} films
                      </span>
                    </div>
                    {searchResult.tasteMatch ? (
                      <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">
                            Taste score
                          </span>
                          <span className="font-mono text-sm text-primary">
                            {searchResult.tasteMatch.score.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground font-mono">
                          <span>
                            {searchResult.tasteMatch.overlapCount} overlap
                          </span>
                          <span className="text-primary">
                            ♥ {searchResult.tasteMatch.sharedLoves}
                          </span>
                          <span className="text-destructive">
                            ✕ {searchResult.tasteMatch.sharedHates}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not enough overlap (need 5+ shared rated films).
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Separator />

            {twins.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-mono text-xs tracking-wider text-muted-foreground">
                  YOUR TASTE TWINS
                </h3>
                {twins.map((twin) => (
                  <TwinCard key={twin.username} {...twin} />
                ))}
              </div>
            )}

            {twins.length === 0 && !isGenerating && (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground">
                  Generate recs to discover your taste twins.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Attribution footer */}
      <footer className="border-t border-border/30 px-6 py-4 mt-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-muted-foreground/60">
          <span className="font-mono">NOT AFFILIATED WITH LETTERBOXD</span>
          <span>
            This product uses{" "}
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground"
            >
              TMDB
            </a>{" "}
            and the TMDB APIs but is not endorsed, certified, or otherwise
            approved by TMDB.
          </span>
        </div>
      </footer>
    </div>
  );
}

interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (file: File) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FileSystemEntry[]) => void) => void;
  };
}

async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!((file) => resolve([file]));
    });
  }
  if (entry.isDirectory && entry.createReader) {
    return new Promise((resolve) => {
      const reader = entry.createReader!();
      reader.readEntries(async (entries) => {
        const results = await Promise.all(entries.map(collectFilesFromEntry));
        resolve(results.flat());
      });
    });
  }
  return [];
}
