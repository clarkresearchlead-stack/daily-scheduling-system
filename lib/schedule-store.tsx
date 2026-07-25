'use client'

import * as React from 'react'
import { useToast } from '@/components/ui/toast'
import * as actions from '@/app/actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TabState = 'fixed' | 'active' | 'foraging' | 'deleted'
export type ColumnId = 'fixed' | 'active' | 'foraging'

export interface CustomTab {
  id: string
  title: string
  position: number
}

export interface Task {
  id: string
  customTabId: string | null
  title: string
  note: string
  startTime: string
  endTime: string
  currentTab: string
  originTab: string
  deletedAt?: Date | string | null
  tabName?: string | null
}

export interface DeletedTask extends Task {
  currentTab: 'deleted'
  deletedAt: Date | string
  tabName: string
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface ScheduleState {
  tabs: CustomTab[]
  tasks: Task[]
  deleted: DeletedTask[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  addTab: (title: string) => void
  renameTab: (id: string, title: string) => void
  deleteTab: (id: string) => void
  addTask: (task: Omit<Task, 'id' | 'originTab'>) => Promise<boolean>
  addTasksBatch: (tasks: Omit<Task, 'id' | 'originTab'>[]) => Promise<boolean>
  updateTask: (
    id: string,
    patch: Partial<Pick<Task, 'title' | 'note' | 'startTime' | 'endTime'>>,
  ) => Promise<boolean>
  moveTask: (id: string, destination: TabState) => Promise<boolean>
  deleteTask: (id: string) => void
  restoreTask: (id: string) => void
  permanentlyDeleteTask: (id: string) => void
}

const ScheduleContext = React.createContext<ScheduleState | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ScheduleProvider({ 
  children, 
  initialTabs, 
  initialTasks 
}: { 
  children: React.ReactNode
  initialTabs: CustomTab[]
  initialTasks: Task[]
}) {
  const { toast } = useToast()

  const [tabs, setTabs] = React.useState<CustomTab[]>(initialTabs)
  
  const liveTasks = initialTasks.filter(t => t.currentTab !== 'deleted')
  const deletedTasks = initialTasks.filter(t => t.currentTab === 'deleted') as DeletedTask[]
  
  const [tasks, setTasks] = React.useState<Task[]>(liveTasks)
  const [deleted, setDeleted] = React.useState<DeletedTask[]>(deletedTasks)
  const [activeTabId, setActiveTabId] = React.useState<string>(
    initialTabs[0]?.id ?? '',
  )

  // ── Tab operations ──────────────────────────────────────────────────────────

  const addTab = React.useCallback(async (title: string) => {
    const prevActiveId = activeTabId
    const optimisticId = crypto.randomUUID()
    
    // Optimistic
    setTabs((prev) => [...prev, { id: optimisticId, title, position: prev.length }])
    setActiveTabId(optimisticId)

    try {
      const newTab = await actions.createTab(title)
      // Update with real ID
      setTabs((prev) => prev.map(t => t.id === optimisticId ? newTab : t))
      setActiveTabId((current) => current === optimisticId ? newTab.id : current)
    } catch (err) {
      setTabs((prev) => prev.filter(t => t.id !== optimisticId))
      setActiveTabId(prevActiveId)
      toast.error('Failed to create tab')
    }
  }, [activeTabId, toast])

  const renameTab = React.useCallback(async (id: string, title: string) => {
    const originalTab = tabs.find(t => t.id === id)
    if (!originalTab) return

    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)))
    
    try {
      await actions.renameTab(id, title)
    } catch (err) {
      setTabs((prev) => prev.map((t) => (t.id === id ? originalTab : t)))
      toast.error('Failed to rename tab')
    }
  }, [tabs, toast])

  const deleteTab = React.useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      const prevActiveId = activeTabId
      const prevTabs = [...tabs]
      const prevTasks = [...tasks]
      const prevDeleted = [...deleted]

      const now = new Date().toISOString()
      const orphaned = tasks.filter((t) => t.customTabId === id)
      
      // Optimistic cascade
      if (orphaned.length > 0) {
        setDeleted((prev) => [
          ...orphaned.map((t): DeletedTask => ({ ...t, currentTab: 'deleted', deletedAt: now, tabName: tab.title })),
          ...prev,
        ])
        setTasks((prev) => prev.filter((t) => t.customTabId !== id))
      }

      const nextTabs = tabs.filter((t) => t.id !== id).map((t, i) => ({ ...t, position: i }))
      setTabs(nextTabs)
      setActiveTabId((current) => current === id ? (nextTabs[0]?.id ?? '') : current)

      // Server Action
      const res = await actions.deleteTab(id)
      if (!res.success) {
        setTabs(prevTabs)
        setTasks(prevTasks)
        setDeleted(prevDeleted)
        setActiveTabId(prevActiveId)
        toast.error(res.error ?? 'Failed to delete tab')
      }
    },
    [tabs, tasks, deleted, activeTabId, toast],
  )

  // ── Task operations ─────────────────────────────────────────────────────────

  const addTask = React.useCallback(
    async (taskData: Omit<Task, 'id' | 'originTab'>): Promise<boolean> => {
      const id = crypto.randomUUID()
      
      const optimisticTask: Task = {
        ...taskData,
        id,
        originTab: taskData.currentTab,
      }
      
      setTasks((prev) => [...prev, optimisticTask])

      // Server Action (Validation runs securely on the backend)
      const res = await actions.createTask(optimisticTask as any)
      
      if (!res.success) {
        // Revert UI on validation failure
        setTasks((prev) => prev.filter((t) => t.id !== id))
        toast.error(('error' in res ? res.error : null) ?? 'Failed to create task')
        return false
      }
      
      // Update with the real database ID
      setTasks(prev => prev.map(t => t.id === id ? (res.task as Task) : t))
      return true
    },
    [toast],
  )

  const addTasksBatch = React.useCallback(
    async (batchData: Omit<Task, 'id' | 'originTab'>[]): Promise<boolean> => {
      if (!batchData.length) return true

      const optimisticTasks: Task[] = batchData.map((taskData) => ({
        ...taskData,
        id: crypto.randomUUID(),
        originTab: taskData.currentTab,
      }))

      const optimisticIds = new Set(optimisticTasks.map((t) => t.id))

      // Optimistically add all tasks at once
      setTasks((prev) => [...prev, ...optimisticTasks])

      // Server Action call (All-or-nothing batch creation)
      const res = await actions.createTasksBatch(optimisticTasks as any)

      if (!res.success) {
        // Revert ALL optimistic tasks simultaneously on failure
        setTasks((prev) => prev.filter((t) => !optimisticIds.has(t.id)))
        toast.error(('error' in res ? res.error : null) ?? 'Failed to create schedule batch')
        return false
      }

      // Replace optimistic tasks with real DB tasks
      const createdTasks = res.tasks as Task[]
      const dbTaskMap = new Map(createdTasks.map((t) => [t.id, t]))

      setTasks((prev) =>
        prev.map((t) => (dbTaskMap.has(t.id) ? dbTaskMap.get(t.id)! : t)),
      )

      return true
    },
    [toast],
  )

  const updateTask = React.useCallback(
    async (
      id: string,
      patch: Partial<Pick<Task, 'title' | 'note' | 'startTime' | 'endTime'>>,
    ): Promise<boolean> => {
      const task = tasks.find((t) => t.id === id)
      if (!task) return false

      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

      const res = await actions.updateTask(id, patch)
      
      if (!res.success) {
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)))
        toast.error(res.error ?? 'Failed to update task')
        return false
      }

      setTasks(prev => prev.map(t => t.id === id ? (res.task as Task) : t))
      return true
    },
    [tasks, toast],
  )

  const moveTask = React.useCallback(
    async (id: string, destination: TabState): Promise<boolean> => {
      const task = tasks.find((t) => t.id === id)
      if (!task) return false

      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, currentTab: destination } : t))

      const res = await actions.moveTask(id, destination)
      
      if (!res.success) {
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)))
        toast.error(res.error ?? 'Failed to move task')
        return false
      }

      setTasks(prev => prev.map(t => t.id === id ? (res.task as Task) : t))
      return true
    },
    [tasks, toast],
  )

  const deleteTask = React.useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id)
      if (!task) return
      
      const tabName = tabs.find((t) => t.id === task.customTabId)?.title ?? 'Unknown'

      setDeleted((prev) => [
        { ...task, currentTab: 'deleted', deletedAt: new Date().toISOString(), tabName },
        ...prev,
      ])
      setTasks((prev) => prev.filter((t) => t.id !== id))

      const res = await actions.softDeleteTask(id)
      if (!res.success) {
        setTasks((prev) => [...prev, task])
        setDeleted((prev) => prev.filter((t) => t.id !== id))
        toast.error(res.error ?? 'Failed to delete task')
      }
    },
    [tabs, tasks, toast],
  )

  const restoreTask = React.useCallback(
    async (id: string) => {
      const item = deleted.find((t) => t.id === id)
      if (!item) return

      // We perform the restore optimistically but the true collision logic
      // resides safely on the server. We will let the server's return value
      // dictate the final state if there's a collision.
      setDeleted((prev) => prev.filter((t) => t.id !== id))
      
      const res = await actions.restoreTask(id)
      
      if (!res.success) {
        setDeleted((prev) => [item, ...prev])
        toast.error(('error' in res ? res.error : null) ?? 'Failed to restore task')
        return
      }

      // Sync the exact DB state (which includes fallback customTabId and collision routing)
      setTasks((prev) => [...prev, res.task as Task])
      
      if (res.collisionReason) {
        toast.warning(`"${item.title}" ${res.collisionReason} — restored to Foraging Pool instead.`)
      }
    },
    [deleted, toast],
  )

  const permanentlyDeleteTask = React.useCallback(async (id: string) => {
    const item = deleted.find(t => t.id === id)
    if (!item) return

    setDeleted((prev) => prev.filter((t) => t.id !== id))
    
    const res = await actions.permanentlyDeleteTask(id)
    if (!res.success) {
      setDeleted((prev) => [item, ...prev])
      toast.error('Failed to permanently delete task')
    }
  }, [deleted, toast])

  const value = React.useMemo<ScheduleState>(
    () => ({
      tabs,
      tasks,
      deleted,
      activeTabId,
      setActiveTabId,
      addTab,
      renameTab,
      deleteTab,
      addTask,
      addTasksBatch,
      updateTask,
      moveTask,
      deleteTask,
      restoreTask,
      permanentlyDeleteTask,
    }),
    [
      tabs,
      tasks,
      deleted,
      activeTabId,
      addTab,
      renameTab,
      deleteTab,
      addTask,
      addTasksBatch,
      updateTask,
      moveTask,
      deleteTask,
      restoreTask,
      permanentlyDeleteTask,
    ],
  )

  return (
    <ScheduleContext.Provider value={value}>
      {children}
    </ScheduleContext.Provider>
  )
}

export function useSchedule() {
  const ctx = React.useContext(ScheduleContext)
  if (!ctx) {
    throw new Error('useSchedule must be used within a ScheduleProvider')
  }
  return ctx
}

export function formatTime(time: string) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function formatDeletedAt(val: Date | string | null | undefined) {
  if (!val) return ''
  const d = new Date(val)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
