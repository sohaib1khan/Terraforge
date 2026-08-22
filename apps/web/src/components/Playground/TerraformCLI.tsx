import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Run, RunType } from '../../api/client'
import { LogConsole } from '../LogConsole/LogConsole'
import {
  activeCommandFromLine,
  applySuggestion,
  findCommand,
  parseTerraformCli,
  suggestTerraformCli,
  TF_CLI_COMMANDS,
  type Suggestion,
  type TfCliCommand,
} from '../../lib/terraformCli'
import { HorizontalSplit } from './ResizableLayout'

type Props = {
  namespaceId: string
  runId: string | null
  run: Run | null
  busy: boolean
  dirty: boolean
  onRun: (type: RunType, command: string) => Promise<void>
  onLogLine?: (line: string) => void
}

type HistLine =
  | { kind: 'in'; text: string }
  | { kind: 'out'; text: string; tone?: 'ok' | 'err' | 'muted' }

const WELCOME =
  'Type terraform commands · Tab autocomplete · click a command on the right for its definition'

const QUICK = ['init', 'plan', 'apply', 'destroy'] as const

export function TerraformCLI({
  namespaceId,
  runId,
  run,
  busy,
  dirty,
  onRun,
  onLogLine,
}: Props) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<HistLine[]>([{ kind: 'out', text: WELCOME, tone: 'muted' }])
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sel, setSel] = useState(0)
  const [openSuggest, setOpenSuggest] = useState(false)
  /** Sticky selection when user clicks a chip / picks autocomplete */
  const [pinned, setPinned] = useState<TfCliCommand | null>(null)

  const fromLine = useMemo(() => activeCommandFromLine(input), [input])
  const active = fromLine ?? pinned

  useEffect(() => {
    setSuggestions(suggestTerraformCli(input))
    setSel(0)
    // When the line resolves a command, prefer that over a stale pin
    if (fromLine) setPinned(fromLine)
  }, [input, fromLine])

  function pushOut(text: string, tone?: 'ok' | 'err' | 'muted') {
    setHistory((h) => [...h, { kind: 'out', text, tone }])
  }

  function acceptSuggestion(s: Suggestion) {
    const next = applySuggestion(input, s)
    setInput(next)
    const cmd = activeCommandFromLine(next)
    if (cmd) setPinned(cmd)
    setOpenSuggest(false)
    inputRef.current?.focus()
  }

  function pickCommand(name: string) {
    const cmd = findCommand(name)
    if (!cmd) return
    setPinned(cmd)
    setInput(`terraform ${cmd.name} `)
    inputRef.current?.focus()
  }

  async function submit(raw: string) {
    const line = raw.trim()
    if (!line) return
    setHistory((h) => [...h, { kind: 'in', text: line }])
    setCmdHistory((h) => (h[h.length - 1] === line ? h : [...h, line]))
    setHistIdx(null)
    setInput('')
    setOpenSuggest(false)

    const parsed = parseTerraformCli(line)
    switch (parsed.kind) {
      case 'clear':
        setHistory([{ kind: 'out', text: WELCOME, tone: 'muted' }])
        return
      case 'help':
      case 'info':
        pushOut(parsed.text, 'muted')
        if (parsed.kind === 'help' && 'topic' in parsed && parsed.topic) {
          const cmd = findCommand(parsed.topic)
          if (cmd) setPinned(cmd)
        }
        return
      case 'error':
        pushOut(parsed.text, 'err')
        return
      case 'run': {
        if (dirty) {
          pushOut('Save your .tf changes in the editor before running Terraform.', 'err')
          return
        }
        if (busy) {
          pushOut('A run is already in progress. Wait for it to finish.', 'err')
          return
        }
        const cmd = findCommand(parsed.runType)
        if (cmd) setPinned(cmd)
        pushOut(`→ ${parsed.command}`, 'ok')
        try {
          await onRun(parsed.runType, parsed.command)
        } catch (e) {
          pushOut(e instanceof Error ? e.message : 'Failed to start run', 'err')
        }
        return
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (openSuggest && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey)) {
        e.preventDefault()
        acceptSuggestion(suggestions[sel] ?? suggestions[0])
        return
      }
      if (e.key === 'Escape') {
        setOpenSuggest(false)
        return
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const s = suggestTerraformCli(input)
      if (s.length === 1) acceptSuggestion(s[0])
      else if (s.length > 1) {
        setSuggestions(s)
        setOpenSuggest(true)
        setSel(0)
      }
      return
    }

    if (e.key === 'ArrowUp' && !openSuggest) {
      e.preventDefault()
      if (cmdHistory.length === 0) return
      const next = histIdx == null ? cmdHistory.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(next)
      setInput(cmdHistory[next] ?? '')
      return
    }
    if (e.key === 'ArrowDown' && !openSuggest) {
      e.preventDefault()
      if (histIdx == null) return
      if (histIdx >= cmdHistory.length - 1) {
        setHistIdx(null)
        setInput('')
        return
      }
      const next = histIdx + 1
      setHistIdx(next)
      setInput(cmdHistory[next] ?? '')
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      void submit(input)
    }
  }

  const definitionPanel = (
    <aside className="tf-cli-def flex h-full min-h-0 flex-col bg-panel/95 p-3">
      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
        Command definition
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {QUICK.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => pickCommand(name)}
            className={`rounded border px-2 py-0.5 font-mono text-xs ${
              active?.name === name
                ? 'border-ember bg-ember/20 font-semibold text-ink'
                : 'border-line/60 text-ink-muted hover:border-ember hover:text-ink'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {active ? (
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
          <p className="font-mono text-sm font-semibold text-ink">terraform {active.name}</p>
          <p className="text-xs font-medium text-ember-deep">{active.synopsis}</p>
          <p className="text-sm leading-relaxed text-ink">{active.definition}</p>
          <p className="font-mono text-[0.7rem] text-ink-muted">{active.usage}</p>
          {active.flags.length > 0 && (
            <ul className="mt-1 space-y-1">
              {active.flags.map((f) => (
                <li key={f.flag} className="text-xs leading-snug">
                  <code className="font-mono text-ember-deep">{f.flag}</code>
                  <span className="text-ink-muted"> — {f.definition}</span>
                </li>
              ))}
            </ul>
          )}
          {active.runType ? (
            <p className="text-[0.65rem] font-bold uppercase tracking-wide text-moss-deep">
              Runnable · press Enter to queue
            </p>
          ) : (
            <p className="text-[0.65rem] font-bold uppercase tracking-wide text-warn">
              Docs only · not executed here
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-sm text-ink-muted">
          <p>Click a command above, or type e.g. <code className="font-mono text-ink">terraform plan</code>.</p>
          <ul className="space-y-0.5 font-mono text-xs text-ink">
            {TF_CLI_COMMANDS.filter((c) => c.runType).map((c) => (
              <li key={c.name}>
                <button type="button" className="hover:underline" onClick={() => pickCommand(c.name)}>
                  terraform {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )

  const terminal = (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-2 border-line/70 bg-panel/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <h2 className="font-display text-base font-bold">Terraform CLI</h2>
        <p className="font-mono text-xs text-ink-muted">Tab = complete · help = catalog</p>
      </div>

      <div
        className="max-h-16 overflow-auto bg-[#1a1528] px-3 py-1.5 font-mono text-xs leading-relaxed text-[#d8e1e9]"
        aria-live="polite"
        onClick={() => inputRef.current?.focus()}
      >
        {history.slice(-8).map((h, i) =>
          h.kind === 'in' ? (
            <div key={i} className="text-[#c9b6f0]">
              <span className="text-[#7a8b9a]">$ </span>
              {h.text}
            </div>
          ) : (
            <pre
              key={i}
              className={`whitespace-pre-wrap ${
                h.tone === 'err' ? 'text-[#f0a8a8]' : h.tone === 'ok' ? 'text-[#8fcaab]' : 'text-[#9aa8b8]'
              }`}
            >
              {h.text}
            </pre>
          ),
        )}
      </div>

      <div className="relative border-t border-white/10 bg-[#120b1f] px-2 py-1.5">
        {openSuggest && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="tf-cli-suggest absolute bottom-full left-2 right-2 z-10 mb-1 max-h-40 overflow-auto border border-line/80 bg-[#1c1230] shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left font-mono text-xs ${
                    i === sel ? 'bg-ember/30 text-panel' : 'text-[#d8e1e9] hover:bg-white/10'
                  }`}
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    acceptSuggestion(s)
                  }}
                >
                  <span className="shrink-0 font-semibold">{s.label}</span>
                  <span className="truncate opacity-70">{s.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="flex items-center gap-2 font-mono text-sm text-[#d8e1e9]">
          <span className="shrink-0 text-[#8fcaab]">$</span>
          <input
            ref={inputRef}
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value)
              setOpenSuggest(true)
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setOpenSuggest(suggestions.length > 0)}
            onBlur={() => window.setTimeout(() => setOpenSuggest(false), 120)}
            placeholder="type: terraform plan"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={openSuggest}
            className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-[#d8e1e9] outline-none placeholder:text-[#5c6d7c] disabled:opacity-60"
          />
          {busy && <span className="shrink-0 text-xs uppercase text-warn">running…</span>}
        </label>
      </div>

      <div className="min-h-0 flex-1 border-t border-line/60">
        <LogConsole namespaceId={namespaceId} runId={runId} run={run} compact onLogLine={onLogLine} />
      </div>
    </div>
  )

  return (
    <section className="tf-cli h-full min-h-0 border-0">
      <HorizontalSplit
        storageKey="tf-pg-cli-def"
        initial={68}
        min={40}
        max={85}
        className="h-full min-h-[14rem]"
        handleLabel="Drag to resize terminal vs definition"
        first={terminal}
        second={
          <div className="h-full min-h-0 border-2 border-line/70 border-l-0 bg-panel/95">
            {definitionPanel}
          </div>
        }
      />
    </section>
  )
}
