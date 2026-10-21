/* The explorer's greeting: a line that reads like opening your own notebook
   rather than a file manager. Plain time-of-day words, and the name when the
   profile has one. */

export function greetingForHourBlock(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function explorerGreetingBlock(name: string | null | undefined, now: Date = new Date()): string {
  const greeting = greetingForHourBlock(now.getHours())
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `${greeting}, ${first}` : greeting
}

/** The greeting in two parts, so the name can carry the line and the
    salutation can sit back: { greeting: 'Good evening', name: 'Anurag' }. */
export function explorerGreetingPartsBlock(name: string | null | undefined, now: Date = new Date()): { greeting: string; name: string } {
  return {
    greeting: greetingForHourBlock(now.getHours()),
    name: (name ?? '').trim().split(/\s+/)[0] ?? '',
  }
}
