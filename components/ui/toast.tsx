'use client'

import * as React from 'react'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastVariant = 'error' | 'warning' | 'success' | 'info'

interface ToastItem {
  id: string
  variant: ToastVariant
  message: string
}

interface ToastContextValue {
  addToast: (variant: ToastVariant, message: string) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = React.createContext<ToastContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

const DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const addToast = React.useCallback((variant: ToastVariant, message: string) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, variant, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, DISMISS_MS)
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const ctx = React.useMemo(() => ({ addToast }), [addToast])

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <Toaster toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  return React.useMemo(
    () => ({
      toast: {
        error: (message: string) => ctx.addToast('error', message),
        warning: (message: string) => ctx.addToast('warning', message),
        success: (message: string) => ctx.addToast('success', message),
        info: (message: string) => ctx.addToast('info', message),
      },
    }),
    [ctx],
  )
}

// ─── Toaster ──────────────────────────────────────────────────────────────────

function Toaster({
  toasts,
  onRemove,
}: {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}) {
  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastBubble key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}

// ─── Individual toast ─────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, string> = {
  error:
    'bg-destructive text-destructive-foreground border-destructive/40',
  warning:
    'bg-amber-500 text-white border-amber-400/40 dark:bg-amber-600',
  success:
    'bg-emerald-600 text-white border-emerald-500/40',
  info:
    'bg-primary text-primary-foreground border-primary/40',
}

const variantIcons: Record<ToastVariant, string> = {
  error: '✕',
  warning: '⚠',
  success: '✓',
  info: 'ℹ',
}

function ToastBubble({
  toast,
  onRemove,
}: {
  toast: ToastItem
  onRemove: (id: string) => void
}) {
  const [mounted, setMounted] = React.useState(false)

  // Trigger enter animation on mount
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm',
        'transition-all duration-300 ease-out',
        variantStyles[toast.variant],
        mounted
          ? 'translate-y-0 opacity-100'
          : 'translate-y-3 opacity-0',
      )}
    >
      {/* Icon */}
      <span
        aria-hidden="true"
        className="mt-px shrink-0 text-sm font-bold leading-none"
      >
        {variantIcons[toast.variant]}
      </span>

      {/* Message */}
      <p className="flex-1 text-sm leading-snug">{toast.message}</p>

      {/* Dismiss */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 cursor-pointer opacity-70 transition-opacity hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
