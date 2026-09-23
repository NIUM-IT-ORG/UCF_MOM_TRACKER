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
