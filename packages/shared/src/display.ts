/**
 * How a person's designation is written on screen and on paper.
 *
 * Most people hold a designation from the master list, and that name is what
 * appears. An external invitee does not: a banker is "Branch Manager, SBI",
 * which is typed when they are added and kept on the person as `title`. The
 * designation row they are attached to is EXT, and printing "External
 * invitee" against every outside attendee would make an attendance sheet
 * useless for the thing attendance sheets are for — knowing who was in the
 * room.
 *
 * So the typed title wins wherever a person is displayed. It never wins
 * anywhere a *capability* is decided: that is read from the designation, and
 * this function is not involved in it.
 */
export function designationLabel(
  title: string | null | undefined,
  designationName: string,
): string {
  const typed = title?.trim();
  return typed ? typed : designationName;
}

/**
 * Whole percentages that add up to 100.
 *
 * Rounding each share on its own is what produced "50% · 13% · 13% · 25%" on
 * sixteen actions - 101%, on a government dashboard, where every figure is
 * read as a claim. Largest remainder instead: floor everything, then hand the
 * leftover points to the slices that lost the most in the flooring.
 *
 * The ring is not drawn from these. Geometry keeps the exact fractions, so
 * the arcs stay true to the counts; this is only what the legend prints.
 */
export function wholePercentages(
  slices: { key: string; value: number }[],
  total: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0) return out;

  const exact = slices.map((s) => ({ key: s.key, value: (s.value / total) * 100 }));
  for (const e of exact) out.set(e.key, Math.floor(e.value));

  let left = 100 - [...out.values()].reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .filter((e) => e.value > 0)
    .sort((a, b) => (b.value % 1) - (a.value % 1));

  for (const e of byRemainder) {
    if (left <= 0) break;
    out.set(e.key, (out.get(e.key) ?? 0) + 1);
    left -= 1;
  }
  return out;
}
