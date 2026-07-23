'use client'

import * as React from 'react'
import {
  ArchiveIcon,
  CalendarClockIcon,
  CrosshairIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TaskModal } from '@/components/task-modal'
import { cn } from '@/lib/utils'
import {
  formatTime,
  useSchedule,
  type TabState,
  type Task,
} from '@/lib/schedule-store'

const moveTargets: Record<
  string,
  { destination: TabState; label: string; icon: React.ElementType }[]
> = {
  fixed: [
    { destination: 'active',   label: 'Set as Active Target',   icon: CrosshairIcon },
    { destination: 'foraging', label: 'Send to Foraging Pool',  icon: ArchiveIcon },
  ],
  active: [
    { destination: 'fixed',    label: 'Move to Fixed Schedule', icon: CalendarClockIcon },
    { destination: 'foraging', label: 'Send to Foraging Pool',  icon: ArchiveIcon },
  ],
  foraging: [
    { destination: 'active',   label: 'Set as Active Target',   icon: CrosshairIcon },
    { destination: 'fixed',    label: 'Move to Fixed Schedule', icon: CalendarClockIcon },
  ],
}

export function TaskCard({
  task,
  highlight = false,
}: {
  task: Task
  highlight?: boolean
}) {
  const { moveTask, deleteTask } = useSchedule()
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const timeRange =
    task.currentTab === 'fixed' && task.startTime
      ? `${formatTime(task.startTime)}${task.endTime ? ` – ${formatTime(task.endTime)}` : ''}`
      : ''

  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-3 transition-colors',
        highlight && 'border-accent-foreground/30 bg-accent/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {timeRange && (
            <p className="font-mono text-[11px] tracking-wide text-accent-foreground uppercase">
              {timeRange}
            </p>
          )}
          <p className="text-sm leading-snug font-medium text-pretty">
            {task.title}
          </p>
          {task.note && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground text-pretty">
              {task.note}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {(moveTargets[task.currentTab] ?? []).map((target) => (
          <Tooltip key={target.destination}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveTask(task.id, target.destination)}
                />
              }
            >
              <target.icon />
              <span className="sr-only">{target.label}</span>
            </TooltipTrigger>
            <TooltipContent>{target.label}</TooltipContent>
          </Tooltip>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setEditOpen(true)}
                />
              }
            >
              <PencilIcon />
              <span className="sr-only">Edit task</span>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                />
              }
            >
              <Trash2Icon />
              <span className="sr-only">Delete task</span>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <TaskModal open={editOpen} onOpenChange={setEditOpen} task={task} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{task.title}&rdquo; will move to the Deleted page, where
              you can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteOpen(false)
                deleteTask(task.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
