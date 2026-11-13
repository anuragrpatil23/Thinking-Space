import { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { IGNORED_COMPANIES_CHANGED_EVENT_BLOCK, ignoredTickersBlock, setCompanyIgnoredBlock } from '@/personal_extension/thinkingspace-personal/services/lego_blocks/integrations/marketVaultBlock'

/**
 * Settings → Webull → Ignored: the companies set to Ignore (from a company
 * page's ··· menu). Each keeps its folder and old positions; here one can be
 * brought back into lists and fetches. Collapsed until opened.
 */
export function IgnoredCompaniesSettingsRowBlock({ executionFolderPath }: { executionFolderPath: string }) {
  const root = executionFolderPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const [ignored, setIgnored] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(() => { if (root) void ignoredTickersBlock(root).then(setIgnored).catch(() => setIgnored([])) }, [root])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener(IGNORED_COMPANIES_CHANGED_EVENT_BLOCK, load)
    return () => window.removeEventListener(IGNORED_COMPANIES_CHANGED_EVENT_BLOCK, load)
  }, [load])
  if (!root) return null
  const count = ignored?.length ?? 0
  return (
    <SettingsGroupBlock heading="Ignored" description="Companies kept as folders with their old positions, but not listed and never fetched. Ignore one from the ··· menu on its page.">
      <SettingsRowBlock
        label={ignored === null ? 'Ignored companies' : `${count} ignored ${count === 1 ? 'company' : 'companies'}`}
        description={count === 0 && ignored !== null ? 'None yet.' : undefined}
        control={count > 0 ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 dark:text-sky-400">
            {open ? 'Hide' : 'Show'} <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : undefined}
      />
      {open && ignored?.map(t => (
        <SettingsRowBlock
          key={t}
          label={t}
          control={(
            <button type="button" onClick={() => { void setCompanyIgnoredBlock(root, t, false) }} className="text-sm text-sky-600 hover:text-sky-700 dark:text-sky-400" title={`List and fetch ${t} again`}>
              Bring back
            </button>
          )}
        />
      ))}
    </SettingsGroupBlock>
  )
}
