import { Card, CardContent } from "@/components/ui/card";

interface TwinCardProps {
  username: string;
  displayName: string | null;
  score: number;
  overlapCount: number;
  sharedLoves: number;
  sharedHates: number;
}

function getTwinLabel(score: number): { text: string; color: string } {
  if (score >= 2.5) return { text: "Soulmate", color: "text-primary" };
  if (score >= 2.0) return { text: "Twin", color: "text-primary" };
  if (score >= 1.5) return { text: "Strong match", color: "text-primary/80" };
  if (score >= 1.0) return { text: "Good match", color: "text-muted-foreground" };
  if (score >= 0.5) return { text: "Mild match", color: "text-muted-foreground/70" };
  return { text: "Loose match", color: "text-muted-foreground/50" };
}

function getAgreementRate(sharedLoves: number, sharedHates: number, overlapCount: number): string {
  if (overlapCount === 0) return "";
  const agreed = sharedLoves + sharedHates;
  const pct = Math.round((agreed / overlapCount) * 100);
  return `${pct}% aligned`;
}

export function TwinCard({
  username,
  displayName,
  score,
  overlapCount,
  sharedLoves,
  sharedHates,
}: TwinCardProps) {
  const label = getTwinLabel(score);
  const alignment = getAgreementRate(sharedLoves, sharedHates, overlapCount);

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center justify-between">
          <a
            href={`https://letterboxd.com/${username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold hover:text-primary transition-colors truncate"
          >
            {displayName || username}
          </a>
          <span className={`text-xs font-mono tracking-wide ${label.color}`}>
            {label.text}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground font-mono tracking-wide">
          <span>{overlapCount} shared films</span>
          {sharedLoves > 0 && <span className="text-primary">♥ {sharedLoves} loved</span>}
          {sharedHates > 0 && <span className="text-destructive">✕ {sharedHates} hated</span>}
          {alignment && <span>{alignment}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
