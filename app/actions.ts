'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { TabState } from '@/lib/schedule-store'

// ─── Validation Helpers ───────────────────────────────────────────────────────

function isValidTabState(state: string): state is TabState {
  return ['fixed', 'active', 'foraging'].includes(state)
}

function isValidCurrentTabState(state: string): boolean {
  return ['fixed', 'active', 'foraging', 'deleted'].includes(state)
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false
  return aStart < bEnd && aEnd > bStart
}

type TransactionClient = Prisma.TransactionClient
type OverlapQueryClient = Pick<TransactionClient, 'task'>

class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

function isRetryablePrismaError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code
    return code === 'P2034'
  }
  if (err instanceof Error && /SQLITE_BUSY|database is locked/i.test(err.message)) {
    return true
  }
  return false
}

async function withDbRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof ActionError) throw err
      lastError = err
      if (!isRetryablePrismaError(err) || attempt === maxAttempts) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
  throw lastError
}

function handleDbActionError(err: unknown): { success: false; error: string } {
  console.error('[DB_ACTION_ERROR]', err)
  if (err instanceof ActionError) {
    return { success: false, error: err.message }
  }
  if (isRetryablePrismaError(err)) {
    return { success: false, error: 'Database is busy. Please try again.' }
  }
  return { success: false, error: 'An unexpected error occurred.' }
}

async function hasFixedOverlapTx(
  tx: OverlapQueryClient,
  newStart: string,
  newEnd: string,
  excludeId?: string,
): Promise<boolean> {
  const fixedTasks = await tx.task.findMany({
    where: {
      currentTab: 'fixed',
      id: { not: excludeId },
    },
  })

  return fixedTasks.some((t) => timesOverlap(newStart, newEnd, t.startTime, t.endTime))
}

// ─── Tab Actions ──────────────────────────────────────────────────────────────

export async function createTab(title: string) {
  const position = await prisma.customTab.count()
  const tab = await prisma.customTab.create({
    data: {
      title,
      position,
    },
  })
  revalidatePath('/')
  return tab
}

export async function renameTab(id: string, title: string) {
  const tab = await prisma.customTab.update({
    where: { id },
    data: { title },
  })
  revalidatePath('/')
  return tab
}

export async function deleteTab(id: string) {
  // Tab Deletion Cascade:
  // Instead of relying on Prisma's onDelete: Cascade to hard-delete tasks,
  // we must soft-delete them first per the business logic rules, THEN delete the tab.
  const tab = await prisma.customTab.findUnique({ where: { id } })
  if (!tab) return { success: false, error: 'Tab not found' }

  await prisma.$transaction([
    prisma.task.updateMany({
      where: { customTabId: id },
      data: {
        customTabId: null, // Detach from parent so it survives deletion
        currentTab: 'deleted',
        deletedAt: new Date(),
        tabName: tab.title,
      },
    }),
    prisma.customTab.delete({ where: { id } }),
  ])

  revalidatePath('/')
  return { success: true }
}

// ─── Task Actions ─────────────────────────────────────────────────────────────

export async function createTask(data: {
  customTabId: string
  title: string
  note?: string
  startTime?: string
  endTime?: string
  currentTab: string
  id?: string
}) {
  const { customTabId, title, note, startTime, endTime, currentTab, id } = data

  if (!isValidCurrentTabState(currentTab) || currentTab === 'deleted') {
    return { success: false, error: 'Invalid currentTab state.' }
  }

  if (startTime && endTime) {
    if (startTime >= endTime) {
      return { success: false, error: 'End time must be after start time.' }
    }
  }

  try {
    const task = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        if (currentTab === 'active') {
          const activeExists = await tx.task.findFirst({
            where: { currentTab: 'active', customTabId },
          })
          if (activeExists) {
            throw new ActionError('Each tab can only have one Active Target.')
          }
        }

        if (currentTab === 'fixed' && startTime && endTime) {
          if (await hasFixedOverlapTx(tx, startTime, endTime)) {
            throw new ActionError('Time slot overlaps with an existing schedule.')
          }
        }

        return tx.task.create({
          data: {
            ...(id ? { id } : {}),
            customTabId,
            title,
            note: note ?? '',
            startTime: startTime ?? '',
            endTime: endTime ?? '',
            currentTab,
            originTab: currentTab,
          },
        })
      }),
    )

    revalidatePath('/')
    return { success: true, task }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function createTasksBatch(
  tasksData: Array<{
    customTabId: string
    title: string
    note?: string
    startTime?: string
    endTime?: string
    currentTab: string
    id?: string
  }>,
) {
  if (!tasksData.length) return { success: true, tasks: [] }

  // 1. Validation Checks on the input array
  for (const data of tasksData) {
    if (data.currentTab !== 'fixed') {
      return { success: false, error: 'AI Auto-Schedule can only populate the Fixed Schedule.' }
    }

    if (data.startTime && data.endTime) {
      if (data.startTime >= data.endTime) {
        return {
          success: false,
          error: `Task "${data.title}" has an invalid end time (must be after start time).`,
        }
      }
    }
  }

  // 2. Intra-batch Overlap Check (check if AI proposed overlapping tasks within its own batch)
  for (let i = 0; i < tasksData.length; i++) {
    for (let j = i + 1; j < tasksData.length; j++) {
      const a = tasksData[i]
      const b = tasksData[j]
      if (a.startTime && a.endTime && b.startTime && b.endTime) {
        if (timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          return {
            success: false,
            error: `AI proposed overlapping time slots: "${a.title}" and "${b.title}".`,
          }
        }
      }
    }
  }

  // 3. Database Transaction Check against existing records (All-Or-Nothing)
  try {
    const createdTasks = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const existingFixed = await tx.task.findMany({
          where: { currentTab: 'fixed' },
        })

        for (const data of tasksData) {
          if (data.startTime && data.endTime) {
            const overlaps = existingFixed.some((t) =>
              timesOverlap(data.startTime!, data.endTime!, t.startTime, t.endTime),
            )
            if (overlaps) {
              throw new ActionError(
                `Schedule conflict: "${data.title}" overlaps with an existing fixed task.`,
              )
            }
          }
        }

        const results = []
        for (const data of tasksData) {
          const task = await tx.task.create({
            data: {
              ...(data.id ? { id: data.id } : {}),
              customTabId: data.customTabId,
              title: data.title,
              note: data.note ?? '',
              startTime: data.startTime ?? '',
              endTime: data.endTime ?? '',
              currentTab: 'fixed',
              originTab: 'fixed',
            },
          })
          results.push(task)
        }
        return results
      }),
    )

    revalidatePath('/')
    return { success: true, tasks: createdTasks }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function updateTask(
  id: string,
  patch: { title?: string; note?: string; startTime?: string; endTime?: string },
) {
  const { title, note, startTime, endTime } = patch

  const sanitized: {
    title?: string
    note?: string
    startTime?: string
    endTime?: string
  } = {}

  if (title !== undefined) sanitized.title = title
  if (note !== undefined) sanitized.note = note
  if (startTime !== undefined) sanitized.startTime = startTime
  if (endTime !== undefined) sanitized.endTime = endTime

  if (Object.keys(sanitized).length === 0) {
    return { success: false, error: 'No valid fields to update.' }
  }

  const task = await prisma.task.findUnique({ where: { id } })
  if (!task) return { success: false, error: 'Task not found' }

  if (task.currentTab === 'fixed') {
    const newStart = sanitized.startTime ?? task.startTime
    const newEnd = sanitized.endTime ?? task.endTime

    if (newStart && newEnd) {
      if (newStart >= newEnd) {
        return { success: false, error: 'End time must be after start time.' }
      }

      if (await hasFixedOverlapTx(prisma, newStart, newEnd, id)) {
        return { success: false, error: 'Time slot overlaps with an existing schedule.' }
      }
    }
  }

  try {
    const updated = await prisma.task.update({
      where: { id },
      data: sanitized,
    })

    revalidatePath('/')
    return { success: true, task: updated }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function moveTask(id: string, destination: string) {
  if (!isValidCurrentTabState(destination) || destination === 'deleted') {
    return { success: false, error: 'Invalid destination state.' }
  }

  try {
    const updated = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const task = await tx.task.findUnique({ where: { id } })
        if (!task) throw new ActionError('Task not found')

        if (destination === 'fixed') {
          if (task.startTime && task.endTime) {
            if (task.startTime >= task.endTime) {
              throw new ActionError('End time must be after start time.')
            }
            if (await hasFixedOverlapTx(tx, task.startTime, task.endTime, id)) {
              throw new ActionError('Time slot overlaps with an existing schedule.')
            }
          }
        }

        if (destination === 'active') {
          const activeExists = await tx.task.findFirst({
            where: {
              id: { not: id },
              currentTab: 'active',
              customTabId: task.customTabId,
            },
          })
          if (activeExists) {
            throw new ActionError('Each tab can only have one Active Target.')
          }
        }

        return tx.task.update({
          where: { id },
          data: { currentTab: destination },
        })
      }),
    )

    revalidatePath('/')
    return { success: true, task: updated }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function softDeleteTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: { customTab: true },
  })
  if (!task) return { success: false, error: 'Task not found' }

  await prisma.task.update({
    where: { id },
    data: {
      currentTab: 'deleted',
      deletedAt: new Date(),
      tabName: task.customTab?.title ?? 'Unknown',
    },
  })

  revalidatePath('/')
  return { success: true }
}

export async function restoreTask(id: string) {
  try {
    const result = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const task = await tx.task.findUnique({ where: { id } })
        if (!task || task.currentTab !== 'deleted') {
          throw new ActionError('Task not found or not deleted')
        }

        let restoredCustomTabId = task.customTabId
        const tabExists = task.customTabId
          ? await tx.customTab.findUnique({ where: { id: task.customTabId } })
          : null

        if (!tabExists) {
          const firstTab = await tx.customTab.findFirst({ orderBy: { position: 'asc' } })
          if (!firstTab) throw new ActionError('No tabs left to restore into')
          restoredCustomTabId = firstTab.id
        }

        let restoredCurrentTab = isValidTabState(task.originTab) ? task.originTab : 'foraging'
        let collisionReason: string | null = null

        if (restoredCurrentTab === 'fixed' && task.startTime && task.endTime) {
          if (await hasFixedOverlapTx(tx, task.startTime, task.endTime)) {
            restoredCurrentTab = 'foraging'
            collisionReason = "couldn't reclaim its original time slot"
          }
        }

        if (restoredCurrentTab === 'active') {
          const activeExists = await tx.task.findFirst({
            where: { currentTab: 'active', customTabId: restoredCustomTabId },
          })
          if (activeExists) {
            restoredCurrentTab = 'foraging'
            collisionReason = "couldn't restore to Active Target (slot already occupied)"
          }
        }

        const updated = await tx.task.update({
          where: { id },
          data: {
            customTabId: restoredCustomTabId,
            currentTab: restoredCurrentTab,
            deletedAt: null,
            tabName: null,
          },
        })

        return { task: updated, collisionReason }
      }),
    )

    revalidatePath('/')
    return { success: true, task: result.task, collisionReason: result.collisionReason }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function permanentlyDeleteTask(id: string) {
  await prisma.task.delete({ where: { id } })
  revalidatePath('/')
  return { success: true }
}
