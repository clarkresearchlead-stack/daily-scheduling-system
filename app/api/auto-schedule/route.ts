import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM in 24-hour format')

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  currentDate: z.string().min(1),
  existingTasks: z
    .array(
      z.object({
        title: z.string(),
        startTime: z.string(),
        endTime: z.string(),
      }),
    )
    .default([]),
})

const aiTaskSchema = z.object({
  tasks: z.array(
    z
      .object({
        title: z.string().trim().min(1).max(200),
        note: z.string().max(2000).default(''),
        startTime: hhmm.describe('Must be in HH:MM format (24-hour), e.g., "09:00"'),
        endTime: hhmm.describe('Must be in HH:MM format (24-hour), e.g., "10:30"'),
        currentTab: z.literal('fixed'),
      })
      .refine((t) => t.startTime < t.endTime, {
        message: 'endTime must be after startTime (same-day only; no midnight crossover)',
      }),
  ),
})

export async function POST(req: Request) {
  try {
    const body = requestSchema.parse(await req.json())

    const result = await generateObject({
      model: google('gemini-3.6-flash'),
      schema: aiTaskSchema,
      system: `You are an expert AI scheduling assistant.
Your goal is to parse the user's prompt and generate a logical, sequential list of time-blocked tasks for today.
- The user's current date/time context is: ${body.currentDate}.
- Avoid scheduling over any existing tasks provided: ${JSON.stringify(body.existingTasks)}.
- Output time in strict zero-padded "HH:MM" 24-hour format (e.g. "09:00", "14:30"). Never use "9:00".
- Ensure reasonable task durations (e.g. 15m to 2h).
- CRITICAL: Ensure that startTime is strictly before endTime (startTime < endTime) for every task.
- CRITICAL: Do NOT schedule overnight/midnight-crossing tasks (e.g. "23:00"–"01:00" is invalid).
- CRITICAL: Tasks may be back-to-back (end of one equals start of next); that is allowed. Do not overlap interiors.
- CRITICAL: You MUST strictly output currentTab as 'fixed'. Never generate tasks for 'active' or 'foraging'.
- Ensure tasks are sorted chronologically by startTime.
- Output ONLY valid JSON matching the schema.`,
      prompt: body.prompt,
    })

    return Response.json(result.object)
  } catch (error) {
    console.error('Auto-schedule error:', error)
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid auto-schedule request.' }, { status: 400 })
    }
    return Response.json({ error: 'Failed to generate schedule.' }, { status: 500 })
  }
}
