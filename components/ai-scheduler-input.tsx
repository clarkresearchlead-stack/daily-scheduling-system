'use client'

import * as React from 'react'
import { SparklesIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSchedule } from '@/lib/schedule-store'
import { useToast } from '@/components/ui/toast'

export function AiSchedulerInput() {
  const { tasks, activeTabId, addTasksBatch } = useSchedule()
  const { toast } = useToast()
  
  const [prompt, setPrompt] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const handleAutoSchedule = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault()
    if (!prompt.trim() || isLoading || isPending) return

    setIsLoading(true)
    
    try {
      // Get currently fixed tasks for AI context
      const existingTasks = tasks
        .filter(t => t.currentTab === 'fixed')
        .map(t => ({
          title: t.title,
          startTime: t.startTime,
          endTime: t.endTime
        }))

      const res = await fetch('/api/auto-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentDate: new Date().toISOString(),
          existingTasks
        })
      })

      if (!res.ok) throw new Error('Failed to fetch AI schedule')

      const data = await res.json()
      
      if (data.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
        const batchToCreate = data.tasks.map((aiTask: any) => ({
          customTabId: activeTabId,
          title: aiTask.title,
          note: aiTask.note ?? '',
          startTime: aiTask.startTime,
          endTime: aiTask.endTime,
          currentTab: 'fixed' as const,
        }))

        // Call single atomic batch action (all-or-nothing, 1 toast on error)
        const ok = await addTasksBatch(batchToCreate)
        
        if (ok) {
          toast.success(`Successfully scheduled ${data.tasks.length} tasks.`)
          setPrompt('')
        }
      } else {
        toast.info('No tasks were generated for the schedule.')
      }
    } catch (err) {
      toast.error('AI Scheduling failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Tell the AI what to schedule..."
        disabled={isLoading || isPending}
        className="flex-1 h-8 text-xs bg-background"
      />
      <button 
        disabled={isLoading || isPending} 
        onClick={handleAutoSchedule}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-secondary text-secondary-foreground hover:bg-secondary/80 h-8 px-3"
      >
        {isLoading ? 'Scheduling...' : 'Auto-Schedule'}
      </button>
    </div>
  )
}
