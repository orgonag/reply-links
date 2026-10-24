import { expect, test } from 'claude-code/testing'
import { emptyRegistry, harvest, linkify, repoFromRemote } from '../hooks/links'

const withRepo = () => ({ ...emptyRegistry(), repo: 'acme/site' })

test('reads the GitHub repo from https and ssh remotes', async () => {
  expect(repoFromRemote('https://github.com/acme/site.git\n')).toBe('acme/site')
  expect(repoFromRemote('git@github.com:acme/site.git')).toBe('acme/site')
  expect(repoFromRemote('https://gitlab.com/acme/site.git')).toBe(null)
})

test('links PR numbers, bare issue numbers and owner/repo refs', async () => {
  const reg = withRepo()
  expect(linkify('PR 306 merged.', reg)).toBe('[PR 306](https://github.com/acme/site/pull/306) merged.')
  expect(linkify('PR #306 merged.', reg)).toBe('[PR #306](https://github.com/acme/site/pull/306) merged.')
  expect(linkify('Close card #298 now.', reg)).toBe('Close card [#298](https://github.com/acme/site/issues/298) now.')
  expect(linkify('See other/repo#12.', reg)).toBe('See [other/repo#12](https://github.com/other/repo/issues/12).')
})

test('leaves numbers alone where they are not references', async () => {
  const reg = withRepo()
  expect(linkify('the #1 priority, 16 pages, 9:42 PM', reg)).toBe('the #1 priority, 16 pages, 9:42 PM')
  expect(linkify('PR 306 merged.', emptyRegistry())).toBe('PR 306 merged.')
})

test('never touches code, existing links or URLs', async () => {
  const reg = withRepo()
  const text = 'Run `gh pr view 306`.\n\n```bash\ngh pr merge 306 # PR 306\n```\n\n[PR 306](https://x.test/1) and https://github.com/acme/site/pull/306'
  expect(linkify(text, reg)).toBe(text)
})

test('prefers the exact URL a tool returned for a number', async () => {
  const reg = withRepo()
  harvest('Created https://github.com/acme/site/pull/307', 'Bash', reg)
  expect(linkify('PR 307', reg)).toBe('[PR 307](https://github.com/acme/site/pull/307)')
})

test('falls back to the repo seen in tool output when the folder has none', async () => {
  const reg = emptyRegistry()
  harvest('https://github.com/acme/site/pull/5', 'Bash', reg)
  expect(linkify('PR 9 is open', reg)).toBe('[PR 9](https://github.com/acme/site/pull/9) is open')
})

test('learns Drive files by name and links the first mention only', async () => {
  const reg = emptyRegistry()
  harvest(JSON.stringify({ files: [{ id: 'abc123', name: 'Q3 Board Deck', mimeType: 'application/vnd.google-apps.presentation', webViewLink: 'https://docs.google.com/presentation/d/abc123/edit' }] }), 'mcp__drive__search_files', reg)
  expect(linkify('Q3 Board Deck is ready. Q3 Board Deck has 12 slides.', reg)).toBe('[Q3 Board Deck](https://docs.google.com/presentation/d/abc123/edit) is ready. Q3 Board Deck has 12 slides.')
})

test('builds a Drive link from an id when no link was returned', async () => {
  const reg = emptyRegistry()
  harvest('[{"id":"xyz","name":"Budget 2027","mimeType":"application/vnd.google-apps.spreadsheet"}]', 'mcp__drive__search_files', reg)
  expect(linkify('Open Budget 2027.', reg)).toBe('Open [Budget 2027](https://drive.google.com/open?id=xyz).')
})

test('links ElevenLabs agents by id and by name', async () => {
  const reg = emptyRegistry()
  harvest('{"agents":[{"agent_id":"agent_01abcdefghijklmnop","name":"Front Desk"}]}', 'mcp__x__agents_list', reg)
  expect(linkify('Front Desk (agent_01abcdefghijklmnop)', reg)).toBe(
    '[Front Desk](https://elevenlabs.io/app/agents/agents/agent_01abcdefghijklmnop) ([agent_01abcdefghijklmnop](https://elevenlabs.io/app/agents/agents/agent_01abcdefghijklmnop))',
  )
})

test('ignores short or numeric names, and tool output that is not JSON', async () => {
  const reg = emptyRegistry()
  harvest('[{"name":"api","url":"https://a.test"},{"name":"2026","url":"https://b.test"}]', 'x', reg)
  harvest('plain text with no json', 'x', reg)
  expect(reg.names.size).toBe(0)
})
