import { Suspense, lazy } from 'react'
import ActivityHotspotBlock from '@/components/lego_blocks/integrations/ActivityHotspotBlock'

// Code-split boundary: keeps recharts out of the startup bundle.
const DashboardChartsBlock = lazy(() => import('@/components/lego_blocks/integrations/DashboardChartsBlock'))
import type { UseDashboardActivityResult } from '@/components/lego_blocks/hooks/shared/useDashboardActivityBlock'

interface HomeDashboardOrchProps {
  activity: UseDashboardActivityResult
}

export default function HomeDashboardOrch({ activity }: HomeDashboardOrchProps) {
  const { series, loading, error, preset, setPreset, startIso, endIso } = activity

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <DashboardChartsBlock
          series={series}
          loading={loading}
          error={error}
          preset={preset}
          onPresetChange={setPreset}
        />
      </Suspense>

      <ActivityHotspotBlock
        days={series?.days ?? []}
        loading={loading}
        startIso={startIso}
        endIso={endIso}
      />
    </div>
  )
}
