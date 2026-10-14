export function cleanUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new Error("Use 3 to 30 letters or numbers. A dot or underscore is fine.");
  }
  return username;
}

export function centreEmail(username: string): string {
  return `${username}@centre.local`;
}
