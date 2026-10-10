export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized = () => {}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function readDetail(response: Response) {
  try {
    const data = (await response.json()) as { detail?: unknown }
    if (typeof data.detail === "string") return data.detail
  } catch {
    return response.statusText
  }
  return "Something went wrong. Please try again."
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const response = await fetch(path, { ...options, headers, credentials: "include" })
  if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) {
    onUnauthorized()
  }
  if (!response.ok) throw new ApiError(response.status, await readDetail(response))
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export type SseEvent = {
  token?: string
  error?: string
  done?: boolean
  demo?: boolean
  safety?: string | null
  message_id?: number | null
  next_step?: { id: number; action: string; clinician_question: string; resource: string } | null
}

export async function streamSse(path: string, body: unknown, onEvent: (event: SseEvent) => void, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (response.status === 401) onUnauthorized()
  if (!response.ok || !response.body) throw new ApiError(response.status, await readDetail(response))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data:"))
      if (!line) continue
      onEvent(JSON.parse(line.slice(5).trim()) as SseEvent)
    }
  }
}
