'use client'

import * as React from 'react'
import { RotateCcwIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { formatDeletedAt, useSchedule } from '@/lib/schedule-store'

const originLabels: Record<string, string> = {
  fixed:    'Fixed',
  active:   'Active',
  foraging: 'Foraging',
}

export function DeletedItems() {
  const { deleted, restoreTask, permanentlyDeleteTask } = useSchedule()
  const [confirmId, setConfirmId] = React.useState<string | null>(null)

  const confirmTarget = deleted.find((t) => t.id === confirmId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          Global archive
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">
          Deleted Items
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tasks removed from any tab land here. Restore them or remove them
          for good.
        </p>
      </div>

      {deleted.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing deleted</EmptyTitle>
            <EmptyDescription>
              Deleted tasks will appear here with their deletion timestamps.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {deleted.map((task) => (
            <li
              key={task.id}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-pretty">
                    {task.title}
                  </p>
                  {/* Tab snapshot — where the task lived */}
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] uppercase"
                  >
                    {task.tabName}
                  </Badge>
                  {/* Origin column badge — where the task was born */}
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] uppercase text-muted-foreground"
                  >
                    {originLabels[task.originTab]}
                  </Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                  Deleted {formatDeletedAt(task.deletedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restoreTask(task.id)}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmId(task.id)}
                >
                  <XIcon data-icon="inline-start" />
                  Permanently Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirmTarget?.title}&rdquo; will be removed forever.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmId) permanentlyDeleteTask(confirmId)
                setConfirmId(null)
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
