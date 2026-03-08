"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LoadingAnimationProps {
  stepLabel: string;
  stepDescription?: string;
  detail?: string;
  timeEstimate?: string;
  className?: string;
}

export function LoadingAnimation({
  stepLabel,
  stepDescription,
  detail,
  timeEstimate,
  className,
}: LoadingAnimationProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [stepLabel]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className={cn("flex flex-col items-center gap-6", className)}>
      <div className="w-36 sm:w-44">
        <svg
          viewBox="-1 -1 34 23"
          className="w-full h-auto text-foreground/60"
          overflow="hidden"
          aria-hidden="true"
        >
          <path
            d="M16 2C17.242 2.93147 18.25 4.13931 18.944 5.52786C19.639 6.91642 20 8.44755 20 10C20 11.5525 19.639 13.0836 18.944 14.4721C18.25 15.8607 17.242 17.0685 16 18C14.758 17.0685 13.75 15.8607 13.056 14.4721C12.361 13.0836 12 11.5525 12 10C12 8.44755 12.361 6.91642 13.056 5.52786C13.75 4.13931 14.758 2.93147 16 2Z"
            fill="var(--primary)"
            className="venn-intersection"
          />
          <circle
            cx="10"
            cy="10"
            r="10"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            className="venn-left-eye"
          />
          <circle
            cx="22"
            cy="10"
            r="10"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            className="venn-right-eye"
          />
          <circle
            cx="16"
            cy="10"
            r="2.5"
            fill="var(--background)"
            className="venn-pupil"
          />
        </svg>
      </div>

      <div className="text-center space-y-2 max-w-xs">
        <p className="text-xs font-mono text-primary tracking-widest uppercase">
          {stepLabel}
        </p>
        {stepDescription && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {stepDescription}
          </p>
        )}
        {detail && (
          <p className="text-[11px] font-mono text-muted-foreground/60">
            {detail}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-1">
          <span className="text-[11px] font-mono text-muted-foreground/40 tabular-nums">
            {elapsedStr}
          </span>
          {timeEstimate && (
            <>
              <span className="text-muted-foreground/20">·</span>
              <span className="text-[11px] font-mono text-muted-foreground/40">
                {timeEstimate}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
