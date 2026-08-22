import { useEffect, useRef, useState } from 'react'
import type { Run, RunStatus } from '../../api/client'
import { runLogsWsUrl } from '../../api/client'

type Props = {
  namespaceId: string
  runId: string | null
  run?: Run | null
  fill?: boolean
  /** Shorter console for dense Playground layout */
  compact?: boolean
  onLogLine?: (line: string) => void
}

type WsMsg = {
  type: string
  line?: string
  status?: string
}

function isLive(status: string, runStatus?: RunStatus): boolean {
  if (runStatus === 'queued' || runStatus === 'running') return true
  return status === 'connecting' || status === 'live' || status === 'queued' || status === 'running'
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem.toString().padStart(2, '0')}s`
}

export function LogConsole({ namespaceId, runId, run, fill, compact, onLogLine }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [status, setStatus] = useState<string>('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const bottomRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const stickRef = useRef(true)
  const onLogLineRef = useRef(onLogLine)
  onLogLineRef.current = onLogLine

  const live = isLive(status, run?.status)
  const runType = (run?.type ?? 'run').toUpperCase()

  useEffect(() => {
    if (!runId) {
      setLines([])
      setStatus('')
      setStartedAt(null)
      return
    }
    setLines([])
    setStatus('connecting')
    setStartedAt(Date.now())
    stickRef.current = true
    const ws = new WebSocket(runLogsWsUrl(namespaceId, runId))
    ws.onopen = () => setStatus('live')
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsMsg
        if (msg.type === 'log' && msg.line != null) {
          setLines((prev) => [...prev, msg.line!])
          onLogLineRef.current?.(msg.line!)
        } else if (msg.type === 'status' && msg.status) {
          setStatus(msg.status)
        }
      } catch {
        setLines((prev) => [...prev, String(ev.data)])
      }
    }
    ws.onerror = () => setStatus('error')
    ws.onclose = () => setStatus((s) => (s === 'live' ? 'closed' : s))
    return () => ws.close()
  }, [namespaceId, runId])

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [live])

  useEffect(() => {
    if (!stickRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [lines])

  useEffect(() => {
    if (!live || !run) return
    const prev = document.title
    document.title = `⟳ ${runType} · Terraforge`
    return () => {
      document.title = prev
    }
  }, [live, run, runType])

  const elapsed =
    startedAt != null
      ? formatElapsed(now - startedAt)
      : run?.started_at
        ? formatElapsed(now - new Date(run.started_at).getTime())
        : null

  const errorLines = lines.filter(
    (l) =>
      /\berror\b/i.test(l) ||
      /\bfailed\b/i.test(l) ||
      l.startsWith('ERROR:') ||
      /Exit code/i.test(l),
  )
  const lastErrors = errorLines.slice(-6)

  return (
    <div
      className={`flex flex-col overflow-hidden border-2 bg-[#243240] text-[#d8e1e9] ${
        live
          ? 'run-live border-warn shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-warn)_35%,transparent)]'
          : run?.status === 'failed'
            ? 'border-danger'
            : 'border-line/70'
      } ${
        compact
          ? 'h-full min-h-[8rem]'
          : fill
            ? 'min-h-[min(72dvh,52rem)] flex-1'
            : 'min-h-72'
      }`}
    >
      {live && (
        <div
          className={`run-live-banner flex flex-wrap items-center gap-2 px-3 font-bold tracking-wide text-[#1f2a33] ${
            compact ? 'py-1.5 text-xs' : 'gap-3 px-4 py-3 text-base'
          }`}
        >
          <span className="run-live-dot" aria-hidden />
          <span className="uppercase">Terraform {runType} in progress</span>
          <span className={`font-mono font-semibold opacity-90 ${compact ? 'text-[0.65rem]' : 'text-sm'}`}>
            {elapsed ?? '…'} · {lines.length} lines
          </span>
          {!compact && (
            <span className="ml-auto text-sm font-semibold uppercase opacity-80">
              Do not leave — output streaming
            </span>
          )}
        </div>
      )}

      {!live && run?.status === 'failed' && (
        <div className="border-b-2 border-danger/60 bg-danger/20 px-4 py-3 text-base text-[#f0d4d4]">
          <p className="font-bold uppercase tracking-wide text-[#f5b4b4]">Run failed</p>
          {typeof run.summary?.error === 'string' && (
            <p className="mt-1 font-mono text-sm">{run.summary.error}</p>
          )}
          {typeof run.summary?.exit_code === 'number' && (
            <p className="mt-1 font-mono text-sm text-[#d8a0a0]">exit code {run.summary.exit_code}</p>
          )}
          {lastErrors.length > 0 && !run.summary?.error && (
            <pre className="mt-2 max-h-28 overflow-auto font-mono text-sm leading-relaxed opacity-95">
              {lastErrors.join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className={`flex items-center justify-between gap-3 border-b border-white/10 text-base ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold tracking-wide uppercase text-[#a8b8c6]">Console</span>
          {runId && (
            <span className="font-mono text-xs text-[#7a8b9a]">{runId.slice(0, 8)}</span>
          )}
          {run && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold uppercase text-[#c5d0db]">
              {run.type} · {run.source}
            </span>
          )}
        </div>
        <span
          className={`font-mono text-sm font-bold uppercase ${
            live
              ? 'text-warn'
              : status === 'failed' || run?.status === 'failed'
                ? 'text-[#e89a9a]'
                : status === 'success' || run?.status === 'success'
                  ? 'text-[#8fcaab]'
                  : 'text-[#8a9aab]'
          }`}
        >
          {runId ? status || run?.status || '…' : 'no active run'}
          {lines.length > 0 ? ` · ${lines.length} lines` : ''}
        </span>
      </div>

      <pre
        ref={preRef}
        className={`min-h-0 flex-1 overflow-auto font-mono leading-relaxed text-[#d8e1e9] ${
          compact ? 'p-2 text-xs' : 'p-4 text-[0.95rem]'
        }`}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          stickRef.current = atBottom
        }}
      >
        {!runId ? (
          <span className="text-[#7a8b9a]">Type a Terraform CLI command above (e.g. terraform plan).</span>
        ) : lines.length === 0 ? (
          <span className={`inline-flex items-center gap-2 ${live ? 'text-warn' : 'text-[#7a8b9a]'}`}>
            {live && <span className="run-live-dot" aria-hidden />}
            {live ? 'Connected — waiting for Terraform output…' : 'Waiting for output…'}
          </span>
        ) : (
          lines.map((line, i) => {
            const isErr =
              /\berror\b/i.test(line) || line.startsWith('ERROR:') || /\bfailed\b/i.test(line)
            const isWarn = /\bwarn/i.test(line)
            return (
              <div
                key={`${i}-${line.slice(0, 24)}`}
                className={
                  isErr ? 'text-[#f0a8a8]' : isWarn ? 'text-[#e0c48a]' : undefined
                }
              >
                <span className="select-none pr-3 text-[#5c6d7c]">{String(i + 1).padStart(4, ' ')}</span>
                {line}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </pre>
    </div>
  )
}
