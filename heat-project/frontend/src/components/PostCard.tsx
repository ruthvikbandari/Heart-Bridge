import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../lib/api"
import { formatWhen, topicLabel, type Comment, type Meta, type Post } from "../lib/types"
import { Alert, Avatar, Button, Modal } from "./ui"

export function PostCard({ post }: { post: Post }) {
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const [revealed, setRevealed] = useState(!post.content_warning)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(post.body)
  const [reporting, setReporting] = useState(false)
  const [message, setMessage] = useState("")
  const queryClient = useQueryClient()

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["posts"] })
    queryClient.invalidateQueries({ queryKey: ["post", post.id] })
    queryClient.invalidateQueries({ queryKey: ["bookmarks"] })
  }

  const react = useMutation({
    mutationFn: (reaction_type: string) =>
      api<Post>(`/api/posts/${post.id}/reactions`, { method: "POST", body: JSON.stringify({ reaction_type }) }),
    onSuccess: refresh,
  })
  const save = useMutation({
    mutationFn: () => api(`/api/posts/${post.id}/bookmark`, { method: "POST" }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/posts/${post.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
  const edit = useMutation({
    mutationFn: () =>
      api(`/api/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          body,
          visibility: post.visibility,
          topics: post.topics,
          content_warning: post.content_warning,
          community_id: post.community?.id ?? null,
          is_anonymous: post.is_anonymous,
          image_url: post.image_url,
        }),
      }),
    onSuccess: () => {
      setEditing(false)
      setMessage("Edits saved.")
      refresh()
    },
  })

  return (
    <article className="rounded-3xl border border-line bg-paper p-5">
      <div className="flex items-start gap-3">
        <Avatar name={post.author.display_name} color={post.author.avatar_color} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {post.author.id ? (
              <Link to={`/profile/${post.author.id}`} className="font-medium hover:underline">
                {post.author.display_name}
              </Link>
            ) : (
              <span className="font-medium">{post.author.display_name}</span>
            )}
            {post.author.anonymous ? <span className="rounded-full bg-lavender px-2 py-0.5 text-xs">Anonymous here</span> : null}
            <span className="text-sm text-muted">{formatWhen(post.created_at)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full bg-sky px-2 py-0.5">{post.visibility}</span>
            {post.community ? <Link to={`/communities/${post.community.slug}`}>{post.community.name}</Link> : null}
            {post.topics.map((topic) => (
              <span key={topic}>{topicLabel(meta?.topics, topic)}</span>
            ))}
          </div>
        </div>
      </div>
      {post.content_warning && !revealed ? (
        <div className="mt-4 rounded-2xl bg-lavender p-4">
          <p className="text-sm">Content note: {post.content_warning}</p>
          <Button className="mt-3" variant="ghost" onClick={() => setRevealed(true)}>
            Show post
          </Button>
        </div>
      ) : editing ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            edit.mutate()
          }}
        >
          <textarea className="min-h-28 w-full rounded-2xl border border-line p-3" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" disabled={edit.isPending}>Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 whitespace-pre-wrap leading-relaxed">{post.body}</p>
      )}
      {post.image_url && revealed ? (
        <figure className="mt-4">
          <img src={post.image_url} alt="" className="max-h-80 rounded-2xl object-cover" />
          <figcaption className="text-xs text-muted">Image hidden in low-bandwidth mode.</figcaption>
        </figure>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {(meta?.reactions ?? []).map((reaction) => (
          <button
            key={reaction.id}
            type="button"
            aria-pressed={post.my_reaction === reaction.id}
            className={`rounded-full border px-3 py-1 text-sm ${post.my_reaction === reaction.id ? "border-teal bg-sky" : "border-line"}`}
            onClick={() => react.mutate(reaction.id)}
          >
            {reaction.label} {post.reactions[reaction.id] || ""}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link to={`/posts/${post.id}`} className="font-medium text-teal">
          {post.comment_count} comments
        </Link>
        <button type="button" onClick={() => save.mutate()}>{post.bookmarked ? "Saved" : "Save"}</button>
        {post.visibility === "public" ? (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/posts/${post.id}`).then(() => setMessage("Link copied."))}
          >
            Copy link
          </button>
        ) : null}
        <button type="button" onClick={() => setReporting(true)}>Report</button>
        {post.mine ? (
          <>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" onClick={() => remove.mutate()}>Delete</button>
          </>
        ) : null}
      </div>
      {message ? <p className="mt-2 text-sm text-teal">{message}</p> : null}
      {react.error instanceof ApiError ? <p className="mt-2 text-sm text-warn">{react.error.message}</p> : null}
      {reporting ? <ReportDialog targetType="post" targetId={post.id} onClose={() => setReporting(false)} /> : null}
    </article>
  )
}

export function ReportDialog({
  targetType,
  targetId,
  onClose,
}: {
  targetType: string
  targetId: number
  onClose: () => void
}) {
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const [reason, setReason] = useState(meta?.report_reasons[0] ?? "Other")
  const [details, setDetails] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const submit = useMutation({
    mutationFn: () =>
      api("/api/reports", { method: "POST", body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }) }),
    onSuccess: () => setDone(true),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not send the report."),
  })
  return (
    <Modal title="Report" onClose={onClose}>
      {done ? (
        <Alert tone="ok">Report sent. A moderator can review it. The content is not copied into their notification.</Alert>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <select className="w-full rounded-2xl border border-line p-3" value={reason} onChange={(event) => setReason(event.target.value)}>
            {(meta?.report_reasons ?? ["Other"]).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <textarea className="min-h-24 w-full rounded-2xl border border-line p-3" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Optional context for moderators" />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={submit.isPending}>Submit report</Button>
        </form>
      )}
    </Modal>
  )
}

export function CommentList({ postId }: { postId: number }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => api<{ items: Comment[] }>(`/api/posts/${postId}/comments`),
  })
  const [body, setBody] = useState("")
  const [parentId, setParentId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const send = useMutation({
    mutationFn: () => api(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body, parent_id: parentId }) }),
    onSuccess: () => {
      setBody("")
      setParentId(null)
      queryClient.invalidateQueries({ queryKey: ["comments", postId] })
      queryClient.invalidateQueries({ queryKey: ["post", postId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not post that comment."),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/comments/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["comments", postId] }),
  })
  const harsh = /\b(idiot|stupid|hate you|shut up)\b/i.test(body)
  if (isLoading) return <p className="text-sm text-muted">Loading comments…</p>
  if (isError) return <Button variant="ghost" onClick={() => refetch()}>Could not load comments. Retry</Button>
  const items = data?.items ?? []
  const roots = items.filter((item) => !item.parent_id)
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-2xl">Comments</h2>
      {roots.length === 0 ? <p className="text-muted">No comments yet. A short, specific reply is enough.</p> : null}
      {roots.map((comment) => (
        <div key={comment.id} className="rounded-2xl bg-cream p-4">
          <div className="flex items-center gap-2">
            <Avatar name={comment.author.display_name} color={comment.author.avatar_color} />
            <strong>{comment.author.display_name}</strong>
            <span className="text-sm text-muted">{formatWhen(comment.created_at)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" onClick={() => setParentId(comment.id)}>Reply</button>
            {comment.mine ? <button type="button" onClick={() => remove.mutate(comment.id)}>Delete</button> : null}
          </div>
          <div className="mt-3 space-y-2 border-l border-line pl-4">
            {items.filter((item) => item.parent_id === comment.id).map((reply) => (
              <div key={reply.id}>
                <p className="text-sm font-medium">{reply.author.display_name}</p>
                <p className="whitespace-pre-wrap">{reply.body}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (harsh && !window.confirm("This reply may land harshly. Send it anyway?")) return
          send.mutate()
        }}
      >
        {parentId ? <p className="text-sm">Replying to a comment. <button type="button" onClick={() => setParentId(null)}>Cancel reply</button></p> : null}
        <label className="block text-sm font-medium" htmlFor="comment-body">Write a comment</label>
        <textarea id="comment-body" className="min-h-24 w-full rounded-2xl border border-line p-3" value={body} onChange={(event) => setBody(event.target.value)} />
        {harsh ? <Alert tone="info">This looks harsh. You can edit it before sending.</Alert> : null}
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={send.isPending || !body.trim()}>Post comment</Button>
      </form>
    </section>
  )
}
