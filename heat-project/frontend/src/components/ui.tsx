import type { ButtonHTMLAttributes, ReactNode } from "react"

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft" }) {
  const styles = {
    primary: "bg-teal text-white hover:bg-jade",
    ghost: "border border-line bg-paper hover:bg-sky",
    danger: "bg-warn text-white",
    soft: "bg-lavender text-ink hover:bg-lavender/80",
  }[variant]
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-muted">{hint}</span> : null}
    </label>
  )
}

export const controlClass =
  "w-full rounded-2xl border border-line bg-paper px-3 py-2.5 text-base outline-none placeholder:text-muted"

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "ok" | "info" }) {
  const styles = {
    error: "border-warn/30 bg-warn/10 text-warn",
    ok: "border-teal/30 bg-sky text-ink",
    info: "border-line bg-lavender text-ink",
  }[tone]
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-paper px-6 py-10 text-center">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status">
      <span className="h-4 w-4 rounded-full border-2 border-teal border-t-transparent motion-safe:animate-spin" />
      {label}
    </div>
  )
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="w-full max-w-lg rounded-3xl bg-paper p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="font-serif text-2xl">{title}</h2>
          <button type="button" className="rounded-full px-2 py-1 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

export function Avatar({ name, color }: { name: string; color?: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
      style={{ background: color || "#0f6e68" }}
    >
      {initials || "HB"}
    </span>
  )
}
