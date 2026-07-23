'use client'

import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { formatTime, useSchedule } from '@/lib/schedule-store'

export function MasterSchedule() {
  const { tasks, tabs } = useSchedule()

  const fixedTasks = tasks
    .filter((t) => t.currentTab === 'fixed')
    .sort((a, b) => {
      if (!a.startTime) return 1
      if (!b.startTime) return -1
      return a.startTime.localeCompare(b.startTime)
    })

  const tabName = (tabId: string | null) =>
    tabId ? (tabs.find((t) => t.id === tabId)?.title ?? 'Unknown') : 'Unknown'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          Read-only timeline
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">
          Master Finalized Schedule
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every fixed event across all context tabs, in chronological order.
        </p>
      </div>

      {fixedTasks.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing scheduled yet</EmptyTitle>
            <EmptyDescription>
              Add time-blocked events to any tab&apos;s Fixed Schedule column
              and they&apos;ll appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="relative flex flex-col gap-0">
          {fixedTasks.map((task, index) => (
            <li key={task.id} className="relative flex gap-4">
              {/* Time rail */}
              <div className="flex w-20 shrink-0 flex-col items-end pt-4 md:w-24">
                <span className="font-mono text-xs font-medium text-accent-foreground">
                  {task.startTime ? formatTime(task.startTime) : '—'}
                </span>
                {task.endTime && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatTime(task.endTime)}
                  </span>
                )}
              </div>

              {/* Rail line + dot */}
              <div className="relative flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="mt-5 size-2 shrink-0 rounded-full bg-accent-foreground"
                />
                {index < fixedTasks.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="w-px flex-1 bg-border"
                  />
                )}
              </div>

              {/* Event card */}
              <div className="mb-3 min-w-0 flex-1 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-pretty">
                    {task.title}
                  </p>
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                    {tabName(task.customTabId)}
                  </Badge>
                </div>
                {task.note && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                    {task.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
