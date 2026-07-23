'use client'

import * as React from 'react'
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSchedule } from '@/lib/schedule-store'

export function TabBar() {
  const { tabs, activeTabId, setActiveTabId, addTab, renameTab, deleteTab } =
    useSchedule()

  const [addOpen, setAddOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [name, setName] = React.useState('')

  const activeTab = tabs.find((t) => t.id === activeTabId)

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    addTab(trimmed)
    setName('')
    setAddOpen(false)
  }

  function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !activeTab) return
    renameTab(activeTab.id, trimmed)
    setName('')
    setRenameOpen(false)
  }

  return (
    <div
      role="tablist"
      aria-label="Context tabs"
      className="flex flex-wrap items-center gap-1.5"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={cn(
              'flex items-center rounded-full border transition-colors',
              isActive
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                'rounded-full py-1.5 pl-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                isActive ? 'pr-1' : 'pr-3.5',
              )}
            >
              {tab.title}
            </button>
            {isActive && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mr-0.5 rounded-full text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    />
                  }
                >
                  <MoreHorizontalIcon />
                  <span className="sr-only">Tab options for {tab.title}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setName(tab.title)
                        setRenameOpen(true)
                      }}
                    >
                      <PencilIcon />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2Icon />
                      Delete tab
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <Button
        variant="outline"
        size="icon-sm"
        className="rounded-full"
        onClick={() => {
          setName('')
          setAddOpen(true)
        }}
      >
        <PlusIcon />
        <span className="sr-only">Add tab</span>
      </Button>

      {/* Add tab modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleAdd} className="contents">
            <DialogHeader>
              <DialogTitle>New context tab</DialogTitle>
              <DialogDescription>
                Name a context for a part of your day.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tab-name">Tab name</FieldLabel>
                <Input
                  id="tab-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Night Study"
                  autoFocus
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create tab</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename tab modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRename} className="contents">
            <DialogHeader>
              <DialogTitle>Rename tab</DialogTitle>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tab-rename">Tab name</FieldLabel>
                <Input
                  id="tab-rename"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete tab confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{activeTab?.title}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All tasks in this tab will move to the Deleted page, where you
              can restore them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activeTab) deleteTab(activeTab.id)
                setDeleteOpen(false)
              }}
            >
              Delete tab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
