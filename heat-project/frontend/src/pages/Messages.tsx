import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ReportDialog } from "../components/PostCard"
import { Alert, Button, Empty, Spinner, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { formatWhen, type Conversation, type DirectMessage } from "../lib/types"

export function Messages() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ items: Conversation[] }>("/api/conversations"),
    refetchInterval: 8000,
  })
  const thread = useQuery({
    queryKey: ["thread", id],
    queryFn: () => api<{ conversation: Conversation; items: DirectMessage[] }>(`/api/conversations/${id}/messages`),
    enabled: Boolean(id),
    refetchInterval: 8000,
  })
  const [body, setBody] = useState("")
  const [error, setError] = useState("")
  const [reporting, setReporting] = useState<number | null>(null)
  const send = useMutation({
    mutationFn: () => api(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => {
      setBody("")
      setError("")
      queryClient.invalidateQueries({ queryKey: ["thread", id] })
      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not send."),
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["conversations"] })
    queryClient.invalidateQueries({ queryKey: ["thread", id] })
    queryClient.invalidateQueries({ queryKey: ["inbox"] })
  }

  const conversation = thread.data?.conversation
  const incoming = (list.data?.items ?? []).filter((item) => item.status === "request" && item.created_by === item.other?.id)

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-line bg-paper p-4">
        <h1 className="font-serif text-3xl">Messages</h1>
        <p className="mt-1 text-xs text-muted">Updates arrive live when the socket is open, and this list also refreshes on a timer.</p>
        {list.isLoading ? <Spinner label="Loading inbox" /> : null}
        {list.isError ? <Button onClick={() => list.refetch()}>Retry</Button> : null}
        <ul className="mt-4 space-y-2">
          {(list.data?.items ?? []).map((item) => (
            <li key={item.id}>
              <Link to={`/messages/${item.id}`} className={`block rounded-2xl px-3 py-2 ${String(item.id) === id ? "bg-sky" : "hover:bg-cream"}`} onClick={() => api(`/api/conversations/${item.id}/read`, { method: "POST" }).then(refresh)}>
                <span className="flex justify-between gap-2 font-medium">
                  {item.other?.display_name ?? "Member"}
                  {item.unread ? <span className="rounded-full bg-teal px-2 text-xs text-white">{item.unread}</span> : null}
                </span>
                <span className="text-sm text-muted">{item.status === "request" ? "Message request" : item.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
        {list.data && list.data.items.length === 0 ? <p className="mt-4 text-sm text-muted">No conversations yet. Open a profile and send a request.</p> : null}
      </aside>
      <section className="rounded-3xl border border-line bg-paper p-4">
        {!id ? <Empty title="Choose a conversation" body="New contacts stay in a request until you accept." /> : null}
        {thread.isLoading && id ? <Spinner label="Loading messages" /> : null}
        {thread.isError ? <Alert>This conversation is unavailable. It may be blocked or closed.</Alert> : null}
        {conversation ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <h2 className="font-serif text-3xl">{conversation.other?.display_name}</h2>
                <p className="text-sm text-muted">{conversation.status === "request" ? "Request" : conversation.status === "declined" ? "Declined" : "Active"} · {conversation.muted ? "Muted" : "Notifications on"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {conversation.status === "request" && conversation.created_by === conversation.other?.id ? (
                  <>
                    <Button onClick={() => api(`/api/conversations/${conversation.id}/accept`, { method: "POST" }).then(refresh)}>Accept</Button>
                    <Button variant="ghost" onClick={() => api(`/api/conversations/${conversation.id}/decline`, { method: "POST" }).then(refresh)}>Decline</Button>
                  </>
                ) : null}
                <Button variant="ghost" onClick={() => api(`/api/conversations/${conversation.id}/mute`, { method: "POST", body: JSON.stringify({ muted: !conversation.muted }) }).then(refresh)}>
                  {conversation.muted ? "Unmute" : "Mute"}
                </Button>
                {conversation.other ? <Button variant="danger" onClick={() => api("/api/blocks", { method: "POST", body: JSON.stringify({ user_id: conversation.other?.id }) }).then(refresh)}>Block</Button> : null}
              </div>
            </header>
            <div className="mt-4 space-y-3">
              {(thread.data?.items ?? []).map((message) => (
                <article key={message.id} className={`max-w-[80%] rounded-3xl px-4 py-3 ${message.mine ? "ml-auto bg-sky" : "bg-cream"}`}>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <div className="mt-2 flex gap-3 text-xs text-muted">
                    <span>{formatWhen(message.created_at)}</span>
                    <button type="button" onClick={() => setReporting(message.id)}>Report</button>
                  </div>
                </article>
              ))}
            </div>
            {conversation.status === "active" ? (
              <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); send.mutate() }}>
                <label className="text-sm" htmlFor="dm">Message</label>
                <textarea id="dm" className={`${controlClass} min-h-20`} value={body} onChange={(event) => setBody(event.target.value)} />
                {error ? <Alert>{error}</Alert> : null}
                <Button type="submit" disabled={send.isPending || !body.trim()}>Send</Button>
              </form>
            ) : <p className="mt-4 text-sm text-muted">More messages wait until this request is accepted.</p>}
          </>
        ) : null}
        {reporting ? <ReportDialog targetType="message" targetId={reporting} onClose={() => setReporting(null)} /> : null}
        {incoming.length > 0 && !id ? <p className="mt-4 text-sm text-muted">{incoming.length} incoming request{incoming.length === 1 ? "" : "s"} in the list.</p> : null}
      </section>
    </div>
  )
}
