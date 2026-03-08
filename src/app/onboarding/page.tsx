"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import JSZip from "jszip";

type Phase =
  | "checking"
  | "username"
  | "connecting"
  | "choose"
  | "scraping"
  | "importing"
  | "complete"
  | "error";

async function findRatingsCsv(files: FileList | File[]): Promise<string | null> {
  const fileArray = Array.from(files);
  for (const file of fileArray) {
    if (file.name.toLowerCase() === "ratings.csv") return file.text();
    if (file.name.endsWith(".zip")) {
      try {
        const zip = await JSZip.loadAsync(file);
        const r = zip.file("ratings.csv") ?? zip.file(/ratings\.csv$/i)[0] ?? null;
        if (r) return r.async("text");
      } catch {}
    }
  }
  for (const file of fileArray) {
    if (file.name.endsWith(".csv")) {
      const text = await file.text();
      if (text.includes("Letterboxd URI") && text.includes("Rating")) return text;
    }
  }
  return null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [username, setUsername] = useState("");
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState("");
  const [scrapedCount, setScrapedCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalRated, setTotalRated] = useState(0);
  const [totalFilmsOnProfile, setTotalFilmsOnProfile] = useState(0);
  const [avgRating, setAvgRating] = useState("0");
  const [displayName, setDisplayName] = useState("");
  const [importCount, setImportCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    async function checkStatus() {
      try {
        const res = await fetch("/api/user");
        if (res.ok) {
          const data = await res.json();
          if (data.user.letterboxdUsername) {
            router.replace("/dashboard");
            return;
          }
        }
      } catch {}
      setPhase("username");
    }
    checkStatus();
  }, [status, router]);

  // Step 1: Connect username + auto-scrape RSS
  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setError("");
    setPhase("connecting");
    abortRef.current = false;

    const trimmedUsername = username.trim();
    let page = 1;
    let lastTotalRated = 0;

    try {
      while (!abortRef.current) {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmedUsername, page }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Username not found on Letterboxd");
          setPhase("username");
          return;
        }

        lastTotalRated = data.totalRatedSoFar;
        setScrapedCount(data.totalRatedSoFar);
        setCurrentPage(page);
        setAvgRating(data.avgRating);

        if (data.done) break;
        page++;
      }

      // Fetch the full profile stats to get totalFilmsOnLetterboxd
      const userRes = await fetch("/api/user");
      if (userRes.ok) {
        const userData = await userRes.json();
        setDisplayName(userData.user.displayName || trimmedUsername);
        setTotalFilmsOnProfile(userData.user.totalFilmsOnLetterboxd || 0);
      }

      setTotalRated(lastTotalRated);

      // Go to the "choose" phase where they see the gap
      setPhase("choose");
    } catch {
      setError("Network error — try again");
      setPhase("username");
    }
  }

  // Step 2 option: Upload export data
  const processFiles = useCallback(async (files: FileList | File[]) => {
    setError("");
    setPhase("importing");

    try {
      const csvText = await findRatingsCsv(files);
      if (!csvText) {
        setError("No ratings.csv found. Drop the Letterboxd export folder, ZIP, or ratings.csv.");
        setPhase("choose");
        return;
      }

      const csvBlob = new Blob([csvText], { type: "text/csv" });
      const csvFile = new File([csvBlob], "ratings.csv", { type: "text/csv" });

      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("username", username.trim());

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to import");
        setPhase("choose");
        return;
      }

      setTotalRated(data.totalRated);
      setAvgRating(data.avgRating);
      setDisplayName(data.displayName || username.trim());
      setImportCount(data.imported);
      setPhase("complete");
    } catch {
      setError("Failed to process files — try again");
      setPhase("choose");
    }
  }, [username]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.some((en) => en.isDirectory)) {
        Promise.all(entries.map(collectFiles)).then((results) => processFiles(results.flat()));
        return;
      }
    }
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }

  if (status === "loading" || phase === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground font-mono text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!session) {
    router.push("/auth/signin");
    return null;
  }

  const syncGap = totalFilmsOnProfile > 0 && totalRated < totalFilmsOnProfile;
  const syncPercent = totalFilmsOnProfile > 0
    ? Math.round((totalRated / totalFilmsOnProfile) * 100)
    : 100;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <span className="font-mono text-sm tracking-wider text-primary">WASHUDIWA</span>
          <h1 className="text-2xl font-bold">Connect your Letterboxd</h1>
        </div>

        {/* Step 1: Enter username */}
        {phase === "username" && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">What&apos;s your Letterboxd username?</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleConnect} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground font-mono">letterboxd.com/</span>
                    <Input
                      id="username"
                      placeholder="yourname"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="font-mono"
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full font-mono text-sm" disabled={!username.trim()}>
                  CONNECT
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Connecting: auto-syncing RSS */}
        {phase === "connecting" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-3">
                <p className="text-sm font-mono text-primary">Connecting {username}...</p>
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(95, currentPage * 15)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground font-mono">
                  <span>Pulling your ratings...</span>
                  <span>{scrapedCount} found</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Show what we got and let them choose */}
        {phase === "choose" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="text-center space-y-1">
                  <p className="text-lg font-bold">{displayName || username}</p>
                  <p className="text-sm text-muted-foreground">Connected to Letterboxd</p>
                </div>

                <div className="bg-secondary/30 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="font-mono text-2xl text-primary">{totalRated}</span>
                    {totalFilmsOnProfile > 0 && (
                      <span className="text-sm text-muted-foreground">
                        of {totalFilmsOnProfile} films on your profile
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">rated films synced automatically</p>

                  {syncGap && (
                    <div className="space-y-1.5 pt-2 border-t border-border/30">
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${syncPercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Letterboxd&apos;s RSS feed only includes a portion of your data.
                        This isn&apos;t something you can control — it&apos;s a platform limitation.
                      </p>
                    </div>
                  )}
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="space-y-3">
                  <Button
                    onClick={() => router.push("/dashboard")}
                    variant={syncGap ? "outline" : "default"}
                    className="w-full font-mono text-sm"
                  >
                    {syncGap
                      ? `GET RECS FROM THIS SNAPSHOT (${syncPercent}%)`
                      : "FIND MY TASTE TWINS →"}
                  </Button>

                  {syncGap && (
                    <>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`
                          border-2 border-dashed rounded-lg p-5 text-center cursor-pointer
                          transition-colors duration-200
                          ${dragging ? "border-primary bg-primary/10" : "border-primary/40 hover:border-primary/60"}
                        `}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.zip"
                          onChange={(e) => e.target.files && processFiles(e.target.files)}
                          className="hidden"
                          multiple
                        />
                        <p className="text-sm font-bold text-primary mb-1">
                          Upload full data for the best recs
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Export from{" "}
                          <a
                            href="https://letterboxd.com/settings/data/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            letterboxd.com/settings/data
                          </a>
                          {" "}→ drop the .zip or folder here
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Importing */}
        {phase === "importing" && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <p className="text-sm font-mono text-primary">Importing ratings...</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Resolving film slugs and syncing to the database.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {phase === "error" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                onClick={() => { setPhase("username"); setError(""); }}
                className="w-full font-mono text-sm"
              >
                TRY AGAIN
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Complete */}
        {phase === "complete" && (
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="text-center space-y-2">
                <p className="text-primary font-mono text-sm">
                  {importCount > 0 ? `IMPORTED ${importCount} RATINGS` : "SYNC COMPLETE"}
                </p>
                <p className="text-lg font-bold">{displayName || username}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-secondary/50 rounded-lg p-4 text-center">
                  <p className="font-mono text-2xl text-primary">{totalRated}</p>
                  <p className="text-xs text-muted-foreground">films rated</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-4 text-center">
                  <p className="font-mono text-2xl text-primary">
                    {parseFloat(avgRating).toFixed(1)}★
                  </p>
                  <p className="text-xs text-muted-foreground">avg rating</p>
                </div>
              </div>

              <Button
                onClick={() => router.push("/dashboard")}
                className="w-full font-mono text-sm"
              >
                FIND MY TASTE TWINS →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Scraping (legacy, kept for re-sync flows) */}
        {phase === "scraping" && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm font-mono text-primary">Syncing {username}...</p>
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>Page {currentPage || "..."}</span>
                <span>{scrapedCount} rated films found</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (file: File) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FileSystemEntry[]) => void) => void };
}

async function collectFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => { entry.file!((file) => resolve([file])); });
  }
  if (entry.isDirectory && entry.createReader) {
    return new Promise((resolve) => {
      const reader = entry.createReader!();
      reader.readEntries(async (entries) => {
        const results = await Promise.all(entries.map(collectFiles));
        resolve(results.flat());
      });
    });
  }
  return [];
}
