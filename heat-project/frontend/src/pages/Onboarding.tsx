import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Alert, Button, Field, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import type { Me, Meta } from "../lib/types"

export function Onboarding() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta") })
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [language, setLanguage] = useState("en")
  const [bio, setBio] = useState("")
  const [interests, setInterests] = useState<string[]>([])
  const [consents, setConsents] = useState<Record<string, boolean>>({
    personalize_feed: true,
    use_profile_in_ai: false,
    appear_in_suggestions: false,
  })
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  function toggleInterest(id: string) {
    setInterests((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function finish() {
    setPending(true)
    setError("")
    try {
      const me = await api<Me>("/api/me/onboarding", {
        method: "POST",
        body: JSON.stringify({ display_name: name, language, bio, interests, consents }),
      })
      setUser(me)
      navigate("/home")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your choices.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="w-full rounded-3xl border border-line bg-paper p-6">
        <p className="text-sm text-teal">Step {step + 1} of 3</p>
        <h1 className="mt-2 font-serif text-4xl">Set up HeartBridge your way</h1>
        {step === 0 ? (
          <div className="mt-6 space-y-4">
            <Field label="Display name"><input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
            <Field label="Language preference" hint="The interface stays in English so health wording can be reviewed before translation.">
              <select className={controlClass} value={language} onChange={(event) => setLanguage(event.target.value)}>
                {(meta.data?.languages ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Bio, optional"><textarea className={controlClass} value={bio} onChange={(event) => setBio(event.target.value)} /></Field>
            <Button type="button" disabled={name.trim().length < 2} onClick={() => setStep(1)}>Next</Button>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="mt-6">
            <p className="text-muted">Choose topics you want to see. This does not diagnose you, and you can skip it.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(meta.data?.topics ?? []).map((topic) => (
                <button key={topic.id} type="button" aria-pressed={interests.includes(topic.id)} className={`rounded-full border px-3 py-1 ${interests.includes(topic.id) ? "border-teal bg-sky" : "border-line"}`} onClick={() => toggleInterest(topic.id)}>
                  {topic.label}
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="ghost" type="button" onClick={() => setStep(0)}>Back</Button>
              <Button type="button" onClick={() => setStep(2)}>Next</Button>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              finish()
            }}
          >
            {(meta.data?.consents ?? []).filter((item) => ["personalize_feed", "use_profile_in_ai", "appear_in_suggestions"].includes(item.key)).map((item) => (
              <label key={item.key} className="flex gap-3 rounded-2xl border border-line p-3">
                <input type="checkbox" checked={Boolean(consents[item.key])} onChange={(event) => setConsents({ ...consents, [item.key]: event.target.checked })} />
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="text-sm text-muted">{item.description}</span>
                </span>
              </label>
            ))}
            {error ? <Alert>{error}</Alert> : null}
            <div className="flex gap-2">
              <Button variant="ghost" type="button" onClick={() => setStep(1)}>Back</Button>
              <Button type="submit" disabled={pending}>Enter HeartBridge</Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
