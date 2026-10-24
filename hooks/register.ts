import type { EngineInterface, Register } from 'claude-code'
import { emptyRegistry, harvest, linkify, repoFromRemote, resultText, type Registry } from './links'

const seen: { reg: Registry } = { reg: emptyRegistry() }

async function readRepo($: EngineInterface, reg: Registry) {
  const repo = await $.session.repo()
  reg.repo = repo?.remote ? repoFromRemote(repo.remote) : null
}

async function rebuild($: EngineInterface): Promise<Registry> {
  const fresh = emptyRegistry()
  const messages = await $.session.messages({ as: 'api' })
  const tools = new Map<string, string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') tools.set(String(block.id), String(block.name))
      if (block.type === 'tool_result') harvest(resultText(block.content), tools.get(String(block.tool_use_id)) ?? '', fresh)
    }
  }
  return fresh
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    seen.reg = await rebuild($).catch(() => emptyRegistry())
    return started
  })

  on('session.append', { door: 'tool-result' }, ($, e, next) => {
    const tool = e.origin.kind === 'tool' ? e.origin.tool : ''
    for (const block of e.message.content) if (block.type === 'tool_result') harvest(resultText(block.content), tool, seen.reg)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId !== undefined || e.message.type !== 'assistant') return next(e)
    await readRepo($, seen.reg).catch(() => undefined)
    const content = e.message.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? { ...block, text: linkify(block.text, seen.reg) } : block))
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))
}
