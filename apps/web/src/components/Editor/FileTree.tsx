import { useMemo, useState } from 'react'
import type { FileNode } from '../../api/client'

type Props = {
  nodes: FileNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Paths that start collapsed (e.g. .terraform). */
  collapseNames?: string[]
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function countFiles(nodes: FileNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.type === 'file') n++
    else if (node.children) n += countFiles(node.children)
  }
  return n
}

function fileIcon(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.tf') || lower.endsWith('.tfvars') || lower.endsWith('.hcl')) return 'TF'
  if (lower.endsWith('.json')) return '{}'
  if (lower.endsWith('.md')) return 'MD'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'YML'
  return '·'
}

function TreeBranch({
  nodes,
  selectedPath,
  onSelect,
  depth,
  collapseNames,
}: {
  nodes: FileNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
  depth: number
  collapseNames: Set<string>
}) {
  const sorted = useMemo(() => sortNodes(nodes), [nodes])
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const n of nodes) {
      if (n.type === 'dir') {
        init[n.path] = !collapseNames.has(n.name)
      }
    }
    return init
  })

  return (
    <ul className="space-y-0.5" role={depth === 0 ? 'tree' : 'group'}>
      {sorted.map((node) => {
        if (node.type === 'dir') {
          const isOpen = open[node.path] ?? true
          const kids = node.children ?? []
          return (
            <li key={node.path} role="treeitem" aria-expanded={isOpen}>
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !isOpen }))}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm font-bold uppercase tracking-wide text-ink-muted hover:bg-paper-deep/80"
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                <span className="inline-block w-3 font-mono text-ink-muted" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="truncate">{node.name || '/'}</span>
                <span className="ml-auto font-mono text-[0.7rem] font-normal normal-case tracking-normal opacity-70">
                  {countFiles(kids)}
                </span>
              </button>
              {isOpen && kids.length > 0 && (
                <TreeBranch
                  nodes={kids}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  depth={depth + 1}
                  collapseNames={collapseNames}
                />
              )}
            </li>
          )
        }

        const active = selectedPath === node.path
        return (
          <li key={node.path} role="treeitem">
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-2 truncate px-2 py-1.5 text-left text-base hover:bg-paper-deep ${
                active ? 'bg-ember/15 font-bold text-ember-deep' : 'text-ink'
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              aria-current={active ? 'true' : undefined}
            >
              <span
                className="inline-flex w-7 shrink-0 justify-center rounded bg-paper-deep/90 px-0.5 font-mono text-[0.65rem] font-bold text-ink-muted"
                aria-hidden
              >
                {fileIcon(node.name)}
              </span>
              <span className="truncate font-mono text-sm sm:text-base">{node.name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function FileTree({
  nodes,
  selectedPath,
  onSelect,
  collapseNames = ['.terraform', '.terraforge', 'terraforge_connect', 'node_modules'],
}: Props) {
  const collapse = useMemo(() => new Set(collapseNames), [collapseNames])
  if (nodes.length === 0) {
    return <p className="px-2 py-3 text-base text-ink-muted">No files in this namespace.</p>
  }
  return (
    <TreeBranch
      nodes={nodes}
      selectedPath={selectedPath}
      onSelect={onSelect}
      depth={0}
      collapseNames={collapse}
    />
  )
}

export function collectFilePaths(nodes: FileNode[]): string[] {
  const out: string[] = []
  for (const n of sortNodes(nodes)) {
    if (n.type === 'file') out.push(n.path)
    else if (n.children) out.push(...collectFilePaths(n.children))
  }
  return out
}
