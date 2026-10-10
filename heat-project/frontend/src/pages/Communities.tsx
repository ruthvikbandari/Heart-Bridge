import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { PostCard } from "../components/PostCard"
import { Alert, Button, Empty, Spinner, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { formatWhen, topicLabel, type Community, type Meta, type Post } from "../lib/types"

export function Communities() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["communities"],
    queryFn: () => api<{ items: Community[] }>("/api/communities"),
  })
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  if (isLoading) return <Spinner label="Loading communities" />
  if (isError) return <Button onClick={() => refetch()}>Could not load communities. Retry</Button>
  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="font-serif text-4xl">Communities</h1>
        <p className="mt-2 max-w-2xl text-muted">Groups are organised by topics you can choose. Suggestions do not come from private chats.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {(data?.items ?? []).map((community) => (
          <article key={community.id} className="rounded-3xl border border-line bg-paper p-5">
            <p className="text-xs uppercase tracking-wide text-teal">{topicLabel(meta.data?.topics, community.topic)}</p>
            <h2 className="mt-1 font-serif text-2xl"><Link to={`/communities/${community.slug}`}>{community.name}</Link></h2>
            <p className="mt-2 text-sm text-muted">{community.description}</p>
            <p className="mt-3 text-sm">{community.member_count} members · {community.visibility}</p>
            <p className="mt-2 text-xs text-muted">{community.why}</p>
          </article>
        ))}
      </div>
      {data?.items.length === 0 ? <Empty title="No communities yet" body="A moderator can create the first space." /> : null}
    </div>
  )
}

export function CommunityDetail() {
  const { slug } = useParams()
  const queryClient = useQueryClient()
  const community = useQuery({
    queryKey: ["community", slug],
    queryFn: () => api<Community>(`/api/communities/${slug}`),
  })
  const posts = useQuery({
    queryKey: ["community-posts", community.data?.id],
    queryFn: () => api<{ items: Post[] }>(`/api/communities/${community.data?.id}/posts`),
    enabled: Boolean(community.data && !community.data.locked),
  })
  const [alias, setAlias] = useState("")
  const [error, setError] = useState("")
  const [eventTitle, setEventTitle] = useState("")
  const [eventWhen, setEventWhen] = useState("")
  const join = useMutation({
    mutationFn: () => api(`/api/communities/${community.data?.id}/join`, { method: "POST", body: JSON.stringify({ anonymous_name: alias || null }) }),
    onSuccess: () => {
      setError("")
      queryClient.invalidateQueries({ queryKey: ["community", slug] })
      queryClient.invalidateQueries({ queryKey: ["community-posts"] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not update membership."),
  })
  const leave = useMutation({
    mutationFn: () => api(`/api/communities/${community.data?.id}/join`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["community", slug] }),
  })
  if (community.isLoading) return <Spinner label="Loading community" />
  if (community.isError || !community.data) return <Empty title="Community unavailable" body="It may have been removed." />
  const item = community.data
  return (
    <div className="w-full space-y-6">
      <header>
        <p className="text-sm text-teal">{item.visibility === "private" ? "Private group" : "Public group"}</p>
        <h1 className="font-serif text-4xl">{item.name}</h1>
        <p className="mt-2 text-muted">{item.description}</p>
        <p className="mt-2 text-sm">{item.member_count} members</p>
        <p className="mt-3 rounded-2xl bg-lavender px-4 py-3 text-sm">{item.notice}</p>
      </header>
      {item.guidelines ? <section className="rounded-3xl border border-line bg-paper p-5"><h2 className="font-serif text-2xl">Guidelines</h2><p className="mt-2 whitespace-pre-wrap">{item.guidelines}</p></section> : null}
      <div className="flex flex-wrap gap-2">
        {item.membership?.status === "member" ? (
          <Button variant="ghost" onClick={() => leave.mutate()}>Leave</Button>
        ) : (
          <Button onClick={() => join.mutate()} disabled={join.isPending}>{item.visibility === "private" ? "Request to join" : "Join"}</Button>
        )}
        {item.membership?.status === "pending" ? <span className="text-sm text-muted">Request pending</span> : null}
      </div>
      {item.allow_anonymous && item.membership?.status !== "member" ? (
        <label className="block text-sm">Anonymous name in this group
          <input className={`${controlClass} mt-1`} value={alias} onChange={(event) => setAlias(event.target.value)} />
        </label>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {item.can_review && item.pending_requests.length ? (
        <section className="rounded-3xl border border-line bg-paper p-5">
          <h2 className="font-serif text-2xl">Join requests</h2>
          {item.pending_requests.map((request) => (
            <div key={request.user_id} className="mt-3 flex items-center justify-between gap-3">
              <span>{request.display_name}</span>
              <div className="flex gap-2">
                <Button onClick={() => api(`/api/communities/${item.id}/members/${request.user_id}`, { method: "PATCH", body: JSON.stringify({ status: "member" }) }).then(() => community.refetch())}>Approve</Button>
                <Button variant="ghost" onClick={() => api(`/api/communities/${item.id}/members/${request.user_id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) }).then(() => community.refetch())}>Decline</Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {item.resources.length ? (
        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Resources</h2>
          {item.resources.map((resource) => (
            <article key={resource.id} className="rounded-3xl border border-line bg-paper p-4">
              <h3 className="font-medium">{resource.url ? <a href={resource.url} className="text-teal" target="_blank" rel="noreferrer">{resource.title}</a> : resource.title}</h3>
              <p className="mt-1 text-sm">{resource.summary}</p>
              <p className="mt-2 text-xs text-muted">{resource.source_label} · reviewed {resource.last_reviewed}</p>
            </article>
          ))}
        </section>
      ) : null}
      {item.events.length ? (
        <section>
          <h2 className="font-serif text-2xl">Events</h2>
          {item.events.map((event) => (
            <article key={event.id} className="mt-3 rounded-3xl bg-sky p-4">
              <h3 className="font-medium">{event.title}</h3>
              <p className="text-sm">{formatWhen(event.starts_at)}</p>
              <p className="mt-1 text-sm">{event.description}</p>
            </article>
          ))}
        </section>
      ) : null}
      {item.can_review ? (
        <form
          className="space-y-2 rounded-3xl border border-line bg-paper p-4"
          onSubmit={(event) => {
            event.preventDefault()
            api(`/api/communities/${item.id}/events`, {
              method: "POST",
              body: JSON.stringify({ title: eventTitle, description: "Community event", starts_at: new Date(eventWhen).toISOString() }),
            }).then(() => {
              setEventTitle("")
              community.refetch()
            })
          }}
        >
          <h2 className="font-serif text-2xl">Schedule an event</h2>
          <input className={controlClass} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Title" required />
          <input className={controlClass} type="datetime-local" value={eventWhen} onChange={(event) => setEventWhen(event.target.value)} required />
          <Button type="submit">Add event</Button>
        </form>
      ) : null}
      {item.locked ? <Empty title="This group is private" body="Request to join. Discussions stay hidden until a moderator approves you." /> : null}
      {!item.locked ? (
        posts.isLoading ? <Spinner label="Loading discussions" /> : posts.isError ? <Button onClick={() => posts.refetch()}>Could not load posts. Retry</Button> : (
          <div className="space-y-4">
            {(posts.data?.items ?? []).map((post) => <PostCard key={post.id} post={post} />)}
            {posts.data?.items.length === 0 ? <Empty title="No discussions yet" body="Members can post from Home by choosing this community." /> : null}
          </div>
        )
      ) : null}
      <p className="text-sm text-muted">Moderators: {item.moderators.join(", ") || "Not listed"}</p>
    </div>
  )
}
