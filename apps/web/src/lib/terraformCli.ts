import type { RunType } from '../api/client'

export type TfCliCommand = {
  name: string
  runType?: RunType
  synopsis: string
  definition: string
  usage: string
  flags: Array<{ flag: string; definition: string }>
  examples: string[]
}

/** Core Terraform CLI surface enforced in the Playground terminal. */
export const TF_CLI_COMMANDS: TfCliCommand[] = [
  {
    name: 'init',
    runType: 'init',
    synopsis: 'Prepare the working directory',
    definition:
      'Downloads providers/modules and sets up the backend. Run this first in a new workspace, or after changing required_providers / modules.',
    usage: 'terraform init [options]',
    flags: [
      { flag: '-upgrade', definition: 'Upgrade providers and modules to newer allowed versions' },
      { flag: '-reconfigure', definition: 'Reconfigure the backend, ignoring prior backend config' },
      { flag: '-input=false', definition: 'Disable interactive prompts (Playground default)' },
    ],
    examples: ['terraform init', 'terraform init -upgrade'],
  },
  {
    name: 'plan',
    runType: 'plan',
    synopsis: 'Show what Terraform will change',
    definition:
      'Compares config to state and prints the execution plan (+ create, ~ update, - destroy). Does not change infrastructure.',
    usage: 'terraform plan [options]',
    flags: [
      { flag: '-out=FILE', definition: 'Write a plan file (runner stores plan.json for the deploy map)' },
      { flag: '-destroy', definition: 'Plan a full destroy instead of create/update' },
      { flag: '-refresh=false', definition: 'Skip refreshing state from real resources' },
      { flag: '-input=false', definition: 'Disable interactive prompts' },
    ],
    examples: ['terraform plan', 'terraform plan -out=tfplan'],
  },
  {
    name: 'apply',
    runType: 'apply',
    synopsis: 'Create or update resources',
    definition:
      'Applies the configuration (or a saved plan) to reach the desired state. In the Playground this runs non-interactively with auto-approve.',
    usage: 'terraform apply [options]',
    flags: [
      { flag: '-auto-approve', definition: 'Skip interactive approval (Playground always does this)' },
      { flag: '-input=false', definition: 'Disable interactive prompts' },
      { flag: '-refresh=false', definition: 'Skip refresh before apply' },
    ],
    examples: ['terraform apply', 'terraform apply -auto-approve'],
  },
  {
    name: 'destroy',
    runType: 'destroy',
    synopsis: 'Destroy managed resources',
    definition:
      'Removes all resources tracked in state for this workspace. Prefer plan first so you know what will be deleted.',
    usage: 'terraform destroy [options]',
    flags: [
      { flag: '-auto-approve', definition: 'Skip interactive approval (Playground always does this)' },
      { flag: '-input=false', definition: 'Disable interactive prompts' },
    ],
    examples: ['terraform destroy', 'terraform destroy -auto-approve'],
  },
  {
    name: 'validate',
    synopsis: 'Check whether the configuration is valid',
    definition:
      'Validates syntax and internal consistency without contacting remote APIs. Not executed by the Playground runner yet — use plan for a stronger check.',
    usage: 'terraform validate',
    flags: [],
    examples: ['terraform validate'],
  },
  {
    name: 'fmt',
    synopsis: 'Format configuration files',
    definition:
      'Rewrites .tf files to canonical style. Edit in the IDE for now; fmt is not wired to the runner in this MVP.',
    usage: 'terraform fmt [options]',
    flags: [{ flag: '-recursive', definition: 'Also process files in subdirectories' }],
    examples: ['terraform fmt', 'terraform fmt -recursive'],
  },
  {
    name: 'version',
    synopsis: 'Show Terraform version',
    definition: 'Prints the Terraform CLI version. Playground runs use the runner image (typically 1.9.x).',
    usage: 'terraform version',
    flags: [],
    examples: ['terraform version'],
  },
  {
    name: 'output',
    synopsis: 'Read root module outputs',
    definition:
      'Shows output values from the last apply. Not a separate runner job here — check outputs.tf and the deploy map / state after apply.',
    usage: 'terraform output [name]',
    flags: [{ flag: '-json', definition: 'Emit outputs as JSON' }],
    examples: ['terraform output', 'terraform output -json'],
  },
  {
    name: 'state',
    synopsis: 'Advanced state inspection',
    definition:
      'Subcommands like list / show inspect Terraform state. Use Full namespace view → State for inspection in Terraforge.',
    usage: 'terraform state <subcommand>',
    flags: [],
    examples: ['terraform state list', 'terraform state show ADDRESS'],
  },
  {
    name: 'help',
    synopsis: 'Show Terraform help',
    definition: 'Lists Terraform commands or details for one command: terraform help plan',
    usage: 'terraform help [command]',
    flags: [],
    examples: ['terraform help', 'terraform help apply'],
  },
]

export const META_COMMANDS = [
  {
    name: 'help',
    definition: 'Show Playground CLI help (same idea as terraform help)',
    usage: 'help [command]',
  },
  {
    name: 'clear',
    definition: 'Clear the terminal scrollback in this panel',
    usage: 'clear',
  },
] as const

const RUNNABLE = new Set(['init', 'plan', 'apply', 'destroy'])

export type ParsedCli =
  | { kind: 'run'; runType: RunType; command: string; flags: string[] }
  | { kind: 'help'; topic?: string; text: string }
  | { kind: 'clear' }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }

function tokenize(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function findCommand(name: string): TfCliCommand | undefined {
  return TF_CLI_COMMANDS.find((c) => c.name === name)
}

export function formatCommandHelp(cmd: TfCliCommand): string {
  const lines = [
    `${cmd.name} — ${cmd.synopsis}`,
    '',
    cmd.definition,
    '',
    `Usage: ${cmd.usage}`,
  ]
  if (cmd.flags.length) {
    lines.push('', 'Common flags:')
    for (const f of cmd.flags) {
      lines.push(`  ${f.flag.padEnd(18)} ${f.definition}`)
    }
  }
  if (cmd.examples.length) {
    lines.push('', 'Examples:')
    for (const ex of cmd.examples) lines.push(`  ${ex}`)
  }
  if (!cmd.runType) {
    lines.push('', 'Note: this command is documented for learning; the Playground runner executes init / plan / apply / destroy.')
  }
  return lines.join('\n')
}

export function formatGeneralHelp(): string {
  const runnable = TF_CLI_COMMANDS.filter((c) => c.runType)
  const learn = TF_CLI_COMMANDS.filter((c) => !c.runType)
  return [
    'Terraforge Playground — Terraform CLI',
    '',
    'Type real Terraform commands. Buttons are disabled on purpose so you practice the CLI.',
    '',
    'Runnable here:',
    ...runnable.map((c) => `  terraform ${c.name.padEnd(10)} ${c.synopsis}`),
    '',
    'Documented (autocomplete + definitions):',
    ...learn.map((c) => `  terraform ${c.name.padEnd(10)} ${c.synopsis}`),
    '',
    'Also: help, clear, terraform help <command>, terraform <command> -help',
    '',
    'Tip: press Tab for autocomplete. ↑/↓ recall history.',
  ].join('\n')
}

/** Parse a line typed into the Playground CLI. */
export function parseTerraformCli(line: string): ParsedCli {
  const raw = line.trim()
  if (!raw) return { kind: 'error', text: 'Empty command. Try: terraform plan' }

  const tokens = tokenize(raw)
  const head = tokens[0]?.toLowerCase() ?? ''

  if (head === 'clear') return { kind: 'clear' }

  if (head === 'help' || head === '?') {
    const topic = tokens[1]
    if (topic) {
      const cmd = findCommand(topic.toLowerCase())
      if (!cmd) return { kind: 'error', text: `Unknown topic “${topic}”. Try: help plan` }
      return { kind: 'help', topic: cmd.name, text: formatCommandHelp(cmd) }
    }
    return { kind: 'help', text: formatGeneralHelp() }
  }

  if (head !== 'terraform' && head !== 'tf') {
    return {
      kind: 'error',
      text: [
        `Only Terraform CLI is allowed here (got “${tokens[0]}”).`,
        'Start with: terraform <command>',
        'Examples: terraform init · terraform plan · terraform apply · terraform destroy',
        'Type help for the full list.',
      ].join('\n'),
    }
  }

  const rest = tokens.slice(1)
  if (rest.length === 0) {
    return { kind: 'help', text: formatGeneralHelp() }
  }

  // terraform -help | --help | -h
  if (['-help', '--help', '-h'].includes(rest[0].toLowerCase())) {
    return { kind: 'help', text: formatGeneralHelp() }
  }

  // terraform help [cmd]
  if (rest[0].toLowerCase() === 'help') {
    const topic = rest[1]
    if (topic) {
      const cmd = findCommand(topic.toLowerCase())
      if (!cmd) return { kind: 'error', text: `Unknown command “${topic}”. Try: terraform help` }
      return { kind: 'help', topic: cmd.name, text: formatCommandHelp(cmd) }
    }
    return { kind: 'help', text: formatGeneralHelp() }
  }

  // terraform version
  if (rest[0].toLowerCase() === 'version') {
    return {
      kind: 'info',
      text: 'Terraform v1.9.x (runner image terraforge-runner)\nOn your laptop: terraform version',
    }
  }

  const sub = rest[0].toLowerCase()
  const cmd = findCommand(sub)
  if (!cmd) {
    return {
      kind: 'error',
      text: `Unknown terraform command “${rest[0]}”.\nType: terraform help`,
    }
  }

  const flags = rest.slice(1)
  const wantsHelp = flags.some((f) => ['-help', '--help', '-h'].includes(f.toLowerCase()))
  if (wantsHelp) {
    return { kind: 'help', topic: cmd.name, text: formatCommandHelp(cmd) }
  }

  if (!cmd.runType || !RUNNABLE.has(cmd.name)) {
    return {
      kind: 'info',
      text: [
        formatCommandHelp(cmd),
        '',
        `“terraform ${cmd.name}” is not executed by the Playground runner.`,
        'Runnable commands: terraform init | plan | apply | destroy',
      ].join('\n'),
    }
  }

  // Soft-accept known flags; warn on totally unknown tokens that look like flags
  const known = new Set(cmd.flags.map((f) => f.flag.split('=')[0]))
  const unknown = flags.filter((f) => f.startsWith('-') && !known.has(f.split('=')[0]) && !['-auto-approve', '-input', '-input=false', '-upgrade', '-reconfigure', '-refresh=false', '-destroy'].includes(f.split('=')[0]) && !f.startsWith('-out'))
  // Keep simple — don't block on flags; runner ignores them

  void unknown

  return {
    kind: 'run',
    runType: cmd.runType,
    command: `terraform ${cmd.name}${flags.length ? ` ${flags.join(' ')}` : ''}`,
    flags,
  }
}

export type Suggestion = {
  value: string
  label: string
  detail: string
}

/** Autocomplete suggestions for the current input line. */
export function suggestTerraformCli(line: string): Suggestion[] {
  const trimmedEnd = line.replace(/\s+$/, '')
  const hasTrailingSpace = /\s$/.test(line)
  const tokens = tokenize(trimmedEnd)
  const partial = hasTrailingSpace ? '' : (tokens[tokens.length - 1] ?? '')
  const baseTokens = hasTrailingSpace ? tokens : tokens.slice(0, -1)

  // Empty or first token
  if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingSpace && !line.startsWith('terraform') && line !== 'tf')) {
    const starters: Suggestion[] = [
      { value: 'terraform ', label: 'terraform', detail: 'Terraform CLI' },
      { value: 'help', label: 'help', detail: 'Show CLI help' },
      { value: 'clear', label: 'clear', detail: 'Clear terminal' },
    ]
    if (!partial) return starters
    return starters.filter(
      (s) => s.label.startsWith(partial.toLowerCase()) || s.value.startsWith(partial.toLowerCase()),
    )
  }

  const head = tokens[0]?.toLowerCase()

  if (head === 'help' && (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace))) {
    return TF_CLI_COMMANDS.filter((c) => !partial || c.name.startsWith(partial.toLowerCase())).map(
      (c) => ({
        value: `help ${c.name}`,
        label: c.name,
        detail: c.synopsis,
      }),
    )
  }

  if (head !== 'terraform' && head !== 'tf') {
    return []
  }

  // terraform <partial-sub>
  if (baseTokens.length <= 1) {
    return TF_CLI_COMMANDS.filter((c) => !partial || c.name.startsWith(partial.toLowerCase())).map(
      (c) => ({
        value: `terraform ${c.name}${c.runType ? '' : ''}`,
        label: c.name,
        detail: c.synopsis + (c.runType ? '' : ' · docs only'),
      }),
    )
  }

  // terraform help <partial>
  if (baseTokens[1]?.toLowerCase() === 'help') {
    return TF_CLI_COMMANDS.filter((c) => !partial || c.name.startsWith(partial.toLowerCase())).map(
      (c) => ({
        value: `terraform help ${c.name}`,
        label: c.name,
        detail: c.synopsis,
      }),
    )
  }

  // terraform <cmd> <partial-flag>
  const sub = baseTokens[1]?.toLowerCase()
  const cmd = findCommand(sub ?? '')
  if (!cmd) return []

  const flagSuggestions = [
    ...cmd.flags.map((f) => ({
      value: `terraform ${cmd.name} ${f.flag.includes('=') ? f.flag.split('=')[0] + '=' : f.flag}`,
      label: f.flag,
      detail: f.definition,
    })),
    {
      value: `terraform ${cmd.name} -help`,
      label: '-help',
      detail: 'Show definition for this command',
    },
  ]

  if (!partial) return flagSuggestions
  if (!partial.startsWith('-')) return []
  return flagSuggestions.filter((s) => s.label.startsWith(partial) || s.label.startsWith(partial.split('=')[0]))
}

/** Apply a suggestion onto the current line (replace last partial token). */
export function applySuggestion(line: string, suggestion: Suggestion): string {
  const hasTrailingSpace = /\s$/.test(line)
  const tokens = tokenize(line.trimEnd())
  if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingSpace && !line.includes(' '))) {
    return suggestion.value.endsWith(' ') ? suggestion.value : `${suggestion.value} `
  }
  // Prefer full suggestion value when it starts with terraform
  if (suggestion.value.startsWith('terraform') || suggestion.value.startsWith('help')) {
    return suggestion.value.endsWith(' ') || suggestion.value.includes('=')
      ? suggestion.value
      : `${suggestion.value} `
  }
  return suggestion.value
}

export function activeCommandFromLine(line: string): TfCliCommand | null {
  const tokens = tokenize(line)
  if (tokens.length === 0) return null
  const head = tokens[0]?.toLowerCase() ?? ''

  if (head === 'help' && tokens[1]) {
    return matchCommand(tokens[1]) 
  }
  if (head !== 'terraform' && head !== 'tf') return null
  if (!tokens[1]) return null
  if (tokens[1].toLowerCase() === 'help') {
    return tokens[2] ? matchCommand(tokens[2]) : findCommand('help') ?? null
  }
  // Skip flags as "command"
  if (tokens[1].startsWith('-')) return null
  return matchCommand(tokens[1])
}

/** Exact match, else unique/best prefix (so "terraform pla" still shows plan). */
function matchCommand(raw: string): TfCliCommand | null {
  const q = raw.toLowerCase()
  const exact = findCommand(q)
  if (exact) return exact
  const prefixed = TF_CLI_COMMANDS.filter((c) => c.name.startsWith(q))
  if (prefixed.length === 1) return prefixed[0]
  if (prefixed.length > 1) {
    // Prefer runnable commands when ambiguous
    const runnable = prefixed.filter((c) => c.runType)
    return runnable[0] ?? prefixed[0]
  }
  return null
}
