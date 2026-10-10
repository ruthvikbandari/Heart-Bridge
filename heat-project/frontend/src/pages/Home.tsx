import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Sparkles, Stethoscope, Upload, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { PostCard } from "../components/PostCard"
import { Alert, Button, Empty, Spinner, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import { topicLabel, type Community, type Meta, type Post } from "../lib/types"

const tabs = [
  ["for_you", "For you"],
  ["following", "Following"],
  ["communities", "Communities"],
  ["latest", "Latest"],
] as const

const prompts = [
  "What would you like people to understand?",
  "What helped you today?",
  "What question are you carrying?",
]

export function Home() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("for_you")
  const [topic, setTopic] = useState("")
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const communities = useQuery({ queryKey: ["communities"], queryFn: () => api<{ items: Community[] }>("/api/communities") })
  const posts = useQuery({
    queryKey: ["posts", tab, topic],
    queryFn: () => api<{ items: Post[]; personalized: boolean; total: number }>(`/api/posts?tab=${tab}${topic ? `&topic=${topic}` : ""}`),
  })
  const [body, setBody] = useState("")
  const [visibility, setVisibility] = useState("public")
  const [communityId, setCommunityId] = useState<number | "">("")
  const [chosen, setChosen] = useState<string[]>([])
  const [warning, setWarning] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState("No file chosen")
  const [error, setError] = useState("")
  const [ok, setOk] = useState("")
  const identifiers = useMemo(() => {
    const emails = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
    const phones = body.match(/\b\d{8,}\b/g) ?? []
    return [...emails, ...phones]
  }, [body])
  const firstName = user?.profile.display_name.trim().split(/\s+/)[0] || "there"

  const publish = useMutation({
    mutationFn: async () => {
      let imageUrl = image
      const file = (document.getElementById("post-image") as HTMLInputElement | null)?.files?.[0]
      if (file) {
        const data = new FormData()
        data.append("file", file)
        const uploaded = await api<{ url: string }>("/api/uploads", { method: "POST", body: data })
        imageUrl = uploaded.url
      }
      return api("/api/posts", {
        method: "POST",
        body: JSON.stringify({
          body,
          visibility,
          topics: chosen,
          content_warning: warning || null,
          community_id: visibility === "community" ? communityId : null,
          is_anonymous: anonymous,
          image_url: imageUrl,
        }),
      })
    },
    onSuccess: () => {
      setBody("")
      setWarning("")
      const imageInput = document.getElementById("post-image") as HTMLInputElement | null
      if (imageInput) imageInput.value = ""
      setImageName("No file chosen")
      setOk("Posted.")
      setError("")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not publish that post."),
  })

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Your HeartBridge space</p>
          <h1 className="mt-1 font-serif text-4xl">Good to see you, {firstName}.</h1>
        </div>
        <p className="max-w-md text-sm text-muted">A supportive space to reflect, connect, and take things one step at a time.</p>
      </header>
      <section className="rounded-3xl bg-gradient-to-r from-[#123541] via-[#0f6e68] to-[#16877d] p-6 text-white shadow-sm md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">Reflect · connect · move forward</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <h2 className="font-serif text-4xl md:text-5xl">Start wherever you are.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/85">There’s no right way to use this space. Find a conversation, explore a community, or pause and check in with yourself.</p>
          </div>
          <a href="#post-body" className="inline-flex items-center gap-2 rounded-full bg-[#c9f3e9] px-5 py-3 text-sm font-semibold text-ink hover:bg-white">
            Write a check-in <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
      <nav className="grid gap-3 md:grid-cols-3" aria-label="Explore HeartBridge">
        <Link to="/companion" className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
          <span className="rounded-xl bg-lavender p-3 text-violet-700"><Sparkles size={20} aria-hidden="true" /></span>
          <span><strong className="block text-sm">Pause &amp; reflect</strong><span className="text-sm text-muted">A private space to sort through thoughts</span></span>
          <span className="ml-auto text-muted" aria-hidden="true">↗</span>
        </Link>
        <Link to="/communities" className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
          <span className="rounded-xl bg-[#e6f2ec] p-3 text-teal"><Users size={20} aria-hidden="true" /></span>
          <span><strong className="block text-sm">Find connection</strong><span className="text-sm text-muted">Meet people with shared experiences</span></span>
          <span className="ml-auto text-muted" aria-hidden="true">↗</span>
        </Link>
        <Link to="/doctors" className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
          <span className="rounded-xl bg-sky p-3 text-teal"><Stethoscope size={20} aria-hidden="true" /></span>
          <span><strong className="block text-sm">Explore care</strong><span className="text-sm text-muted">Browse clinician profiles and slots</span></span>
          <span className="ml-auto text-muted" aria-hidden="true">↗</span>
        </Link>
      </nav>
      <form
        className="space-y-3 rounded-3xl border border-line bg-paper p-5"
        onSubmit={(event) => {
          event.preventDefault()
          setOk("")
          publish.mutate()
        }}
      >
        <div className="flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" className="rounded-full bg-lavender px-3 py-1 text-sm" onClick={() => setBody(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <label className="block text-sm font-medium" htmlFor="post-body">Share something</label>
        <textarea id="post-body" className={`${controlClass} min-h-28`} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write in your own words." />
        <div className="flex flex-wrap gap-2">
          {(meta.data?.topics ?? []).map((item) => (
            <button key={item.id} type="button" aria-pressed={chosen.includes(item.id)} className={`rounded-full border px-3 py-1 text-sm ${chosen.includes(item.id) ? "border-teal bg-sky" : "border-line"}`} onClick={() => setChosen((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id].slice(0, 3))}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Visibility
            <select className={controlClass} value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="public">Public community</option>
              <option value="community">Group members</option>
              <option value="private">Private draft</option>
            </select>
          </label>
          {visibility === "community" ? (
            <label className="text-sm">Community
              <select className={controlClass} value={communityId} onChange={(event) => setCommunityId(Number(event.target.value))}>
                <option value="">Choose</option>
                {(communities.data?.items ?? []).filter((item) => item.membership?.status === "member").map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <FieldLike label="Content note, optional" value={warning} onChange={setWarning} />
        <div>
          <span className="block text-sm font-medium">Image, optional</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label
              htmlFor="post-image"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-sky focus-within:outline-2 focus-within:outline-teal focus-within:outline-offset-2"
            >
              <Upload size={16} aria-hidden="true" />
              Upload image
              <input
                id="post-image"
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  setImage(null)
                  setImageName(event.currentTarget.files?.[0]?.name ?? "No file chosen")
                }}
              />
            </label>
            <span className="text-sm text-muted" aria-live="polite">{imageName}</span>
          </div>
        </div>
        {visibility === "community" ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Post with my anonymous community name, if the group allows it</label>
        ) : null}
        {identifiers.length ? <Alert tone="info">Privacy preview: this may identify you — {identifiers.join(", ")}. Remove it if you do not want it public.</Alert> : null}
        <p className="text-xs text-muted">Who can see this: {visibility === "public" ? "anyone in HeartBridge" : visibility === "private" ? "only you" : "members of the group you choose"}.</p>
        {error ? <Alert>{error}</Alert> : null}
        {ok ? <Alert tone="ok">{ok}</Alert> : null}
        <Button type="submit" disabled={publish.isPending || !body.trim()}>Publish</Button>
      </form>
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`rounded-full px-4 py-2 text-sm ${tab === id ? "bg-navy text-white" : "bg-paper border border-line"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <select className="rounded-full border border-line bg-paper px-3 text-sm" value={topic} onChange={(event) => setTopic(event.target.value)} aria-label="Filter by topic">
          <option value="">All topics</option>
          {(meta.data?.topics ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {posts.isLoading ? <Spinner label="Loading the feed" /> : null}
      {posts.isError ? <Button variant="ghost" onClick={() => posts.refetch()}>The feed could not load. Retry</Button> : null}
      {posts.data && posts.data.items.length === 0 ? (
        <Empty title="Nothing here yet" body={tab === "following" ? "Follow someone from their profile to fill this tab." : "Be the first to share, or choose another tab."} />
      ) : null}
      {posts.data?.personalized === false && tab === "for_you" ? <p className="text-sm text-muted">Personalization is off, or you have not selected topics. This is the latest public feed.</p> : null}
      <div className="space-y-4">
        {posts.data?.items.map((post) => <PostCard key={post.id} post={post} />)}
      </div>
      {topic ? <p className="text-xs text-muted">Showing {topicLabel(meta.data?.topics, topic)}</p> : null}
    </div>
  )
}

function FieldLike({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">{label}
      <input className={`${controlClass} mt-1`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
