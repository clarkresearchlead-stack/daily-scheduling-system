import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'

export async function POST(req: Request) {
  try {
    const { prompt, currentDate, existingTasks } = await req.json()

    const result = await generateObject({
      model: google('gemini-3.6-flash'),
      schema: z.object({
        tasks: z.array(
          z.object({
            title: z.string(),
            note: z.string().default(''),
            startTime: z.string().describe('Must be in HH:MM format (24-hour), e.g., "09:00"'),
            endTime: z.string().describe('Must be in HH:MM format (24-hour), e.g., "10:30"'),
            currentTab: z.literal('fixed'),
          })
        ),
      }),
      system: `You are an expert AI scheduling assistant.
Your goal is to parse the user's prompt and generate a logical, sequential list of time-blocked tasks for today.
- The user's current date/time context is: ${currentDate}.
- Avoid scheduling over any existing tasks provided: ${JSON.stringify(existingTasks)}.
- Output time in strict "HH:MM" 24-hour format (e.g. "09:00", "14:30").
- Ensure reasonable task durations (e.g. 15m to 2h).
- CRITICAL: Ensure that startTime is strictly before endTime (startTime < endTime) for every task.
- CRITICAL: You MUST strictly output currentTab as 'fixed'. Never generate tasks for 'active' or 'foraging'.
- Ensure tasks are sorted chronologically by startTime.
- Output ONLY valid JSON matching the schema.`,
      prompt: prompt,
    })

    return Response.json(result.object)
  } catch (error) {
    console.error('Auto-schedule error:', error)
    return Response.json({ error: 'Failed to generate schedule.' }, { status: 500 })
  }
}
