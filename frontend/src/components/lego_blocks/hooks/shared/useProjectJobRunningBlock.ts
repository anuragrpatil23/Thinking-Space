import { useEffect, useState } from 'react'
import {
  listRunningJobsBlock,
  subscribeRunningJobsBlock,
  type RunningJob,
} from '@/services/lego_blocks/units/intelligence/runningJobsBlock'

// Is a model job for this project, inside this date range, running right now?
//
// Distinct from "is my summary still loading": range summaries go through one
// shared queue, so most loading rows are only *waiting*. Marking every waiting
// row as busy said a dozen things were in progress when one was.
//
// Event-driven (the registry emits on start/finish), and subscribed only while
// `enabled`, so a settled card holds no listener at all.

function localDayOf(dateIso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso
  const d = new Date(dateIso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function matches(job: RunningJob, projectId: string, rangeStartDate: string, rangeEndDate: string): boolean {
  if (job.project !== projectId) return false
  if (!job.dateIso) return true
  const day = localDayOf(job.dateIso)
  return day >= rangeStartDate && day <= rangeEndDate
}

export function useProjectJobRunningBlock(
  projectId: string,
  rangeStartDate: string,
  rangeEndDate: string,
  enabled: boolean,
): boolean {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setRunning(false)
      return
    }
    const sync = () =>
      setRunning(listRunningJobsBlock().some(j => matches(j, projectId, rangeStartDate, rangeEndDate)))
    sync()
    return subscribeRunningJobsBlock(sync)
  }, [enabled, projectId, rangeStartDate, rangeEndDate])
  return running
}
