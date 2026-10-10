import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { PostCard } from "../components/PostCard"
import { Alert, Button, Empty, Spinner, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import { formatWhen, type Me, type Meta, type Post } from "../lib/types"

export function ProfilePage() {
  const { id } = useParams()
  const { user, refresh } = useAuth()
  const target = id ?? String(user?.id ?? "")
  const mine = !id || Number(id) === user?.id
  const profile = useQuery({
    queryKey: ["profile", target],
    queryFn: () => api<{ id: number; profile: Me["profile"]; interests: string[]; followed: boolean; mine: boolean }>(`/api/users/${target}`),
    enabled: Boolean(target),
  })
  const posts = useQuery({
    queryKey: ["user-posts", target],
    queryFn: () => api<{ items: Post[] }>(`/api/users/${target}/posts`),
    enabled: Boolean(target),
  })
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const [name, setName] = useState("")
  const [bio, setBio] = useState("")
  const [language, setLanguage] = useState("en")
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState("")
  const [recipient, setRecipient] = useState(false)
  const [request, setRequest] = useState("Hello, I would like to talk.")
  const queryClient = useQueryClient()
  if (profile.isLoading) return <Spinner label="Loading profile" />
  if (profile.isError || !profile.data) return <Empty title="Profile unavailable" body="This member may have blocked you, or the account is gone." />
  const data = profile.data
  return (
    <div className="w-full space-y-6">
      <header className="rounded-3xl border border-line bg-paper p-5">
        <h1 className="font-serif text-4xl">{data.profile.display_name}</h1>
        <p className="mt-2 whitespace-pre-wrap">{data.profile.bio || "No bio yet."}</p>
        <p className="mt-2 text-sm text-muted">Language preference: {meta.data?.languages.find((item) => item.id === data.profile.language)?.label ?? data.profile.language}</p>
        {data.interests.length ? <p className="mt-2 text-sm">Topics they chose to show: {data.interests.join(", ")}</p> : <p className="mt-2 text-sm text-muted">Topics are hidden unless this member opted in.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {mine ? <Button onClick={() => { setEditing(true); setName(data.profile.display_name); setBio(data.profile.bio); setLanguage(data.profile.language) }}>Edit profile</Button> : (
            <>
              <Button onClick={() => api(data.followed ? `/api/users/${data.id}/follow` : `/api/users/${data.id}/follow`, { method: data.followed ? "DELETE" : "POST" }).then(() => profile.refetch())}>{data.followed ? "Unfollow" : "Follow"}</Button>
              <Button variant="ghost" onClick={() => setRecipient(true)}>Message request</Button>
              <Button variant="danger" onClick={() => api("/api/blocks", { method: "POST", body: JSON.stringify({ user_id: data.id }) }).then(() => setMessage("Blocked. Their posts and messages are hidden."))}>Block</Button>
            </>
          )}
        </div>
        {message ? <p className="mt-3 text-sm text-teal">{message}</p> : null}
      </header>
      {editing ? (
        <form className="space-y-3 rounded-3xl border border-line bg-paper p-5" onSubmit={async (event) => {
          event.preventDefault()
          const me = await api<Me>("/api/me", { method: "PATCH", body: JSON.stringify({ display_name: name, bio, language }) })
          refresh()
          setMessage(`Saved for ${me.profile.display_name}.`)
          setEditing(false)
          profile.refetch()
        }}>
          <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
          <textarea className={controlClass} value={bio} onChange={(event) => setBio(event.target.value)} />
          <select className={controlClass} value={language} onChange={(event) => setLanguage(event.target.value)}>
            {(meta.data?.languages ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <Button type="submit">Save</Button>
        </form>
      ) : null}
      {recipient ? (
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault()
          try {
            const created = await api<{ id: number }>("/api/message-requests", { method: "POST", body: JSON.stringify({ recipient_id: data.id, body: request }) })
            setMessage("Request sent.")
            setRecipient(false)
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
            window.location.assign(`/messages/${created.id}`)
          } catch (err) {
            setMessage(err instanceof ApiError ? err.message : "Could not send the request.")
          }
        }}>
          <textarea className={controlClass} value={request} onChange={(event) => setRequest(event.target.value)} />
          <Button type="submit">Send request</Button>
        </form>
      ) : null}
      <div className="space-y-4">
        {(posts.data?.items ?? []).map((post) => <PostCard key={post.id} post={post} />)}
        {posts.data?.items.length === 0 ? <Empty title="No visible posts" body="Private drafts stay off this page for other people." /> : null}
      </div>
    </div>
  )
}

export function PrivacyPage() {
  const { refresh } = useAuth()
  const consents = useQuery({
    queryKey: ["consents"],
    queryFn: () => api<{ items: { key: string; title: string; description: string; enabled: boolean }[] }>("/api/privacy/consents"),
  })
  const [message, setMessage] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="font-serif text-4xl">Privacy</h1>
        <p className="mt-2 text-muted">These switches change what the server is allowed to use. They are not decorative.</p>
      </header>
      {consents.isLoading ? <Spinner label="Loading privacy settings" /> : null}
      {consents.isError ? <Button onClick={() => consents.refetch()}>Retry</Button> : null}
      <div className="space-y-3">
        {(consents.data?.items ?? []).map((item) => (
          <label key={item.key} className="flex gap-3 rounded-3xl border border-line bg-paper p-4">
            <input type="checkbox" checked={item.enabled} onChange={async (event) => {
              await api("/api/privacy/consents", { method: "PATCH", body: JSON.stringify({ consents: { [item.key]: event.target.checked } }) })
              setMessage("Saved.")
              consents.refetch()
              refresh()
            }} />
            <span>
              <span className="block font-medium">{item.title}</span>
              <span className="text-sm text-muted">{item.description}</span>
            </span>
          </label>
        ))}
      </div>
      {message ? <Alert tone="ok">{message}</Alert> : null}
      <section className="rounded-3xl border border-line bg-paper p-5">
        <h2 className="font-serif text-2xl">Export</h2>
        <p className="mt-2 text-sm text-muted">The file is created immediately in this demo. It is not emailed, and other people's direct messages are left out.</p>
        <Button className="mt-3" onClick={async () => {
          const data = await api<Record<string, unknown>>("/api/privacy/export-request", { method: "POST" })
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
          const url = URL.createObjectURL(blob)
          const link = document.createElement("a")
          link.href = url
          link.download = "heartbridge-export.json"
          link.click()
          URL.revokeObjectURL(url)
          setMessage("Export downloaded.")
        }}>Download my data</Button>
      </section>
      <form className="space-y-3 rounded-3xl border border-warn/30 bg-paper p-5" onSubmit={async (event) => {
        event.preventDefault()
        setError("")
        try {
          await api("/api/me", { method: "DELETE", body: JSON.stringify({ password, confirm }) })
          window.location.assign("/")
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not delete the account.")
        }
      }}>
        <h2 className="font-serif text-2xl">Delete account</h2>
        <p className="text-sm text-muted">This removes your chats, journal, posts, and sign-in. Type DELETE to confirm.</p>
        <input className={controlClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
        <input className={controlClass} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="DELETE" />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" variant="danger">Delete my account</Button>
      </form>
    </div>
  )
}

export function SavedPage() {
  const saved = useQuery({ queryKey: ["bookmarks"], queryFn: () => api<{ items: Post[] }>("/api/bookmarks") })
  if (saved.isLoading) return <Spinner label="Loading saved posts" />
  if (saved.isError) return <Button onClick={() => saved.refetch()}>Retry</Button>
  return (
    <div className="w-full space-y-4">
      <h1 className="font-serif text-4xl">Saved</h1>
      {(saved.data?.items ?? []).map((post) => <PostCard key={post.id} post={post} />)}
      {saved.data?.items.length === 0 ? <Empty title="Nothing saved" body="Save a post from the feed when you want to come back to it." /> : null}
    </div>
  )
}

export function NotificationsPage() {
  const notes = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: { id: number; title: string; body: string; link: string; read: boolean; created_at: string }[] }>("/api/notifications"),
  })
  const queryClient = useQueryClient()
  if (notes.isLoading) return <Spinner label="Loading notifications" />
  if (notes.isError) return <Button onClick={() => notes.refetch()}>Retry</Button>
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl">Notifications</h1>
        <Button variant="ghost" onClick={() => api("/api/notifications/read-all", { method: "POST" }).then(() => { notes.refetch(); queryClient.invalidateQueries({ queryKey: ["inbox"] }) })}>Mark all read</Button>
      </div>
      <p className="text-sm text-muted">Alerts leave out message text and health notes.</p>
      {(notes.data?.items ?? []).map((item) => (
        <article key={item.id} className="rounded-3xl border border-line bg-paper p-4">
          <h2 className="font-medium">{item.title}</h2>
          <p className="text-sm">{item.body}</p>
          <p className="text-xs text-muted">{formatWhen(item.created_at)} · {item.read ? "Read" : "Unread"}</p>
          {item.link ? <Link className="text-sm text-teal" to={item.link} onClick={() => api(`/api/notifications/${item.id}/read`, { method: "POST" })}>Open</Link> : null}
        </article>
      ))}
      {notes.data?.items.length === 0 ? <Empty title="No notifications" body="Replies, requests, and booking updates will show up here." /> : null}
    </div>
  )
}

export function JournalPage() {
  const journal = useQuery({ queryKey: ["journal"], queryFn: () => api<{ items: { id: number; body: string; created_at: string }[]; note: string }>("/api/journal") })
  const [body, setBody] = useState("")
  const queryClient = useQueryClient()
  const add = useMutation({
    mutationFn: () => api("/api/journal", { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => { setBody(""); queryClient.invalidateQueries({ queryKey: ["journal"] }) },
  })
  return (
    <div className="w-full space-y-4">
      <h1 className="font-serif text-4xl">Journal</h1>
      <p className="text-muted">{journal.data?.note ?? "Private reflections. They are not used to label your health."}</p>
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); add.mutate() }}>
        <textarea className={`${controlClass} min-h-28`} value={body} onChange={(event) => setBody(event.target.value)} />
        <Button type="submit" disabled={!body.trim() || add.isPending}>Save entry</Button>
      </form>
      {(journal.data?.items ?? []).map((entry) => (
        <article key={entry.id} className="rounded-3xl border border-line bg-paper p-4">
          <p className="whitespace-pre-wrap">{entry.body}</p>
          <button type="button" className="mt-2 text-sm text-warn" onClick={() => api(`/api/journal/${entry.id}`, { method: "DELETE" }).then(() => journal.refetch())}>Delete</button>
        </article>
      ))}
    </div>
  )
}

export function PrepPage() {
  const prep = useQuery({
    queryKey: ["prep"],
    queryFn: () => api<{ concerns: string; questions: string; timeline: string; label: string }>("/api/prep"),
  })
  const [concerns, setConcerns] = useState("")
  const [questions, setQuestions] = useState("")
  const [timeline, setTimeline] = useState("")
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState("")
  useEffect(() => {
    if (prep.data && !ready) {
      setConcerns(prep.data.concerns)
      setQuestions(prep.data.questions)
      setTimeline(prep.data.timeline)
      setReady(true)
    }
  }, [prep.data, ready])
  return (
    <div className="w-full space-y-4">
      <h1 className="font-serif text-4xl">Appointment prep</h1>
      <p className="text-muted">{prep.data?.label}</p>
      {prep.isLoading ? <Spinner label="Loading notes" /> : null}
      <form className="space-y-3" onSubmit={async (event) => {
        event.preventDefault()
        await api("/api/prep", { method: "PUT", body: JSON.stringify({ concerns, questions, timeline }) })
        setSaved("Saved only on your account.")
      }}>
        <label className="block text-sm">What is on your mind<textarea className={`${controlClass} min-h-24`} value={concerns} onChange={(event) => setConcerns(event.target.value)} /></label>
        <label className="block text-sm">Questions to ask<textarea className={`${controlClass} min-h-24`} value={questions} onChange={(event) => setQuestions(event.target.value)} /></label>
        <label className="block text-sm">Timeline<textarea className={`${controlClass} min-h-24`} value={timeline} onChange={(event) => setTimeline(event.target.value)} /></label>
        <Button type="submit">Save notes</Button>
        {saved ? <Alert tone="ok">{saved}</Alert> : null}
      </form>
    </div>
  )
}

export function AdminPage() {
  const { user } = useAuth()
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: () => api<{ items: { id: number; target_type: string; reason: string; status: string; excerpt: string; details: string }[] }>("/api/admin/reports"),
  })
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<{ members: number; open_reports: number; appointments: number }>("/api/admin/stats"),
  })
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ items: { id: number; action: string; target_type: string; created_at: string }[] }>("/api/admin/audit"),
  })
  if (user && user.role !== "admin" && user.role !== "moderator") {
    return <Empty title="Permission denied" body="The moderation queue is only available to moderators and admins." />
  }
  return (
    <div className="w-full space-y-6">
      <h1 className="font-serif text-4xl">Moderation</h1>
      {stats.data ? <p className="text-sm text-muted">{stats.data.members} members · {stats.data.open_reports} open reports · {stats.data.appointments} appointments. These counts come from the database.</p> : null}
      {reports.isLoading ? <Spinner label="Loading reports" /> : null}
      {reports.isError ? <Alert>You may not have access to this queue.</Alert> : null}
      {(reports.data?.items ?? []).map((report) => (
        <article key={report.id} className="rounded-3xl border border-line bg-paper p-4">
          <p className="text-sm text-muted">{report.target_type} · {report.reason} · {report.status}</p>
          <p className="mt-2 whitespace-pre-wrap">{report.excerpt || "No excerpt stored."}</p>
          {report.details ? <p className="mt-1 text-sm">{report.details}</p> : null}
          {report.status === "open" ? (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => api(`/api/admin/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved", action: "hide", resolution: "Hidden" }) }).then(() => reports.refetch())}>Hide</Button>
              <Button variant="ghost" onClick={() => api(`/api/admin/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed", action: "dismiss", resolution: "No action" }) }).then(() => reports.refetch())}>Dismiss</Button>
            </div>
          ) : null}
        </article>
      ))}
      {reports.data?.items.length === 0 ? <Empty title="No reports" body="New reports from members will appear here." /> : null}
      <section>
        <h2 className="font-serif text-2xl">Recent audit events</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(audit.data?.items ?? []).slice(0, 20).map((event) => <li key={event.id}>{formatWhen(event.created_at)} · {event.action} · {event.target_type}</li>)}
        </ul>
      </section>
    </div>
  )
}
