import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, FileText, HeartPulse, House, Mic, Plus, RotateCcw, Send, Square, Volume2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Alert, Button, Spinner, controlClass } from "../components/ui"
import { api, ApiError, streamSse } from "../lib/api"
import { useAuth } from "../lib/auth"
import { RichText } from "../lib/richText"
import { formatWhen, type AIConversation, type AIMessage, type NextStep } from "../lib/types"

const chips = [
  ["I need to talk", "listen"],
  ["Help me understand a health topic", "info"],
  ["Prepare questions for my doctor", "plan"],
  ["Find a support community", "plan"],
  ["I'm feeling overwhelmed", "listen"],
] as const

type Status = { mode: "demo" | "live"; provider: string; prompt_version: string }
type ChatAttachment = { name: string; mimeType: string; data: string; preview?: string }
type EcgAnalysis = { analysis: string; disclaimer: string; safety?: string }
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  abort: () => void
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024

export function AIChat() {
  const { user } = useAuth()
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [archived, setArchived] = useState(false)
  const [draft, setDraft] = useState("")
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [ecgFileName, setEcgFileName] = useState("")
  const [ecgAnalysis, setEcgAnalysis] = useState<EcgAnalysis | null>(null)
  const [ecgError, setEcgError] = useState("")
  const [ecgLoading, setEcgLoading] = useState(false)
  const [live, setLive] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState("")
  const [listening, setListening] = useState(false)
  const [readAloud, setReadAloud] = useState(true)
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null)
  const [voiceNotice, setVoiceNotice] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api<Status>("/api/ai/status") })
  const history = useQuery({
    queryKey: ["ai-list", search, archived],
    queryFn: () => api<{ items: AIConversation[] }>(`/api/ai/conversations?archived=${archived}&q=${encodeURIComponent(search)}`),
  })
  const thread = useQuery({
    queryKey: ["ai-thread", id],
    queryFn: () => api<{ conversation: AIConversation; messages: AIMessage[] }>(`/api/ai/conversations/${id}`),
    enabled: Boolean(id),
  })
  const steps = useQuery({ queryKey: ["steps"], queryFn: () => api<{ items: NextStep[] }>("/api/next-steps") })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        boxRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => () => {
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview)
  }, [attachment])

  useEffect(() => () => {
    recognitionRef.current?.abort()
    window.speechSynthesis?.cancel()
  }, [])

  function speakReply(text: string, messageId?: number) {
    if (!("speechSynthesis" in window)) {
      setVoiceNotice("Spoken replies are not supported in this browser.")
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, " ").trim())
    const language = user?.profile.language
    utterance.lang = language === "hi" ? "hi-IN" : language === "te" ? "te-IN" : "en-IN"
    utterance.onstart = () => setSpeakingMessageId(messageId ?? -1)
    utterance.onend = () => setSpeakingMessageId(null)
    utterance.onerror = () => {
      setSpeakingMessageId(null)
      setVoiceNotice("Could not play the spoken reply. Try the speaker button again.")
    }
    setVoiceNotice("")
    window.speechSynthesis.speak(utterance)
  }

  function startVoiceInput() {
    if (listening) {
      recognitionRef.current?.abort()
      setListening(false)
      return
    }
    const speechWindow = window as SpeechWindow
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceNotice("Voice input is not supported in this browser. Try Chrome or Edge.")
      return
    }
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = user?.profile.language === "hi" ? "hi-IN" : user?.profile.language === "te" ? "te-IN" : "en-IN"
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim()
      if (transcript) setDraft(transcript)
    }
    recognition.onerror = (event) => {
      setListening(false)
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was blocked. Allow microphone access in your browser to use voice input.",
        "no-speech": "No speech was detected. Tap the microphone and try again.",
        network: "Voice recognition is unavailable right now. Check your connection and try again.",
      }
      setVoiceNotice(messages[event.error] ?? "Voice input stopped. Please try again.")
    }
    recognition.onend = () => setListening(false)
    setVoiceNotice("Listening… Speak now. Your words will appear in the message box for you to review.")
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
      setVoiceNotice("Could not start the microphone. Check browser microphone permissions and try again.")
    }
  }

  async function chooseAttachment(file?: File) {
    if (!file) return
    const extension = file.name.split(".").pop()?.toLowerCase()
    const mimeType = file.type || ({
      md: "text/markdown",
      markdown: "text/markdown",
      txt: "text/plain",
      csv: "text/csv",
      pdf: "application/pdf",
    }[extension ?? ""] ?? "")
    const supportedTypes = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
    ]
    if (!supportedTypes.includes(mimeType)) {
      setError("Choose a PNG, JPEG, WebP, PDF, TXT, Markdown, or CSV file.")
      return
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setError("Files must be 5 MB or smaller. Text documents must be 1 MB or smaller.")
      return
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read file"))
        reader.onerror = () => reject(new Error("Could not read file"))
        reader.readAsDataURL(file)
      })
      setError("")
      setAttachment({
        name: file.name,
        mimeType,
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        ...(mimeType.startsWith("image/") ? { preview: URL.createObjectURL(file) } : {}),
      })
    } catch {
      setError("Could not read that file. Please choose it again.")
    }
  }

  async function analyzeEcgReport(file?: File) {
    if (!file) return
    const extension = file.name.split(".").pop()?.toLowerCase()
    const mimeType = file.type || ({
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      csv: "text/csv",
    }[extension ?? ""] ?? "")
    const supportedTypes: Record<string, string[]> = {
      "application/pdf": ["pdf"],
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
      "text/csv": ["csv"],
    }
    if (!supportedTypes[mimeType]?.includes(extension ?? "")) {
      setEcgError("Choose an ECG report as a PDF, PNG, JPEG, WebP, or CSV file.")
      return
    }
    if (file.size === 0 || file.size > MAX_ATTACHMENT_SIZE || (mimeType === "text/csv" && file.size > 1024 * 1024)) {
      setEcgError("ECG reports must be non-empty and 5 MB or smaller. CSV files must be 1 MB or smaller.")
      return
    }

    setEcgError("")
    setEcgAnalysis(null)
    setEcgFileName(file.name)
    setEcgLoading(true)
    const form = new FormData()
    form.append("file", new Blob([file], { type: mimeType }), file.name)
    form.append("question", "Explain the visible findings in this ECG report in plain language.")
    try {
      setEcgAnalysis(await api<EcgAnalysis>("/api/ai/ecg-analysis", { method: "POST", body: form }))
    } catch (err) {
      setEcgError(err instanceof ApiError ? err.message : "Could not analyze this ECG report. Please try again.")
    } finally {
      setEcgLoading(false)
    }
  }

  async function runStream(path: string, body?: unknown, conversationId: number | string | undefined = id) {
    setStreaming(true)
    setError("")
    setLive("")
    const controller = new AbortController()
    abortRef.current = controller
    let streamFailed = false
    let responseText = ""
    try {
      await streamSse(path, body ?? {}, (event) => {
        if (event.token) {
          responseText += event.token
          setLive((current) => current + event.token)
        }
        if (event.error) {
          setError(event.error)
          streamFailed = true
        }
      }, controller.signal)
      setLive("")
      await queryClient.invalidateQueries({ queryKey: ["ai-thread", conversationId] })
      await queryClient.invalidateQueries({ queryKey: ["ai-list"] })
      await queryClient.invalidateQueries({ queryKey: ["steps"] })
      if (!streamFailed && responseText && readAloud) speakReply(responseText)
      return !streamFailed
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setLive("")
        await queryClient.invalidateQueries({ queryKey: ["ai-thread", conversationId] })
      } else {
        setError(err instanceof ApiError ? err.message : "The assistant could not reply. You can retry.")
      }
      return false
    } finally {
      setStreaming(false)
    }
  }

  function attachmentPayload(file: ChatAttachment | null) {
    if (!file) return {}
    return file.mimeType.startsWith("image/")
      ? { image_mime_type: file.mimeType, image_data: file.data }
      : { document_mime_type: file.mimeType, document_data: file.data }
  }

  async function send(text: string, intent?: string, file = attachment) {
    const content = text.trim() || (
      file?.mimeType.startsWith("image/")
        ? "Please describe this image clearly, including the main things visible."
        : file
          ? "Please summarize this document and explain its key points."
          : ""
    )
    if (!content || streaming) return
    const body = { content, ...attachmentPayload(file) }
    if (!id) {
      const created = await api<AIConversation>("/api/ai/conversations", {
        method: "POST",
        body: JSON.stringify({ intent: intent ?? "listen", style: "gentle", use_profile: false }),
      })
      navigate(`/companion/${created.id}`)
      const sent = await runStream(`/api/ai/conversations/${created.id}/messages`, body, created.id)
      if (sent) {
        setDraft("")
        setAttachment(null)
      }
      return
    }
    if (intent && intent !== conversation?.intent) {
      await api(`/api/ai/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ intent }) })
    }
    const sent = await runStream(`/api/ai/conversations/${id}/messages`, body, id)
    if (sent) {
      setDraft("")
      setAttachment(null)
    }
  }

  async function retry() {
    if (!id) return
    const body = attachment ? { content: draft.trim(), ...attachmentPayload(attachment) } : undefined
    const sent = await runStream(`/api/ai/conversations/${id}/regenerate`, body, id)
    if (sent) {
      setDraft("")
      setAttachment(null)
    }
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/ai/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-thread", id] })
      queryClient.invalidateQueries({ queryKey: ["ai-list"] })
    },
  })

  const conversation = thread.data?.conversation
  const messages = thread.data?.messages ?? []
  const firstName = user?.profile.display_name.trim().split(/\s+/)[0] || "there"

  return (
    <div className="companion-workspace">
      <aside className="companion-sidebar">
        <div className="companion-brand">
          <span className="companion-brand-mark" aria-hidden="true">H</span>
          <span><strong>HeartBridge</strong><small>AI Companion</small></span>
        </div>
        <Link to="/home" className="companion-home-link"><House size={17} aria-hidden="true" /> Home</Link>
        <Button type="button" className="companion-new-chat" onClick={() => navigate("/companion")}><Plus size={17} aria-hidden="true" /> New chat</Button>
        <label className="companion-search-label">Search chats
          <input className="companion-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your chats" />
        </label>
        <button type="button" className="companion-archive-toggle" onClick={() => setArchived((value) => !value)}>
          {archived ? "Show active chats" : "Show archived"}
        </button>
        <p className="companion-list-heading">{archived ? "Archived" : "Recent"}</p>
        {history.isLoading ? <Spinner label="Loading chats" /> : null}
        {history.isError ? <Button variant="ghost" onClick={() => history.refetch()}>Retry</Button> : null}
        <ul className="companion-chat-list">
          {(history.data?.items ?? []).map((item) => (
            <li key={item.id}>
              <Link to={`/companion/${item.id}`} className={String(item.id) === id ? "companion-chat-link active" : "companion-chat-link"}>
                <span className="block font-medium">{item.title}</span>
                <span>{formatWhen(item.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {history.data && history.data.items.length === 0 ? <p className="companion-no-chats">No chats in this list.</p> : null}
        {conversation ? (
          <details className="companion-tools">
            <summary className="cursor-pointer font-medium">Conversation tools</summary>
            <div className="mt-3 space-y-3 text-sm">
              <p>{conversation.context.note}</p>
              <p className="text-muted">{conversation.context.memory}</p>
              <label>Style
                <select className={controlClass} value={conversation.style} onChange={(event) => patch.mutate({ style: event.target.value })}>
                  <option value="gentle">Gentle</option>
                  <option value="straightforward">Straightforward</option>
                  <option value="step_by_step">Step-by-step</option>
                </select>
              </label>
              <label>What do you want?
                <select className={controlClass} value={conversation.intent} onChange={(event) => patch.mutate({ intent: event.target.value })}>
                  <option value="listen">Listen</option>
                  <option value="plan">Practical steps</option>
                  <option value="info">General information</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={conversation.use_profile} onChange={(event) => patch.mutate({ use_profile: event.target.checked })} />
                Use my display name and selected topics
              </label>
              <Button type="button" variant="ghost" onClick={() => {
                const title = window.prompt("Rename this chat", conversation.title)
                if (title) patch.mutate({ title })
              }}>Rename</Button>
              <Button type="button" variant="ghost" onClick={() => patch.mutate({ archived: !conversation.archived })}>{conversation.archived ? "Unarchive" : "Archive"}</Button>
              <Button type="button" variant="danger" onClick={() => {
                if (window.confirm("Delete this chat and its messages?")) {
                  api(`/api/ai/conversations/${conversation.id}`, { method: "DELETE" }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["ai-list"] })
                    navigate("/companion")
                  })
                }
              }}>Delete</Button>
              <SummaryControls id={conversation.id} summary={conversation.summary} onChange={() => thread.refetch()} />
              <div className="border-t border-line pt-3">
                <h3 className="font-medium">Saved next steps</h3>
                <p className="text-muted">Private to you; not a medical record.</p>
                {(steps.data?.items ?? []).slice(0, 2).map((step) => <StepEditor key={step.id} step={step} />)}
                {!steps.data?.items.length ? <p className="mt-2">A plan appears when you ask for practical steps.</p> : null}
                <Link to="/prep" className="mt-3 inline-block text-teal">Open prep notes</Link>
              </div>
            </div>
          </details>
        ) : null}
        <div className="companion-sidebar-footer">
          <span className="companion-profile-dot">{firstName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{user?.profile.display_name}</strong><small>{status.data?.mode === "live" ? "Live assistant" : "Demo assistant"}</small></span>
        </div>
      </aside>
      <section className="companion-stage">
        <header className="companion-topbar">
          <h1>{conversation?.title ?? "AI Companion"}</h1>
          <div>{status.data?.mode === "live" ? "Live model" : "Demo mode"} <span className="companion-status-dot" /></div>
        </header>
        <div className={`companion-transcript ${!id ? "is-welcome" : ""}`} aria-live="polite">
          {!id ? (
            <div className="companion-welcome">
              <p>Your private space, {firstName}</p>
              <h2>Where should we start?</h2>
              <span>I’m an AI companion, not a clinician or emergency service.</span>
              <div className="companion-prompt-chips">
                {chips.map(([label, intent]) => (
                  <button key={label} type="button" onClick={() => send(label, intent)}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}
          {thread.isLoading && id ? <Spinner label="Loading conversation" /> : null}
          {thread.isError ? <Alert>This conversation could not be loaded. <button type="button" onClick={() => thread.refetch()}>Retry</button></Alert> : null}
          {messages.map((message) => (
            <article key={message.id} className={`companion-message ${message.role === "user" ? "user" : "assistant"}`}>
              <p className="companion-message-label">{message.role === "user" ? "You" : message.safety_code ? "Safety notice" : message.demo ? "Demo reply" : "HeartBridge AI"}</p>
              <div className="mt-1"><RichText text={message.content} /></div>
              {message.role === "assistant" ? (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <button type="button" onClick={() => navigator.clipboard.writeText(message.content).then(() => setCopied("Copied."))}><Copy size={14} className="inline" aria-hidden="true" /> Copy</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (speakingMessageId === message.id) {
                        window.speechSynthesis.cancel()
                        setSpeakingMessageId(null)
                      } else {
                        speakReply(message.content, message.id)
                      }
                    }}
                    aria-label={speakingMessageId === message.id ? "Stop spoken reply" : "Speak reply aloud"}
                  >
                    <Volume2 size={14} className="inline" aria-hidden="true" /> {speakingMessageId === message.id ? "Stop speaking" : "Speak"}
                  </button>
                  {(["helpful", "not_needed", "too_much"] as const).map((rating) => (
                    <button key={rating} type="button" className={message.feedback === rating ? "font-semibold" : ""} onClick={() => api(`/api/ai/messages/${message.id}/feedback`, { method: "POST", body: JSON.stringify({ rating }) }).then(() => thread.refetch())}>
                      {rating === "helpful" ? "Helpful" : rating === "not_needed" ? "Not what I needed" : "Too much detail"}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {streaming ? (
            <article className="companion-message assistant">
              <p className="companion-message-label">Replying</p>
              <div className="mt-1">{live ? <RichText text={live} /> : <Spinner label="Thinking" />}</div>
            </article>
          ) : null}
          {ecgLoading ? <article className="companion-message assistant"><p className="companion-message-label">ECG report</p><Spinner label={`Reviewing ${ecgFileName}`} /></article> : null}
          {ecgAnalysis ? (
            <article className="companion-message assistant">
              <p className="companion-message-label">ECG report explanation</p>
              <p className="mt-1 text-sm text-muted">{ecgFileName}</p>
              <div className="mt-2 whitespace-pre-wrap leading-relaxed">{ecgAnalysis.analysis}</div>
              <p className="mt-3 border-t border-line pt-3 text-sm text-muted">{ecgAnalysis.disclaimer}</p>
            </article>
          ) : null}
          {ecgError ? <Alert>{ecgError}</Alert> : null}
          {error ? <Alert>{error}</Alert> : null}
          {copied ? <p className="text-sm text-teal">{copied}</p> : null}
        </div>
        <form
          className="companion-composer-wrap"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() || attachment) send(draft, conversation?.intent)
          }}
        >
          <label className="sr-only" htmlFor="composer">Message</label>
          <div className="companion-composer-entry">
            <textarea
              id="composer"
              ref={boxRef}
              className="companion-composer-input"
              value={draft}
              placeholder="Write a message. Enter to send, Shift+Enter for a new line."
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  if ((draft.trim() || attachment) && !streaming) send(draft.trim(), conversation?.intent)
                }
              }}
            />
            <Button
              type="submit"
              className="companion-send-button"
              aria-label="Send message"
              title="Send message"
              disabled={streaming || (!draft.trim() && !attachment)}
            >
              <Send size={17} aria-hidden="true" /> Send
            </Button>
          </div>
          {voiceNotice ? <p className="mt-2 text-sm text-muted" aria-live="polite">{voiceNotice}</p> : null}
          {attachment ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line p-2">
              {attachment.preview
                ? <img src={attachment.preview} alt={`Preview of ${attachment.name}`} className="h-10 w-10 rounded-lg object-cover" />
                : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-lavender"><FileText size={18} aria-hidden="true" /></span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.name}</p>
                <p className="text-xs text-muted">File is sent securely for this reply and is not saved to chat history.</p>
              </div>
              <Button type="button" variant="ghost" aria-label="Remove attached file" onClick={() => setAttachment(null)}><X size={16} aria-hidden="true" /></Button>
            </div>
          ) : null}
          <div className="companion-composer-toolbar">
            <div className="companion-composer-tools">
              <Button type="button" variant={listening ? "soft" : "ghost"} disabled={streaming} onClick={startVoiceInput} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak"} title={listening ? "Stop listening" : "Speak"}>
                <Mic size={16} aria-hidden="true" />
                <span className="companion-tool-label">{listening ? "Stop listening" : "Speak"}</span>
              </Button>
              <label className="inline-flex items-center gap-2 px-2 text-sm">
                <input type="checkbox" checked={readAloud} onChange={(event) => {
                  setReadAloud(event.target.checked)
                  if (!event.target.checked) {
                    window.speechSynthesis?.cancel()
                    setSpeakingMessageId(null)
                  }
                }} />
                  <span className="companion-read-label">Read aloud</span>
              </label>
              <div className="relative">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={streaming}
                  aria-label="Add attachment"
                  aria-expanded={attachmentMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setAttachmentMenuOpen((open) => !open)}
                >
                  <Plus size={18} aria-hidden="true" />
                </Button>
                {attachmentMenuOpen ? (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl border border-line bg-paper p-2 shadow-xl" role="menu" aria-label="Add to message">
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-cream">
                      <FileText size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="block font-medium">Upload files</span>
                        <span className="mt-0.5 block text-xs text-muted">Images, PDF, TXT, Markdown, CSV</span>
                      </span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv,.md,.markdown,.csv"
                        disabled={streaming}
                        onChange={(event) => {
                          void chooseAttachment(event.currentTarget.files?.[0])
                          event.currentTarget.value = ""
                          setAttachmentMenuOpen(false)
                        }}
                        aria-label="Choose an image or document to upload"
                      />
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-cream">
                      <HeartPulse size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="block font-medium">Upload ECG report</span>
                        <span className="mt-0.5 block text-xs text-muted">Sent to Gemini for this request; not stored by HeartBridge</span>
                      </span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp,text/csv,.pdf,.png,.jpg,.jpeg,.webp,.csv"
                        disabled={ecgLoading}
                        onChange={(event) => {
                          void analyzeEcgReport(event.currentTarget.files?.[0])
                          event.currentTarget.value = ""
                          setAttachmentMenuOpen(false)
                        }}
                        aria-label="Choose an ECG report to upload"
                      />
                    </label>
                    <p className="px-3 pb-2 text-xs text-muted">One file · up to 5 MB. Text files: up to 1 MB.</p>
                  </div>
                ) : null}
              </div>
              <Button type="button" variant="ghost" disabled={!streaming} onClick={() => abortRef.current?.abort()} aria-label="Stop response" title="Stop response"><Square size={16} aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" disabled={!id || streaming} onClick={() => runStream(`/api/ai/conversations/${id}/regenerate`)} aria-label="Regenerate response" title="Regenerate response"><RotateCcw size={16} aria-hidden="true" /></Button>
              {error && id ? <Button type="button" variant="soft" onClick={() => void retry()}>Retry</Button> : null}
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

function SummaryControls({ id, summary, onChange }: { id: number; summary: string | null; onChange: () => void }) {
  const [draft, setDraft] = useState(summary ?? "")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  useEffect(() => setDraft(summary ?? ""), [summary])
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="font-medium">Summary</p>
      <p className="text-muted">A draft is not saved until you confirm it. It is your note, not a medical record.</p>
      <Button type="button" variant="ghost" onClick={async () => {
        setError("")
        try {
          const result = await api<{ draft: string }>(`/api/ai/conversations/${id}/summary`, { method: "POST" })
          setDraft(result.draft)
          setNote("Draft ready. Edit it, then save.")
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not draft a summary.")
        }
      }}>Draft summary</Button>
      <textarea className={`${controlClass} min-h-24`} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className="flex gap-2">
        <Button type="button" onClick={() => api(`/api/ai/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ summary: draft }) }).then(() => { setNote("Summary saved."); onChange() })}>Save summary</Button>
        <Button type="button" variant="ghost" onClick={() => api(`/api/ai/conversations/${id}/summary`, { method: "DELETE" }).then(() => { setDraft(""); setNote("Summary deleted."); onChange() })}>Delete</Button>
      </div>
      {note ? <p className="text-teal">{note}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  )
}

function StepEditor({ step }: { step: NextStep }) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState(step.action)
  const [question, setQuestion] = useState(step.clinician_question)
  const [resource, setResource] = useState(step.resource)
  return (
    <form
      className="mt-3 space-y-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        api(`/api/next-steps/${step.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action, clinician_question: question, resource }),
        }).then(() => queryClient.invalidateQueries({ queryKey: ["steps"] }))
      }}
    >
      <label>One action<textarea className={controlClass} value={action} onChange={(event) => setAction(event.target.value)} /></label>
      <label>Question for a clinician<textarea className={controlClass} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
      <label>Resource<textarea className={controlClass} value={resource} onChange={(event) => setResource(event.target.value)} /></label>
      <div className="flex gap-2">
        <Button type="submit">Save plan</Button>
        <Button type="button" variant="ghost" onClick={() => api(`/api/next-steps/${step.id}`, { method: "DELETE" }).then(() => queryClient.invalidateQueries({ queryKey: ["steps"] }))}>Remove</Button>
      </div>
    </form>
  )
}
