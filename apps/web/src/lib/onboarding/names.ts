/**
 * Friendly first name from an email local part: "sherry.miller@hilltop.farm"
 * gives "Sherry". Null when the local part has no letters to go on.
 */
export function inferFirstName(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = email.split('@')[0] ?? '';
  const head = local.split(/[._+-]/)[0] ?? '';
  if (!/^[a-zA-Z]{2,}$/.test(head)) return null;
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

export function suggestedFarmName(firstName: string | null): string {
  return firstName ? `${firstName}'s Farm` : '';
}
