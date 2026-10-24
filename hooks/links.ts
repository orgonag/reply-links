export type Registry = {
  repo: string | null
  seenRepo: string | null
  names: Map<string, string>
  numbers: Map<string, string>
}

export const emptyRegistry = (): Registry => ({ repo: null, seenRepo: null, names: new Map(), numbers: new Map() })

const MAX_NAMES = 2000
const MAX_NODES = 5000
const NAME_KEYS = ['name', 'title', 'displayName', 'display_name', 'filename', 'fileName', 'file_name', 'label']
const URL_KEYS = ['webViewLink', 'htmlUrl', 'html_url', 'url', 'link', 'webUrl', 'web_url', 'alternateLink', 'permalink', 'viewUrl', 'view_url', 'editUrl', 'edit_url', 'shareUrl', 'share_url', 'href']
const GITHUB_REF = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)/g
const GITHUB_REMOTE = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/

export const repoFromRemote = (remote: string): string | null => {
  const m = GITHUB_REMOTE.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

const isWebUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s<>()]+$/.test(v)

const goodName = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 4 && v.length <= 120 && !/^[\d\s.,:-]+$/.test(v) && !/[\n\r`[\]]/.test(v)

const templateUrl = (o: Record<string, unknown>, tool: string): string | null => {
  const id = typeof o.id === 'string' ? o.id : null
  if (typeof o.agent_id === 'string' && /^agent_\w{10,}$/.test(o.agent_id)) return `https://elevenlabs.io/app/agents/agents/${o.agent_id}`
  if (id && typeof o.mimeType === 'string') return `https://drive.google.com/open?id=${encodeURIComponent(id)}`
  if (id && /^[a-z]{20}$/.test(id) && typeof o.region === 'string' && ('organization_id' in o || /supabase/i.test(tool))) return `https://supabase.com/dashboard/project/${id}`
  return null
}

const remember = (reg: Registry, name: string, url: string) => {
  if (reg.names.size >= MAX_NAMES && !reg.names.has(name)) return
  reg.names.set(name.trim(), url)
}

const walk = (node: unknown, tool: string, reg: Registry, budget: { left: number }, depth = 0) => {
  if (depth > 8 || budget.left-- <= 0 || node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, tool, reg, budget, depth + 1)
    return
  }
  const o = node as Record<string, unknown>
  const name = NAME_KEYS.map(k => o[k]).find(goodName)
  const url = URL_KEYS.map(k => o[k]).find(isWebUrl) ?? templateUrl(o, tool)
  if (name && url) remember(reg, name, url)
  for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, tool, reg, budget, depth + 1)
}

const parseJson = (text: string): unknown => {
  const start = text.search(/[[{]/)
  if (start < 0) return undefined
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return undefined
  }
}

export const harvest = (text: string, tool: string, reg: Registry) => {
  for (const m of text.matchAll(GITHUB_REF)) {
    reg.seenRepo = m[1]!
    reg.numbers.set(`${m[1]}#${m[2]}`, m[0])
  }
  const json = parseJson(text)
  if (json !== undefined) walk(json, tool, reg, { left: MAX_NODES })
}

export const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n')
      : ''

const PROTECTED = /(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/[^\s<>()]+/g

type Hit = { start: number; end: number; label: string; url: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeLabel = (s: string) => s.replace(/[[\]]/g, '\\$&')

const githubUrl = (reg: Registry, repo: string | null, n: string, kind: 'pull' | 'issues'): string | null => {
  const r = repo ?? reg.repo ?? reg.seenRepo
  if (!r) return null
  return reg.numbers.get(`${r}#${n}`) ?? `https://github.com/${r}/${kind}/${n}`
}

const RULES: ((text: string, reg: Registry) => Hit[])[] = [
  (text, reg) =>
    [...text.matchAll(/(?<![\w/.-])([\w.-]+\/[\w.-]+)#(\d+)\b/g)].map(m => ({ start: m.index, end: m.index + m[0].length, label: m[0], url: githubUrl(reg, m[1]!, m[2]!, 'issues')! })),
  (text, reg) =>
    [...text.matchAll(/\b(?:PRs?|[Pp]ull request)\s*#?(\d{1,6})\b/g)].flatMap(m => {
      const url = githubUrl(reg, null, m[1]!, 'pull')
      return url ? [{ start: m.index, end: m.index + m[0].length, label: m[0], url }] : []
    }),
  (text, reg) =>
    [...text.matchAll(/(?<=^|[\s(])#(\d{2,6})\b(?![.,]\d)/gm)].flatMap(m => {
      const url = githubUrl(reg, null, m[1]!, 'issues')
      return url ? [{ start: m.index, end: m.index + m[0].length, label: m[0], url }] : []
    }),
  text =>
    [...text.matchAll(/\b(agent_\w{10,}|conv_\w{10,})\b/g)].map(m => ({
      start: m.index,
      end: m.index + m[0].length,
      label: m[0],
      url: m[1]!.startsWith('agent_') ? `https://elevenlabs.io/app/agents/agents/${m[1]}` : `https://elevenlabs.io/app/agents/history/${m[1]}`,
    })),
]

const nameHits = (text: string, reg: Registry, linked: Set<string>): Hit[] => {
  const hits: Hit[] = []
  const names = [...reg.names.keys()].sort((a, b) => b.length - a.length)
  for (const name of names) {
    if (linked.has(name)) continue
    const m = new RegExp(`(?<![\\w/])${escapeRe(name)}(?!\\w)`).exec(text)
    if (!m) continue
    hits.push({ start: m.index, end: m.index + name.length, label: name, url: reg.names.get(name)! })
    linked.add(name)
  }
  return hits
}

const linkPlain = (text: string, reg: Registry, linked: Set<string>): string => {
  const all = [...RULES.flatMap(rule => rule(text, reg)), ...nameHits(text, reg, linked)].sort((a, b) => a.start - b.start || b.end - a.end)
  let out = ''
  let at = 0
  for (const hit of all) {
    if (hit.start < at) continue
    out += text.slice(at, hit.start) + `[${escapeLabel(hit.label)}](${hit.url})`
    at = hit.end
  }
  return out + text.slice(at)
}

export const linkify = (text: string, reg: Registry): string => {
  const linked = new Set<string>()
  let out = ''
  let at = 0
  for (const m of text.matchAll(PROTECTED)) {
    out += linkPlain(text.slice(at, m.index), reg, linked) + m[0]
    at = m.index + m[0].length
  }
  return out + linkPlain(text.slice(at), reg, linked)
}
