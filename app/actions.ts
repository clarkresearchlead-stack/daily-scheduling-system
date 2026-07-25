'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { TabState } from '@/lib/schedule-store'

// ─── Validation ───────────────────────────────────────────────────────────────

/** Zero-padded 24h clock. Lexicographic compare is safe only in this form. */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isValidTabState(state: string): state is TabState {
  return ['fixed', 'active', 'foraging'].includes(state)
}

function isValidCurrentTabState(state: string): boolean {
  return ['fixed', 'active', 'foraging', 'deleted'].includes(state)
}

/**
 * Half-open interval overlap: [start, end).
 * Back-to-back blocks (09:00–10:00 and 10:00–11:00) do NOT overlap.
 * Overnight ranges are rejected upstream (same-day only).
 */
function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false
  return aStart < bEnd && aEnd > bStart
}

function assertSameDayRange(startTime: string, endTime: string): string | null {
  if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) {
    return 'Time must be HH:MM in 24-hour format (e.g. "09:00").'
  }
  if (startTime >= endTime) {
    return 'End time must be after start time. Overnight (midnight-crossing) blocks are not supported.'
  }
  return null
}

const createTaskSchema = z
  .object({
    customTabId: z.string().uuid(),
    title: z.string().trim().min(1, 'Title is required.').max(200),
    note: z.string().max(2000).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    currentTab: z.enum(['fixed', 'active', 'foraging']),
    id: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.currentTab !== 'fixed') return

    if (!data.startTime || !data.endTime) {
      ctx.addIssue({
        code: 'custom',
        message: 'Fixed schedule tasks require both start and end times.',
      })
      return
    }

    const rangeError = assertSameDayRange(data.startTime, data.endTime)
    if (rangeError) {
      ctx.addIssue({ code: 'custom', message: rangeError })
    }
  })

const createTasksBatchSchema = z
  .array(createTaskSchema)
  .min(1)
  .superRefine((tasks, ctx) => {
    for (const task of tasks) {
      if (task.currentTab !== 'fixed') {
        ctx.addIssue({
          code: 'custom',
          message: 'AI Auto-Schedule can only populate the Fixed Schedule.',
        })
        return
      }
    }

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i]
        const b = tasks[j]
        if (
          a.startTime &&
          a.endTime &&
          b.startTime &&
          b.endTime &&
          timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `AI proposed overlapping time slots: "${a.title}" and "${b.title}".`,
          })
          return
        }
      }
    }
  })

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(2000).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
})

// ─── DB helpers ───────────────────────────────────────────────────────────────

type TransactionClient = Prisma.TransactionClient
type OverlapQueryClient = Pick<TransactionClient, 'task'>

/** Serializable + short timeout; pairs with P2034 retry for concurrent writers. */
const SCHEDULE_TX = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const

/** DB-wide xact lock so concurrent Auto-Schedule clicks cannot both insert overlaps. */
const FIXED_SCHEDULE_LOCK_KEY = 872_014

class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

function isRetryablePrismaError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code
    // P2034: write conflict / deadlock (Serializable retries)
    // P2024: timed out fetching a connection from the pool (Neon under load)
    return code === 'P2034' || code === 'P2024'
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
  if (err instanceof z.ZodError) {
    return { success: false, error: err.issues[0]?.message ?? 'Invalid input.' }
  }
  if (isRetryablePrismaError(err)) {
    return { success: false, error: 'Database is busy. Please try again.' }
  }
  return { success: false, error: 'Something went wrong. Please try again.' }
}

function revalidateSchedule() {
  // Root layout loads tabs/tasks — must invalidate the layout tree, not only `/`.
  revalidatePath('/', 'layout')
  revalidatePath('/master-schedule')
  revalidatePath('/deleted')
}

async function lockFixedSchedule(tx: TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FIXED_SCHEDULE_LOCK_KEY})`
}

/**
 * Overlap check pushed to Postgres using half-open string compare on zero-padded HH:MM.
 * Relies on @@index([currentTab, startTime, endTime]).
 */
async function hasFixedOverlapTx(
  tx: OverlapQueryClient,
  newStart: string,
  newEnd: string,
  excludeId?: string,
): Promise<boolean> {
  const conflict = await tx.task.findFirst({
    where: {
      currentTab: 'fixed',
      id: excludeId ? { not: excludeId } : undefined,
      startTime: { not: '', lt: newEnd },
      endTime: { not: '', gt: newStart },
    },
    select: { id: true },
  })
  return conflict !== null
}

// ─── Tab Actions ──────────────────────────────────────────────────────────────

export async function createTab(title: string) {
  try {
    const parsedTitle = z.string().trim().min(1).max(80).parse(title)
    const tab = await prisma.$transaction(async (tx) => {
      const position = await tx.customTab.count()
      return tx.customTab.create({
        data: { title: parsedTitle, position },
      })
    })
    revalidateSchedule()
    return tab
  } catch (err) {
    console.error('[createTab]', err)
    throw err instanceof z.ZodError ? new Error(err.issues[0]?.message ?? 'Invalid title') : err
  }
}

export async function renameTab(id: string, title: string) {
  try {
    const parsedTitle = z.string().trim().min(1).max(80).parse(title)
    const tab = await prisma.customTab.update({
      where: { id },
      data: { title: parsedTitle },
    })
    revalidateSchedule()
    return tab
  } catch (err) {
    console.error('[renameTab]', err)
    throw err instanceof z.ZodError ? new Error(err.issues[0]?.message ?? 'Invalid title') : err
  }
}

export async function deleteTab(id: string) {
  try {
    const tab = await prisma.customTab.findUnique({ where: { id } })
    if (!tab) return { success: false, error: 'Tab not found' }

    await prisma.$transaction([
      prisma.task.updateMany({
        where: { customTabId: id },
        data: {
          customTabId: null,
          currentTab: 'deleted',
          deletedAt: new Date(),
          tabName: tab.title,
        },
      }),
      prisma.customTab.delete({ where: { id } }),
    ])

    revalidateSchedule()
    return { success: true }
  } catch (err) {
    return handleDbActionError(err)
  }
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
  try {
    const parsed = createTaskSchema.parse(data)
    const { customTabId, title, note, startTime, endTime, currentTab, id } = parsed

    const task = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        if (currentTab === 'fixed') {
          await lockFixedSchedule(tx)
        }

        if (currentTab === 'active') {
          const activeExists = await tx.task.findFirst({
            where: { currentTab: 'active', customTabId },
            select: { id: true },
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
      }, SCHEDULE_TX),
    )

    revalidateSchedule()
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

  try {
    const parsed = createTasksBatchSchema.parse(tasksData)

    const createdTasks = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        // Serialize concurrent Auto-Schedule / fixed writes across serverless isolates.
        await lockFixedSchedule(tx)

        const existingFixed = await tx.task.findMany({
          where: {
            currentTab: 'fixed',
            startTime: { not: '' },
            endTime: { not: '' },
          },
          select: { id: true, title: true, startTime: true, endTime: true },
        })

        for (const data of parsed) {
          const overlaps = existingFixed.some((t) =>
            timesOverlap(data.startTime!, data.endTime!, t.startTime, t.endTime),
          )
          if (overlaps) {
            throw new ActionError(
              `Schedule conflict: "${data.title}" overlaps with an existing fixed task.`,
            )
          }
        }

        const results = []
        for (const data of parsed) {
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
          existingFixed.push({
            id: task.id,
            title: task.title,
            startTime: task.startTime,
            endTime: task.endTime,
          })
        }
        return results
      }, SCHEDULE_TX),
    )

    revalidateSchedule()
    return { success: true, tasks: createdTasks }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function updateTask(
  id: string,
  patch: { title?: string; note?: string; startTime?: string; endTime?: string },
) {
  try {
    const sanitized = updateTaskSchema.parse(patch)
    if (Object.keys(sanitized).length === 0) {
      return { success: false, error: 'No valid fields to update.' }
    }

    const updated = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const task = await tx.task.findUnique({ where: { id } })
        if (!task) throw new ActionError('Task not found')

        if (task.currentTab === 'fixed') {
          await lockFixedSchedule(tx)

          const newStart = sanitized.startTime ?? task.startTime
          const newEnd = sanitized.endTime ?? task.endTime

          if (newStart || newEnd) {
            const rangeError = assertSameDayRange(newStart, newEnd)
            if (rangeError) throw new ActionError(rangeError)

            if (await hasFixedOverlapTx(tx, newStart, newEnd, id)) {
              throw new ActionError('Time slot overlaps with an existing schedule.')
            }
          }
        } else if (sanitized.startTime !== undefined || sanitized.endTime !== undefined) {
          const newStart = sanitized.startTime ?? task.startTime
          const newEnd = sanitized.endTime ?? task.endTime
          if (newStart && newEnd) {
            const rangeError = assertSameDayRange(newStart, newEnd)
            if (rangeError) throw new ActionError(rangeError)
          } else if (newStart || newEnd) {
            if (newStart && !HHMM_RE.test(newStart)) {
              throw new ActionError('Time must be HH:MM in 24-hour format (e.g. "09:00").')
            }
            if (newEnd && !HHMM_RE.test(newEnd)) {
              throw new ActionError('Time must be HH:MM in 24-hour format (e.g. "09:00").')
            }
          }
        }

        return tx.task.update({
          where: { id },
          data: sanitized,
        })
      }, SCHEDULE_TX),
    )

    revalidateSchedule()
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
          await lockFixedSchedule(tx)

          if (!task.startTime || !task.endTime) {
            throw new ActionError('Fixed schedule tasks require both start and end times.')
          }

          const rangeError = assertSameDayRange(task.startTime, task.endTime)
          if (rangeError) throw new ActionError(rangeError)

          if (await hasFixedOverlapTx(tx, task.startTime, task.endTime, id)) {
            throw new ActionError('Time slot overlaps with an existing schedule.')
          }
        }

        if (destination === 'active') {
          const activeExists = await tx.task.findFirst({
            where: {
              id: { not: id },
              currentTab: 'active',
              customTabId: task.customTabId,
            },
            select: { id: true },
          })
          if (activeExists) {
            throw new ActionError('Each tab can only have one Active Target.')
          }
        }

        return tx.task.update({
          where: { id },
          data: { currentTab: destination },
        })
      }, SCHEDULE_TX),
    )

    revalidateSchedule()
    return { success: true, task: updated }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function softDeleteTask(id: string) {
  try {
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

    revalidateSchedule()
    return { success: true }
  } catch (err) {
    return handleDbActionError(err)
  }
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

        if (restoredCurrentTab === 'fixed') {
          await lockFixedSchedule(tx)

          if (!task.startTime || !task.endTime || assertSameDayRange(task.startTime, task.endTime)) {
            restoredCurrentTab = 'foraging'
            collisionReason = "couldn't reclaim its original time slot"
          } else if (await hasFixedOverlapTx(tx, task.startTime, task.endTime)) {
            restoredCurrentTab = 'foraging'
            collisionReason = "couldn't reclaim its original time slot"
          }
        }

        if (restoredCurrentTab === 'active') {
          const activeExists = await tx.task.findFirst({
            where: { currentTab: 'active', customTabId: restoredCustomTabId },
            select: { id: true },
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
      }, SCHEDULE_TX),
    )

    revalidateSchedule()
    return { success: true, task: result.task, collisionReason: result.collisionReason }
  } catch (err) {
    return handleDbActionError(err)
  }
}

export async function permanentlyDeleteTask(id: string) {
  try {
    await prisma.task.delete({ where: { id } })
    revalidateSchedule()
    return { success: true }
  } catch (err) {
    return handleDbActionError(err)
  }
}
