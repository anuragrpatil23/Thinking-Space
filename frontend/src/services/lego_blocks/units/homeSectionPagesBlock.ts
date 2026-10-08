// The Home sections that have a full-screen page of their own on a phone, with
// the route and title of each. Lives here, not in the page component, so Home
// can push these paths from its tiles without importing the page.

export type HomeSectionBlock = 'ai-activity' | 'worked-on' | 'board'

export const HOME_SECTION_PAGES_BLOCK: Record<HomeSectionBlock, { path: string; title: string }> = {
  'ai-activity': { path: '/ai-activity', title: 'AI activity' },
  'worked-on': { path: '/worked-on', title: 'What you worked on' },
  board: { path: '/board', title: 'Board' },
}
