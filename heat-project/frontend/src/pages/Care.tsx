import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { ChevronDown } from "lucide-react"
import { Alert, Button, Empty, Spinner, controlClass } from "../components/ui"
import { api, ApiError } from "../lib/api"
import { formatWhen, type Appointment, type Doctor, type Slot } from "../lib/types"

const appointmentTimes = Array.from({ length: 26 }, (_, index) => 9 * 60 + index * 30)

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatTime(minutes: number) {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

export function Doctors() {
  const [params, setParams] = useSearchParams()
  const specialty = params.get("specialty") ?? ""
  const area = params.get("area") ?? ""
  const language = params.get("language") ?? ""
  const mode = params.get("mode") ?? ""
  const accessibility = params.get("accessibility") ?? ""
  const query = new URLSearchParams()
  if (specialty) query.set("specialty", specialty)
  if (area) query.set("area", area)
  if (language) query.set("language", language)
  if (mode) query.set("mode", mode)
  if (accessibility) query.set("accessibility", accessibility)
  const doctors = useQuery({
    queryKey: ["doctors", query.toString()],
    queryFn: () => api<{ items: Doctor[]; note: string }>(`/api/doctors?${query.toString()}`),
  })
  function set(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="font-serif text-4xl">Doctors</h1>
        <p className="mt-2 max-w-2xl text-muted">Profiles show only stored fields. Sample clinicians are fictional and labelled. Filters explain a match from the fields you set, not from private chats.</p>
      </header>
      <form className="grid gap-3 rounded-3xl border border-line bg-paper p-4 md:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
        <Filter label="Specialty" value={specialty} onChange={(value) => set("specialty", value)} />
        <Filter label="Area" value={area} onChange={(value) => set("area", value)} />
        <Filter label="Language" value={language} onChange={(value) => set("language", value)} />
        <Filter label="Visit type" value={mode} onChange={(value) => set("mode", value)} />
        <Filter label="Accessibility" value={accessibility} onChange={(value) => set("accessibility", value)} />
      </form>
      {doctors.isLoading ? <Spinner label="Searching profiles" /> : null}
      {doctors.isError ? <Button onClick={() => doctors.refetch()}>Search failed. Retry</Button> : null}
      {doctors.data?.items.length === 0 ? <Empty title="No profiles match" body="Try clearing a filter. The directory only contains stored sample profiles." /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {doctors.data?.items.map((doctor) => (
          <article key={doctor.id} className="rounded-3xl border border-line bg-paper p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-2xl"><Link to={`/doctors/${doctor.id}`}>{doctor.name}</Link></h2>
              <span className="rounded-full bg-lavender px-2 py-1 text-xs">{doctor.is_demo ? "Sample profile" : doctor.verification_status}</span>
            </div>
            <p className="text-sm text-muted">{doctor.qualifications}</p>
            <p className="mt-2">{doctor.specialty} · {doctor.clinic} · {doctor.area}</p>
            <p className="mt-1 text-sm">Languages: {doctor.languages.join(", ")} · {doctor.modes.join(", ")}</p>
            <p className="mt-1 text-sm">{doctor.fee_confirmed && doctor.fee_inr != null ? `Fee ₹${doctor.fee_inr}` : "Fee not confirmed"}</p>
            <p className="mt-2 text-xs text-muted">{doctor.why}</p>
            <Link className="mt-4 inline-flex rounded-xl bg-teal px-4 py-2 text-sm font-medium text-white" to={`/doctors/${doctor.id}`}>Book a slot</Link>
          </article>
        ))}
      </div>
    </div>
  )
}

function Filter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">{label}
      <input className={`${controlClass} mt-1`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export function DoctorDetail() {
  const { id } = useParams()
  const doctor = useQuery({ queryKey: ["doctor", id], queryFn: () => api<Doctor>(`/api/doctors/${id}`) })
  const slots = useQuery({ queryKey: ["slots", id], queryFn: () => api<{ items: Slot[]; note: string; demo: boolean }>(`/api/doctors/${id}/slots`) })
  const [slotId, setSlotId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [step, setStep] = useState<"choose" | "review" | "done">("choose")
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [selectedDate, setSelectedDate] = useState("")
  const [timesExpanded, setTimesExpanded] = useState(false)
  if (doctor.isLoading) return <Spinner label="Loading profile" />
  if (doctor.isError || !doctor.data) return <Empty title="Profile unavailable" body="That clinician record could not be found." />
  const profile = doctor.data
  const allSlots = slots.data?.items ?? []
  const availableSlots = allSlots.filter((slot) => slot.status === "open" && new Date(slot.starts_at).getTime() > Date.now())
  const activeDate = selectedDate || (availableSlots[0] ? localDateKey(availableSlots[0].starts_at) : localDateKey(new Date()))
  const slotsForDate = allSlots.filter((slot) => localDateKey(slot.starts_at) === activeDate)
  const timeOptions = appointmentTimes.map((startMinutes) => {
    const matchingSlot = slotsForDate.find((slot) => {
      const startsAt = new Date(slot.starts_at)
      return startsAt.getHours() * 60 + startsAt.getMinutes() === startMinutes
    })
    const isOpen = matchingSlot?.status === "open" && new Date(matchingSlot.starts_at).getTime() > Date.now()
    return { startMinutes, matchingSlot, isOpen }
  })
  const chosen = slots.data?.items.find((slot) => slot.id === slotId)
  return (
    <div className="w-full space-y-6">
      <header>
        <p className="text-sm text-teal">{profile.is_demo ? "Sample profile — not a real clinician" : profile.verification_status}</p>
        <h1 className="font-serif text-4xl">{profile.name}</h1>
        <p>{profile.qualifications}</p>
        <p className="mt-2">{profile.specialty} at {profile.clinic}, {profile.area}</p>
        <p className="mt-2 text-muted">{profile.bio}</p>
        <p className="mt-2 text-sm">Languages: {profile.languages.join(", ")}. Visits: {profile.modes.join(", ")}.</p>
        <p className="text-sm">{profile.accessibility || "No accessibility note stored."}</p>
        <p className="text-sm">{profile.fee_confirmed && profile.fee_inr != null ? `Confirmed sample fee ₹${profile.fee_inr}` : "Fee not confirmed, so it is hidden."}</p>
      </header>
      <section id="booking" className="rounded-3xl border border-line bg-paper p-5">
        <h2 className="font-serif text-2xl">Book an appointment</h2>
        <p className="text-sm text-muted">{slots.data?.note}</p>
        {slots.isLoading ? <Spinner label="Loading times" /> : null}
        {slots.isError ? <Button onClick={() => slots.refetch()}>Could not load times. Retry</Button> : null}
        <label className="mt-4 block max-w-xs text-sm font-medium">
          Choose a date
          <input
            className={`${controlClass} mt-1`}
            type="date"
            aria-label="Choose appointment date"
            min={localDateKey(new Date())}
            value={activeDate}
            onChange={(event) => { setSelectedDate(event.target.value); setSlotId(null); setStep("choose") }}
          />
        </label>
        <p className="mt-2 text-sm text-muted">
          Choose a 30-minute appointment between 9:00 AM and 10:00 PM. Green times are open; black times are closed.
        </p>
        <div className="mt-4 max-w-xl">
          <button
            type="button"
            aria-expanded={timesExpanded}
            aria-controls="appointment-times"
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 text-left font-medium"
            onClick={() => setTimesExpanded((expanded) => !expanded)}
          >
            <span>Available timings for {new Date(`${activeDate}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
            <ChevronDown className={`h-5 w-5 transition-transform ${timesExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {timesExpanded ? (
            <div id="appointment-times" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {timeOptions.map(({ startMinutes, matchingSlot, isOpen }) => {
                const isSelected = matchingSlot?.id === slotId
                return (
                  <button
                    key={startMinutes}
                    type="button"
                    disabled={!isOpen}
                    aria-label={`${formatTime(startMinutes)} to ${formatTime(startMinutes + 30)}, ${isOpen ? "open" : "closed"}`}
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${isOpen ? "bg-green-600 text-white hover:bg-green-700" : "cursor-not-allowed bg-black text-white"} ${isSelected ? "ring-2 ring-teal ring-offset-2" : ""}`}
                    onClick={() => {
                      if (!matchingSlot) return
                      setSlotId(matchingSlot.id)
                      setStep("choose")
                    }}
                  >
                    {formatTime(startMinutes)}–{formatTime(startMinutes + 30)}
                    {!isOpen ? " · Closed" : ""}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        {chosen && step !== "done" ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (step === "choose") {
                setStep("review")
                return
              }
              setPending(true)
              setError("")
              try {
                const booked = await api<Appointment>("/api/appointments", { method: "POST", body: JSON.stringify({ slot_id: chosen.id, notes }) })
                setAppointment(booked)
                setStep("done")
                slots.refetch()
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "That time could not be reserved.")
              } finally {
                setPending(false)
              }
            }}
          >
            {step === "review" ? (
              <div className="rounded-2xl bg-cream p-3 text-sm">
                <p>Review: {profile.name}, {formatWhen(chosen.starts_at)}. {chosen.is_demo ? "This is a demo slot and will confirm immediately." : "This slot will be confirmed immediately."}</p>
                <label className="mt-2 block">Notes for you, not a notification
                  <textarea className={`${controlClass} mt-1`} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
              </div>
            ) : <p className="text-sm">Selected {formatWhen(chosen.starts_at)}. Continue to review.</p>}
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" disabled={pending}>{step === "review" ? "Confirm booking" : "Review details"}</Button>
          </form>
        ) : null}
        {step === "done" && appointment ? (
          <Alert tone="ok">Booked. <Link to={`/appointments/${appointment.id}`}>Open the appointment</Link></Alert>
        ) : null}
      </section>
    </div>
  )
}

export function Appointments() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: ["appointments"], queryFn: () => api<{ items: Appointment[] }>("/api/appointments") })
  const detail = useQuery({
    queryKey: ["appointment", id],
    queryFn: () => api<Appointment>(`/api/appointments/${id}`),
    enabled: Boolean(id),
  })
  const [error, setError] = useState("")
  return (
    <div className="grid w-full gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside>
        <h1 className="font-serif text-4xl">Appointments</h1>
        {list.isLoading ? <Spinner label="Loading appointments" /> : null}
        {list.isError ? <Button onClick={() => list.refetch()}>Retry</Button> : null}
        <ul className="mt-4 space-y-2">
          {(list.data?.items ?? []).map((item) => (
            <li key={item.id}><Link className="block rounded-2xl border border-line bg-paper px-3 py-2" to={`/appointments/${item.id}`}>{item.doctor?.name} · {item.status}</Link></li>
          ))}
        </ul>
        {list.data?.items.length === 0 ? <p className="mt-4 text-sm text-muted">No appointments yet.</p> : null}
      </aside>
      <section>
        {!id ? <Empty title="Select an appointment" body="Demo bookings show their status history here." /> : null}
        {detail.isLoading && id ? <Spinner label="Loading appointment" /> : null}
        {detail.isError ? <Alert>That appointment is unavailable.</Alert> : null}
        {detail.data ? (
          <article className="rounded-3xl border border-line bg-paper p-5">
            <p className="text-sm text-teal">{detail.data.demo ? "Demo appointment" : "Appointment"}</p>
            <h2 className="font-serif text-3xl">{detail.data.doctor?.name}</h2>
            <p className="mt-2">Status: {detail.data.status.replace("_", " ")}</p>
            <p>{detail.data.slot ? formatWhen(detail.data.slot.starts_at) : "Time unavailable"}</p>
            <p className="mt-3 whitespace-pre-wrap">{detail.data.notes || "No notes saved."}</p>
            <h3 className="mt-4 font-medium">Status history</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.data.events.map((event, index) => (
                <li key={index}>{event.from_status || "start"} → {event.to_status} · {formatWhen(event.created_at)}</li>
              ))}
            </ul>
            {detail.data.status !== "cancelled" ? (
              <Button className="mt-4" variant="danger" onClick={async () => {
                if (!window.confirm("Cancel this appointment and release the slot?")) return
                try {
                  await api(`/api/appointments/${detail.data?.id}/cancel`, { method: "PATCH" })
                  setError("")
                  queryClient.invalidateQueries({ queryKey: ["appointments"] })
                  queryClient.invalidateQueries({ queryKey: ["appointment", id] })
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not cancel.")
                }
              }}>Cancel appointment</Button>
            ) : null}
            {error ? <div className="mt-3"><Alert>{error}</Alert></div> : null}
          </article>
        ) : null}
      </section>
    </div>
  )
}
