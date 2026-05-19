/**
 * Notes helpers for public submissions and review prefill.
 */

export function notesWithThanks(username, userNotes) {
  const name = String(username ?? "").trim();
  const thanks = name ? `Thanks ${name}!` : "";
  const notes = String(userNotes ?? "").trim();
  if (thanks && notes) return `${notes}\n\n${thanks}`;
  if (thanks) return thanks;
  return notes;
}
