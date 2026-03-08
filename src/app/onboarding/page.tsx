"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import JSZip from "jszip";

type Phase = "checking" | "input" | "scraping" | "importing" | "complete" | "error";

/**
 * Given any combination of files (a ZIP, a CSV, or a folder of files),
 * find and return the text content of ratings.csv.
 */
async function findRatingsCsv(files: FileList | File[]): Promise<string | null> {
  const fileArray = Array.from(files);

  for (const file of fileArray) {
    // Direct ratings.csv (from folder drop or file picker)
    if (file.name.toLowerCase() === "ratings.csv") {
      return file.text();
    }

    // ZIP file — extract ratings.csv from inside
    if (file.name.endsWith(".zip")) {
      try {
        const zip = await JSZip.loadAsync(file);
        const ratingsFile =
          zip.file("ratings.csv") ??
          zip.file(/ratings\.csv$/i)[0] ??
          null;
        if (ratingsFile) return ratingsFile.async("text");
      } catch {}
    }
  }

  // If multiple files dropped (folder), look for any .csv that has the right header
  for (const file of fileArray) {
    if (file.name.endsWith(".csv") && file.name.toLowerCase() !== "ratings.csv") {
      const text = await file.text();
      if (text.startsWith("Date,Name,Year,Letterboxd URI,Rating")) {
        return text;
      }
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
      setPhase("input");
    }
    checkStatus();
  }, [status, router]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    if (!username.trim()) {
      setError("Enter your Letterboxd username first");
      return;
    }

    setError("");
    setPhase("importing");

    try {
      const csvText = await findRatingsCsv(files);

      if (!csvText) {
        setError("No ratings.csv found. Drop the Letterboxd export folder, ZIP, or the ratings.csv file.");
        setPhase("error");
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
        setPhase("error");
        return;
      }

      setTotalRated(data.totalRated);
      setAvgRating(data.avgRating);
      setDisplayName(data.displayName || username.trim());
      setImportCount(data.imported);
      setPhase("complete");
    } catch {
      setError("Failed to process files — try again");
      setPhase("error");
    }
  }, [username]);

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

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPhase("scraping");
    setScrapedCount(0);
    setCurrentPage(0);
    abortRef.current = false;

    const trimmedUsername = username.trim();
    let page = 1;

    try {
      while (!abortRef.current) {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmedUsername, page }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to scrape profile");
          setPhase("error");
          return;
        }

        setScrapedCount(data.totalRatedSoFar);
        setCurrentPage(page);
        setAvgRating(data.avgRating);

        if (data.done) {
          setTotalRated(data.totalRatedSoFar);
          try {
            const userRes = await fetch("/api/user");
            if (userRes.ok) {
              const userData = await userRes.json();
              setDisplayName(userData.user.displayName || trimmedUsername);
            }
          } catch {}
          setPhase("complete");
          return;
        }

        page++;
      }
    } catch {
      setError("Network error — try again");
      setPhase("error");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const files: File[] = [];
      const entries: FileSystemEntry[] = [];

      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.some((e) => e.isDirectory)) {
        // Folder drop — recursively collect files
        const promises = entries.map((entry) => collectFiles(entry));
        Promise.all(promises).then((results) => {
          processFiles(results.flat());
        });
        return;
      }
    }

    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <span className="font-mono text-sm tracking-wider text-primary">WASHUDIWA</span>
          <h1 className="text-2xl font-bold">Connect your Letterboxd</h1>
        </div>

        {phase === "input" && (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Letterboxd username</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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

              <div className="space-y-3">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => username.trim() && fileInputRef.current?.click()}
                  className={`
                    border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                    transition-colors duration-200
                    ${dragging
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-primary/40"
                    }
                    ${!username.trim() ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.zip"
                    onChange={(e) => e.target.files && processFiles(e.target.files)}
                    className="hidden"
                    // @ts-expect-error — webkitdirectory is a valid HTML attribute
                    webkitdirectory=""
                    multiple
                  />
                  <p className="text-sm font-medium mb-1">
                    {dragging ? "Drop it here" : "Drop your Letterboxd export"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Folder, .zip, or ratings.csv — we&apos;ll find what we need
                  </p>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Get your export from{" "}
                  <a
                    href="https://letterboxd.com/settings/data/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    letterboxd.com/settings/data
                  </a>
                </p>

                <div className="relative py-1">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                    or quick start
                  </span>
                </div>

                <Button
                  variant="outline"
                  onClick={handleScrape}
                  className="w-full font-mono text-sm"
                  disabled={!username.trim()}
                >
                  SYNC VIA RSS (diary entries only)
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase === "scraping" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-3">
                <p className="text-sm font-mono text-primary">Scraping {username}...</p>
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(95, currentPage * 15)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground font-mono">
                  <span>Page {currentPage || "..."}</span>
                  <span>{scrapedCount} rated films found</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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

        {phase === "error" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                onClick={() => { setPhase("input"); setError(""); }}
                className="w-full font-mono text-sm"
              >
                TRY AGAIN
              </Button>
            </CardContent>
          </Card>
        )}

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
    return new Promise((resolve) => {
      entry.file!((file) => resolve([file]));
    });
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
