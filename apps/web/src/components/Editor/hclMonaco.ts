import type { BeforeMount } from '@monaco-editor/react'

export const registerHCL: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('terraforge-calm', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a7a88', fontStyle: 'italic' },
      { token: 'string', foreground: '3d6e55' },
      { token: 'number', foreground: '8a6a28' },
      { token: 'keyword', foreground: '2d5661', fontStyle: 'bold' },
      { token: 'type', foreground: '35584c' },
      { token: 'identifier', foreground: '2a3846' },
    ],
    colors: {
      'editor.background': '#d4dee6',
      'editor.foreground': '#2a3846',
      'editorLineNumber.foreground': '#7a8b9a',
      'editorLineNumber.activeForeground': '#2d5661',
      'editor.selectionBackground': '#3d6f7c44',
      'editor.lineHighlightBackground': '#c5d0db66',
      'editorCursor.foreground': '#2d5661',
      'editorWidget.background': '#cfd9e2',
      'editorGutter.background': '#cfd9e2',
    },
  })
  monaco.editor.defineTheme('terraforge-inspect', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a7a88', fontStyle: 'italic' },
      { token: 'string', foreground: '2f6b4f' },
      { token: 'number', foreground: '7a5a20' },
      { token: 'keyword', foreground: '1f4a54', fontStyle: 'bold' },
      { token: 'identifier', foreground: '243440' },
    ],
    colors: {
      'editor.background': '#c8d4de',
      'editor.foreground': '#243440',
      'editorLineNumber.foreground': '#6a7a88',
      'editorLineNumber.activeForeground': '#1f4a54',
      'editor.selectionBackground': '#3d6f7c55',
      'editor.lineHighlightBackground': '#b8c8d555',
      'editorCursor.foreground': '#1f4a54',
      'editorWidget.background': '#b8c5d2',
      'editorGutter.background': '#b8c5d2',
      'editor.inactiveSelectionBackground': '#3d6f7c33',
    },
  })
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === 'hcl')) return
  monaco.languages.register({ id: 'hcl', extensions: ['.tf', '.tfvars', '.hcl'] })
  monaco.languages.setMonarchTokensProvider('hcl', {
    keywords: [
      'resource',
      'data',
      'module',
      'variable',
      'output',
      'locals',
      'provider',
      'terraform',
      'backend',
      'required_providers',
      'required_version',
      'lifecycle',
      'depends_on',
      'count',
      'for_each',
      'dynamic',
      'true',
      'false',
      'null',
    ],
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [
          /[a-zA-Z_][\w-]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
        [/[{}()\[\]]/, '@brackets'],
        [/[=:]/, 'operator'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  })
}

export function languageForPath(path: string | null): string {
  if (!path) return 'plaintext'
  const lower = path.toLowerCase()
  if (lower.endsWith('.tf') || lower.endsWith('.tfvars') || lower.endsWith('.hcl')) return 'hcl'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}
