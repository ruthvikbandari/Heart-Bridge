export type Profile = {
  display_name: string
  bio: string
  language: string
  avatar_color: string
}

export type Me = {
  id: number
  email: string
  role: string
  onboarded: boolean
  profile: Profile
  interests: string[]
  consents: Record<string, boolean>
}

export type Meta = {
  name: string
  demo_banner: boolean
  ai_mode: "demo" | "live"
  topics: { id: string; label: string }[]
  reactions: { id: string; label: string }[]
  languages: { id: string; label: string }[]
  report_reasons: string[]
  consents: { key: string; title: string; description: string }[]
}

export type Author = {
  id: number | null
  display_name: string
  anonymous?: boolean
  avatar_color: string
}

export type Post = {
  id: number
  body: string
  image_url: string | null
  visibility: string
  content_warning: string | null
  is_anonymous: boolean
  removed: boolean
  topics: string[]
  created_at: string
  author: Author
  reactions: Record<string, number>
  my_reaction: string | null
  comment_count: number
  bookmarked: boolean
  community: { id: number; slug: string; name: string } | null
  mine: boolean
}

export type Comment = {
  id: number
  parent_id: number | null
  body: string
  created_at: string
  mine: boolean
  author: Author
}

export type Community = {
  id: number
  slug: string
  name: string
  description: string
  guidelines: string
  topic: string
  visibility: string
  allow_anonymous: boolean
  member_count: number
  membership: { status: string; role: string; anonymous_name: string | null } | null
  events: { id: number; title: string; description: string; starts_at: string }[]
  resources: { id: number; title: string; url: string; summary: string; source_label: string; last_reviewed: string }[]
  moderators: string[]
  pending_requests: { user_id: number; display_name: string }[]
  can_review: boolean
  notice: string
  why: string
  locked?: boolean
}

export type Conversation = {
  id: number
  status: string
  created_by: number | null
  unread: number
  muted: boolean
  preview: string
  other: { id: number; display_name: string; profile: Profile } | null
  updated_at: string
}

export type DirectMessage = {
  id: number
  sender_id: number | null
  body: string
  created_at: string
  mine: boolean
}

export type AIConversation = {
  id: number
  title: string
  archived: boolean
  style: string
  intent: string
  use_profile: boolean
  summary: string | null
  updated_at: string
  context: { using_profile: boolean; note: string; memory: string }
}

export type AIMessage = {
  id: number
  role: string
  content: string
  demo: boolean
  safety_code: string | null
  feedback: string | null
  created_at: string
}

export type Doctor = {
  id: number
  name: string
  qualifications: string
  specialty: string
  clinic: string
  area: string
  languages: string[]
  modes: string[]
  fee_inr: number | null
  fee_confirmed: boolean
  verification_status: string
  is_demo: boolean
  bio: string
  accessibility: string
  open_slots: number | null
  why: string
}

export type Slot = {
  id: number
  starts_at: string
  ends_at: string
  status: string
  is_demo: boolean
}

export type Appointment = {
  id: number
  status: string
  notes: string
  created_at: string
  patient_id: number
  demo: boolean
  doctor: Doctor | null
  slot: Slot | null
  events: { from_status: string; to_status: string; created_at: string }[]
}

export type NextStep = {
  id: number
  action: string
  clinician_question: string
  resource: string
  label: string
}

export function formatWhen(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function topicLabel(topics: { id: string; label: string }[] | undefined, id: string) {
  return topics?.find((topic) => topic.id === id)?.label ?? id
}
