import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

/**
 * Always reuse one PrismaClient per serverless isolate.
 * Without this, Next.js/Vercel warm invocations can spawn extra clients and
 * exhaust Neon's pooled connection limit under concurrent schedule writes.
 */
const prisma = globalForPrisma.prisma ?? createPrismaClient()
globalForPrisma.prisma = prisma

export default prisma
