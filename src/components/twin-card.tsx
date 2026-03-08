import { Card, CardContent } from "@/components/ui/card";

interface TwinCardProps {
  username: string;
  displayName: string | null;
  score: number;
  overlapCount: number;
  sharedLoves: number;
  sharedHates: number;
}

export function TwinCard({
  username,
  displayName,
  score,
  overlapCount,
  sharedLoves,
  sharedHates,
}: TwinCardProps) {
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
          <span className="font-mono text-sm text-primary">
            {score.toFixed(1)}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground font-mono tracking-wide">
          <span>{overlapCount} overlap</span>
          <span className="text-primary">♥ {sharedLoves}</span>
          <span className="text-destructive">✕ {sharedHates}</span>
        </div>
      </CardContent>
    </Card>
  );
}
