import type { ReactNode } from "react"

function safeUrl(url: string) {
  if (url.startsWith("/") && !url.startsWith("//")) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function inline(text: string, key: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|_[^_\n]+_|https?:\/\/[^\s)]+)/g
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const token = match[0]
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${key}-b-${index}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("_") && token.endsWith("_")) {
      nodes.push(<em key={`${key}-i-${index}`}>{token.slice(1, -1)}</em>)
    } else if (safeUrl(token)) {
      nodes.push(
        <a key={`${key}-a-${index}`} href={token} className="underline decoration-teal/40" target="_blank" rel="noreferrer">
          {token}
        </a>,
      )
    } else {
      nodes.push(token)
    }
    last = start + token.length
    index += 1
  }
  if (last < text.length) nodes.push(text.slice(last))
  const withLinks: ReactNode[] = []
  nodes.forEach((node, nodeIndex) => {
    if (typeof node !== "string") {
      withLinks.push(node)
      return
    }
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
    let cursor = 0
    for (const link of node.matchAll(linkPattern)) {
      const start = link.index ?? 0
      if (start > cursor) withLinks.push(node.slice(cursor, start))
      const href = link[2]
      if (safeUrl(href)) {
        withLinks.push(
          <a key={`${key}-l-${nodeIndex}-${start}`} href={href} className="underline decoration-teal/40">
            {link[1]}
          </a>,
        )
      } else {
        withLinks.push(link[0])
      }
      cursor = start + link[0].length
    }
    if (cursor < node.length) withLinks.push(node.slice(cursor))
  })
  return withLinks
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = (key: string) => {
    if (!list.length) return
    blocks.push(
      <ul key={key} className="list-disc space-y-1 pl-5">
        {list.map((item, index) => (
          <li key={`${key}-${index}`}>{inline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    )
    list = []
  }
  lines.forEach((line, index) => {
    const key = `line-${index}`
    if (line.startsWith("- ")) {
      list.push(line.slice(2))
      return
    }
    flush(`list-before-${index}`)
    if (line.startsWith("## ")) {
      blocks.push(<h3 key={key} className="font-serif text-xl">{inline(line.slice(3), key)}</h3>)
    } else if (line.startsWith("# ")) {
      blocks.push(<h2 key={key} className="font-serif text-2xl">{inline(line.slice(2), key)}</h2>)
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push(<p key={key}>{inline(line, key)}</p>)
    } else if (line.trim() === "") {
      blocks.push(<div key={key} className="h-2" />)
    } else {
      blocks.push(<p key={key}>{inline(line, key)}</p>)
    }
  })
  flush("list-end")
  return <div className="rich space-y-1 leading-relaxed">{blocks}</div>
}
