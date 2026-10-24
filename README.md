# reply-links

A Claude Code mod that turns the things Claude names in a reply into clickable links: pull requests, issues, Google Drive files, ElevenLabs agents, and anything else a tool result gave a name and a URL for.

It is deterministic. It runs no model calls, so it adds no tokens or cost per reply, and it makes no network requests.

## Install

At the prompt of a terminal session:

```
/plugin install reply-links --marketplace orgonag/reply-links
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install reply-links --marketplace orgonag/reply-links
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `orgonag/reply-links`, then Add plugin.

Needs a Claude Code build with mods (2.1.287 or later).

## What it links

| Claude writes | Becomes a link to |
| --- | --- |
| `PR 306`, `PR #306`, `pull request 306` | The pull request in the session's GitHub repository |
| `#298` (two digits or more) | The issue or pull request with that number (GitHub redirects an issue link to a PR) |
| `owner/repo#12` | That repository's issue or pull request |
| A name a tool returned with a URL, such as a Drive file's `name` and `webViewLink` | That URL, on its first mention in the reply |
| A Google Drive item returned with an `id` and `mimeType` but no link | `https://drive.google.com/open?id=<id>` |
| `agent_…` and `conv_…` ElevenLabs ids, and an agent's name from a tool result | The agent or conversation in the ElevenLabs dashboard |
| A Supabase project returned with its ref and region | The project's dashboard |

The repository comes from the session folder's `origin` remote. Outside a GitHub repository, the mod uses the last repository it saw in a GitHub URL in tool output (for example from `gh pr view` or `gh pr create`), and when a tool printed the exact URL for a number, that URL wins.

It never changes code blocks, inline code, links Claude already wrote, bare URLs, or HTML. `#1` and other single-digit numbers stay text, and so does a number with no repository to point at.

## How it works

The mod hooks one event, `session.append`, which Claude Code raises for every row it adds to a conversation. Of those rows it changes only one kind: the text of Claude's own replies in the main conversation, where it adds markdown links. It reads tool results without changing them, and it leaves every other row alone, including your prompts, tool calls, subagent replies and rows other mods or code append. It makes no network requests and runs no commands.

In detail:

- **Tool results** (`door: tool-result`): it reads each result for GitHub pull request and issue URLs, and parses JSON for objects that carry a name (`name`, `title`, `displayName`, `filename`, ...) beside a web URL (`webViewLink`, `html_url`, `url`, `link`, ...) or an id it knows how to turn into one.
- **Replies** (`door: response`): it rewrites the text blocks of each main-conversation reply with markdown links before the reply is saved.

Because the link becomes part of the reply's markdown, any renderer draws it, including the plain Claude Code renderer and mods that redraw replies such as prismantis. A reply streams in as plain text and gains its links once it finishes.

When the session starts (and after a reload) it rebuilds what it learned from the tool results already in the conversation.

## Limits

- A name links only after a tool in the session has returned it with a URL. Names shorter than 4 characters, or made only of digits, are skipped.
- Only the first mention of a learned name is linked in each reply.
- Subagent replies are left alone.
- The links are stored in the transcript, so the model sees them in later turns too (a few extra tokens per link).

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## License

MIT
