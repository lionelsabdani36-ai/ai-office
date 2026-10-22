export const navigation = ['Office', 'Dispatch & Team', 'Task Board', 'Agents', 'Usage', 'Calendar', 'Activity', 'Memory', 'Folders', 'Logs', 'Settings'] as const
export type Page = typeof navigation[number]

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

export function pageSlug(page: Page): string {
  return page.toLowerCase().replace(/&/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function pageFromHash(hash: string): Page {
  const slug = hash.replace(/^[#/]+/, '').split('/')[0].split('?')[0].toLowerCase()
  if (slug === 'knowledge') return 'Memory'
  // The Dashboard's statistics now live in the Office HUD and panel.
  if (slug === 'dashboard') return 'Office'
  if (slug === 'dispatch-team' || slug === 'dispatch-&-team' || slug === 'dispatch' || slug === 'team') return 'Dispatch & Team'
  return navigation.find((page) => pageSlug(page) === slug) ?? HOME
}
