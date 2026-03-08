"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/logo";

export default function LandingPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <LogoMark className="h-6" />
        <div className="flex gap-3">
          {session ? (
            <Link href="/dashboard">
              <Button size="sm">Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/auth/signin">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/auth/signin">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center space-y-8">
          <div className="space-y-6">
            <Logo className="h-12 w-auto mx-auto" />
            <p className="text-xl text-muted-foreground leading-relaxed">
              Quickly answer the dreaded question of
              <br />
              <span className="text-primary italic">
                &lsquo;what should I watch?&rsquo;
              </span>
            </p>
          </div>

          <div className="flex items-center justify-center gap-4">
            <Link href="/auth/signin">
              <Button size="lg" className="font-mono text-sm tracking-wide">
                CONNECT LETTERBOXD
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-6 pt-8 border-t border-border/30">
            <div className="space-y-2">
              <p className="font-mono text-2xl text-primary">01</p>
              <p className="text-sm text-muted-foreground">
                Link your Letterboxd
              </p>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-2xl text-primary">02</p>
              <p className="text-sm text-muted-foreground">
                Find your taste twins
              </p>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-2xl text-primary">03</p>
              <p className="text-sm text-muted-foreground">
                Find movies you&apos;ll love that you haven&apos;t watched yet
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/30 px-6 py-4 text-center space-y-1">
        <p className="text-xs text-muted-foreground font-mono">
          NOT AFFILIATED WITH LETTERBOXD
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          This product uses{" "}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground">TMDB</a>
          {" "}and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
        </p>
      </footer>
    </div>
  );
}
