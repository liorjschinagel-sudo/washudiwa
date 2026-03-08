export interface TasteMatch {
  score: number;
  overlapCount: number;
  sharedLoves: number;
  sharedHates: number;
  strongDisagrees: number;
}

export function computeTasteTwinScore(
  userRatings: Record<string, number>,
  otherRatings: Record<string, number>
): TasteMatch | null {
  const userFilms = new Set(Object.keys(userRatings));
  const otherFilms = new Set(Object.keys(otherRatings));
  const overlapFilms: string[] = [];

  for (const film of userFilms) {
    if (otherFilms.has(film)) overlapFilms.push(film);
  }

  if (overlapFilms.length < 10) return null;

  let totalScore = 0;
  let sharedLoves = 0;
  let sharedHates = 0;
  let strongDisagrees = 0;

  for (const film of overlapFilms) {
    const myR = userRatings[film];
    const theirR = otherRatings[film];
    const diff = Math.abs(myR - theirR);

    const myLove = myR >= 4.0;
    const myHate = myR <= 2.0;
    const theirLove = theirR >= 4.0;
    const theirHate = theirR <= 2.0;

    if (myLove && theirLove) {
      totalScore += 3.0 - diff * 0.5;
      sharedLoves++;
    } else if (myHate && theirHate) {
      totalScore += 3.0 - diff * 0.5;
      sharedHates++;
    } else if ((myLove && theirHate) || (myHate && theirLove)) {
      totalScore -= 3.0;
      strongDisagrees++;
    } else {
      totalScore += 1.0 - diff * 0.3;
    }
  }

  const overlapBonus = Math.min(overlapFilms.length / 50, 1.0);
  const normalized =
    (totalScore / overlapFilms.length) * (0.7 + 0.3 * overlapBonus);

  return {
    score: Math.round(normalized * 100) / 100,
    overlapCount: overlapFilms.length,
    sharedLoves,
    sharedHates,
    strongDisagrees,
  };
}
