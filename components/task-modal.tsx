'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useSchedule, type TabState, type Task } from '@/lib/schedule-store'

const columnLabels: Record<string, string> = {
  fixed:    'Fixed Schedule',
  active:   'Active Target',
  foraging: 'Foraging Pool',
}

interface TaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, the modal edits this task. Otherwise it creates a new one. */
  task?: Task | null
  /** Required when creating: which tab the new task belongs to. */
  customTabId?: string
  /** Required when creating: which column/state the new task starts in. */
  column?: TabState
}

export function TaskModal({
  open,
  onOpenChange,
  task,
  customTabId,
  column,
}: TaskModalProps) {
  const { addTask, updateTask } = useSchedule()
  const isEditing = Boolean(task)
  const targetColumn: string = task?.currentTab ?? column ?? 'foraging'
  const showTimes = targetColumn === 'fixed'

  const [title, setTitle] = React.useState('')
  const [note, setNote] = React.useState('')
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setTitle(task?.title ?? '')
      setNote(task?.note ?? '')
      setStartTime(task?.startTime ?? '')
      setEndTime(task?.endTime ?? '')
    }
  }, [open, task])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return

    if (isEditing && task) {
      // updateTask returns false and fires a toast if the new times overlap.
      // In that case we keep the modal open so the user can correct their input.
      const ok = await updateTask(task.id, {
        title: trimmed,
        note: note.trim(),
        startTime,
        endTime,
      })
      if (ok) onOpenChange(false)
    } else if (customTabId) {
      // addTask returns false and fires a toast on overlap or active-cap violation.
      // In that case we keep the modal open so the user can correct their input.
      const ok = await addTask({
        customTabId,
        title: trimmed,
        note: note.trim(),
        startTime,
        endTime,
        currentTab: targetColumn,
      })
      if (ok) onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit task' : 'New task'}
            </DialogTitle>
            <DialogDescription>
              {columnLabels[targetColumn]}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-title">Title</FieldLabel>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Review lecture notes"
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-note">Note</FieldLabel>
              <Input
                id="task-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional detail"
              />
            </Field>
            {showTimes && (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="task-start">Start</FieldLabel>
                  <Input
                    id="task-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-end">End</FieldLabel>
                  <Input
                    id="task-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              {isEditing ? 'Save changes' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
