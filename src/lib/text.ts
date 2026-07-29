/** Capitalize the first letter of each word, leaving the rest of each word untouched. */
export function capitalizeName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
