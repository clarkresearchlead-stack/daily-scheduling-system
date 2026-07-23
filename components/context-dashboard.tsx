'use client'

import * as React from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabBar } from '@/components/tab-bar'
import { TaskCard } from '@/components/task-card'
import { TaskModal } from '@/components/task-modal'
import { AiSchedulerInput } from '@/components/ai-scheduler-input'
import { useSchedule, type TabState, type Task } from '@/lib/schedule-store'

const columns: {
  id: TabState
  title: string
  description: string
  emptyHint: string
}[] = [
  {
    id: 'fixed',
    title: 'Fixed Schedule',
    description: 'Time-blocked events',
    emptyHint: 'No time-blocked events yet.',
  },
  {
    id: 'active',
    title: 'Active Target',
    description: 'The single immediate focus',
    emptyHint: 'Promote a task to make it your focus.',
  },
  {
    id: 'foraging',
    title: 'Foraging Pool',
    description: 'Backlog of loose tasks',
    emptyHint: 'The backlog is clear.',
  },
]

function byStartTime(a: Task, b: Task) {
  if (!a.startTime) return 1
  if (!b.startTime) return -1
  return a.startTime.localeCompare(b.startTime)
}

export function ContextDashboard() {
  const { tabs, tasks, activeTabId } = useSchedule()
  const [addColumn, setAddColumn] = React.useState<TabState | null>(null)

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <TabBar />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No context tabs</EmptyTitle>
            <EmptyDescription>
              Create a tab with the + button to start structuring your day.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const tabTasks = tasks.filter((t) => t.customTabId === activeTabId)

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            Context Dashboard
          </p>
          <TabBar />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {columns.map((col) => {
            const colTasks = tabTasks
              .filter((t) => t.currentTab === col.id)
              .sort(col.id === 'fixed' ? byStartTime : () => 0)
            const isActiveCol = col.id === 'active'
            // Active column: hide the + button when one already exists (hard cap)
            const canAdd = !isActiveCol || colTasks.length === 0

            return (
              <section
                key={col.id}
                aria-label={col.title}
                className="flex flex-col gap-3 rounded-xl border bg-secondary/50 p-3"
              >
                <header className="flex items-start justify-between gap-2 px-1">
                  <div>
                    <h2 className="font-mono text-[11px] tracking-widest uppercase">
                      {col.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {col.description}
                    </p>
                  </div>
                  {canAdd && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setAddColumn(col.id)}
                    >
                      <PlusIcon />
                      <span className="sr-only">Add task to {col.title}</span>
                    </Button>
                  )}
                </header>

                {col.id === 'fixed' && (
                  <div className="px-1">
                    <AiSchedulerInput />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {colTasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                      {col.emptyHint}
                    </p>
                  ) : (
                    colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        highlight={isActiveCol}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <TaskModal
          open={addColumn !== null}
          onOpenChange={(open) => {
            if (!open) setAddColumn(null)
          }}
          customTabId={activeTabId}
          column={addColumn ?? 'foraging'}
        />
      </div>
    </TooltipProvider>
  )
}
