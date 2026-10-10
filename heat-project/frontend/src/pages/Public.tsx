import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { ArrowRight, CalendarCheck, Heart, Mail, MessageCircle, Phone, ShieldCheck, Sparkles, Stethoscope, Users } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { api, ApiError } from "../lib/api"
import { useAuth } from "../lib/auth"
import { Alert, Button, Field, controlClass } from "../components/ui"

export function Landing() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [activeSection, setActiveSection] = useState(() => window.location.hash.slice(1) || "top")

  useEffect(() => {
    const syncActiveSection = () => setActiveSection(window.location.hash.slice(1) || "top")
    window.addEventListener("hashchange", syncActiveSection)
    return () => window.removeEventListener("hashchange", syncActiveSection)
  }, [])

  async function demo(email: string) {
    setPending(true)
    setError("")
    try {
      const me = await login(email, "DemoPass123!")
      navigate(me.onboarded ? "/home" : "/onboarding")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo sign-in failed. Start the API and run the seed command.")
    } finally {
      setPending(false)
    }
  }

  if (!loading && user) return <Navigate to={user.onboarded ? "/home" : "/onboarding"} replace />

  return (
    <>
      <style>{`
        .heart-hero-scene {
          position: relative;
        }

        .heart-hero-figure {
          position: relative;
          overflow: hidden;
          border-radius: 1.4rem;
          isolation: isolate;
        }

        .heart-hero-glow {
          position: absolute;
          inset: 10% 8% 12% 8%;
          border-radius: 2rem;
          background: radial-gradient(circle at center, rgba(227, 38, 46, 0.22), rgba(255, 255, 255, 0) 68%);
          filter: blur(28px);
          animation: pulseGlow 3s ease-in-out infinite;
          z-index: 0;
        }

        .heart-hero-image {
          position: relative;
          display: block;
          width: 100%;
          border-radius: 1.4rem;
          object-fit: cover;
          box-shadow: 0 18px 45px -25px rgba(227, 38, 46, 0.45);
          transform-origin: center center;
          animation: heartBeat 2.2s ease-in-out infinite;
          z-index: 1;
        }

        .hero-badge {
          animation: badgeFloat 7s ease-in-out infinite;
        }

        @keyframes heartBeat {
          0%, 100% {
            transform: translateY(0) scale(1);
          }
          12% {
            transform: translateY(-4px) scale(1.06);
          }
          18% {
            transform: translateY(2px) scale(0.98);
          }
          26% {
            transform: translateY(-7px) scale(1.12);
          }
          36% {
            transform: translateY(0) scale(1);
          }
          60% { transform: translateY(3px) scale(0.99); }
        }

        @keyframes pulseGlow {
          0%, 100% { opacity: 0.65; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.04); }
        }

        @keyframes badgeFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
      <div className="min-h-screen bg-[#fffdfc] font-sans text-[#202124]">
      <header className="sticky top-0 z-30 border-b border-[#f0e8e6] bg-white/95 backdrop-blur">
        <div className="flex min-h-20 w-full items-center justify-between gap-4 px-6 md:px-10 lg:px-16">
          <a href="#top" onClick={() => setActiveSection("top")} className="flex shrink-0 items-center gap-2 text-2xl font-bold tracking-tight">
            <Heart className="h-8 w-8 text-[#e3262e]" strokeWidth={2} aria-hidden="true" />
            <span>Heart<span className="text-[#e3262e]">Bridge</span></span>
          </a>
          <nav className="hidden items-center gap-2 md:flex" aria-label="Landing page">
            {[
              ["top", "Home"],
              ["about", "About"],
              ["features", "Features"],
              ["how-it-works", "How it works"],
              ["faq", "FAQ"],
              ["contact", "Contact"],
            ].map(([section, label]) => (
              <a
                key={section}
                href={`#${section}`}
                aria-current={activeSection === section ? "location" : undefined}
                onClick={() => setActiveSection(section)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  activeSection === section
                    ? "bg-[#fff0ef] font-medium text-[#d8202b]"
                    : "text-[#625d5c] hover:bg-[#fff5f4]"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          <Link to="/signin" className="rounded-2xl bg-[#e3262e] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c91e27]">Sign in</Link>
        </div>
      </header>
      <main id="top">
        <section className="grid w-full items-center gap-10 px-6 py-12 md:grid-cols-2 md:px-10 md:py-16 lg:gap-14 lg:px-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#f0dedb] bg-white px-4 py-2 text-sm font-medium text-[#342f2e]">
              <Heart className="h-4 w-4 text-[#e3262e]" aria-hidden="true" />
              Support for the moments in between
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-[1.06] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              You don’t have to figure it all out <span className="text-[#e3262e]">alone.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#696260] md:text-xl">
              Talk things through, connect with people who understand, and feel more prepared for your next care conversation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="inline-flex items-center gap-2 rounded-2xl bg-[#e3262e] px-6 py-4 font-semibold text-white shadow-md shadow-red-200/60 transition hover:-translate-y-0.5 hover:bg-[#c91e27]">
                Get started <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Button
                variant="ghost"
                className="rounded-2xl border-[#f0c9c6] bg-white px-6 py-4 text-base text-[#302a29] hover:bg-[#fff5f4]"
                onClick={() => demo("maya@heartbridge.demo")}
                disabled={pending}
              >
                Try the demo
              </Button>
            </div>
            {error ? <div className="mt-4"><Alert>{error}</Alert></div> : null}
            <p className="mt-4 text-sm text-[#77706e]">A supportive community prototype — not a clinic or emergency service.</p>
          </div>
          <div className="relative min-w-0 px-0 py-2 sm:px-4 lg:px-6">
            <div className="heart-hero-scene overflow-hidden rounded-[2rem] border border-[#f0e8e6] bg-white p-3 shadow-[0_24px_70px_-36px_rgba(104,37,37,0.35)] sm:p-4">
              <div className="heart-hero-figure">
                <div className="heart-hero-glow" />
                <img
                  src="/heartbridge-heart.png"
                  alt="Illustration of a glowing heart with an electrocardiogram line"
                  className="heart-hero-image aspect-[16/9] w-full"
                />
              </div>
              <div className="flex items-center gap-3 px-2 py-4 sm:px-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#fff0ef] text-[#e3262e]">
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold">A space to talk things through</p>
                  <p className="mt-0.5 text-sm text-[#77706e]">The example below is demo text, not a live reply.</p>
                </div>
              </div>
              <div className="space-y-3 px-2 pb-2 text-sm leading-relaxed sm:px-3">
                <p className="ml-5 rounded-2xl rounded-tr-sm bg-[#edf6f7] px-4 py-3 sm:ml-12">I’m tired of explaining my condition to everyone. Nobody understands.</p>
                <p className="mr-5 rounded-2xl rounded-tl-sm bg-[#f2eef8] px-4 py-3 sm:mr-12">That sounds lonely and frustrating. Would you rather tell me what happened today, or look for a community where people have chosen to share similar experiences?</p>
              </div>
            </div>
            <div className="hero-badge absolute -left-1 top-1/3 hidden items-center gap-2 rounded-2xl border border-[#f0e8e6] bg-white px-4 py-3 text-sm font-medium shadow-lg sm:flex lg:-left-4">
              <ShieldCheck className="h-5 w-5 text-[#e3262e]" aria-hidden="true" /> Share at your pace
            </div>
            <div className="hero-badge absolute -right-1 bottom-10 hidden items-center gap-2 rounded-2xl border border-[#f0e8e6] bg-white px-4 py-3 text-sm font-medium shadow-lg sm:flex lg:-right-4" style={{ animationDelay: "0.8s" }}>
              <Users className="h-5 w-5 text-[#e3262e]" aria-hidden="true" /> Find your people
            </div>
          </div>
        </section>

        <section id="about" className="scroll-mt-24 border-y border-[#f0e8e6] bg-[#fff8f7] px-6 py-14 md:px-10 md:py-16 lg:px-16">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16">
            <div>
              <span className="rounded-full border border-[#f0dedb] bg-white px-4 py-2 text-sm font-medium">About HeartBridge</span>
              <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">A supportive space, on your terms.</h2>
            </div>
            <div className="space-y-4 text-lg leading-relaxed text-[#696260]">
              <p>
                HeartBridge is a health community prototype for people navigating health concerns and the people who support them. It brings reflection, peer connection, and care preparation together without asking anyone to share more than they choose.
              </p>
              <p>
                The companion can help you put thoughts into words, while community spaces let members connect around topics they choose. It is designed to support conversations—not to diagnose, treat, or replace professional care.
              </p>
              <p className="rounded-2xl border border-[#f0dedb] bg-white px-5 py-4 text-base">
                <strong className="text-[#302a29]">A note about this demo:</strong> AI replies may be labelled sample text, and clinicians and appointment slots are fictional examples.
              </p>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 px-6 py-16 md:px-10 md:py-20 lg:px-16">
          <div className="mx-auto max-w-3xl text-center">
            <span className="rounded-full border border-[#f0dedb] bg-white px-4 py-2 text-sm font-medium">Made for support, not diagnosis</span>
            <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">A little support can make the next step easier.</h2>
            <p className="mt-4 text-lg leading-relaxed text-[#696260]">Explore the tools available in the HeartBridge prototype.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { icon: Sparkles, title: "AI companion", body: "Reflect on what’s on your mind with a companion that is clear about being AI." },
              { icon: Users, title: "Peer communities", body: "Explore topic-based groups and choose the spaces you want to join." },
              { icon: Stethoscope, title: "Care preparation", body: "Browse labelled sample clinicians and gather questions before a visit." },
              { icon: MessageCircle, title: "Share on your terms", body: "Write a post for a community, a group, or keep it as a private draft." },
              { icon: ShieldCheck, title: "Privacy choices", body: "Manage consent, export your data, and delete your account from your settings." },
              { icon: CalendarCheck, title: "Plan a next step", body: "Prepare notes and try the clearly labelled sample appointment flow." },
            ].map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-3xl border border-[#f1e9e7] bg-white p-6 shadow-[0_12px_36px_-28px_rgba(46,31,29,0.35)] transition hover:-translate-y-1 hover:shadow-lg">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0ef] text-[#e3262e]">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-2 leading-relaxed text-[#696260]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 bg-[#fff8f7] px-6 py-16 md:px-10 md:py-20 lg:px-16">
          <div className="mx-auto max-w-3xl text-center">
            <span className="rounded-full border border-[#f0dedb] bg-white px-4 py-2 text-sm font-medium">How it works</span>
            <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">One step at a time.</h2>
            <p className="mt-4 text-lg text-[#696260]">Use the parts that help. You stay in control of what you share.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["01", "Make it yours", "Choose a display name, topics, and privacy preferences."],
              ["02", "Start a conversation", "Write, reflect, or explore the clearly labelled AI demo."],
              ["03", "Connect by choice", "Find topic-based communities and share only what you want."],
              ["04", "Prepare a next step", "Save questions and explore sample care resources."],
            ].map(([number, title, body]) => (
              <article key={number} className="relative rounded-3xl border border-[#f1e9e7] bg-white p-6">
                <span className="text-4xl font-bold tracking-tight text-[#f3dedd]">{number}</span>
                <h3 className="mt-3 text-xl font-semibold">{title}</h3>
                <p className="mt-2 leading-relaxed text-[#696260]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 px-6 py-16 md:px-10 md:py-20 lg:px-16">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <span className="rounded-full border border-[#f0dedb] bg-white px-4 py-2 text-sm font-medium">FAQ</span>
              <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">Good to know.</h2>
            </div>
            <div className="mt-8 divide-y divide-[#f0e8e6] rounded-3xl border border-[#f0e8e6] bg-white px-6">
              {[
                ["Is HeartBridge a healthcare provider?", "No. HeartBridge is a community and AI companion prototype, not a clinic, therapist, emergency service, or source of medical advice."],
                ["Are the AI replies always from a live model?", "No. When no model is configured, replies are labelled demo text. A live model is used only when the service is configured for it."],
                ["Are the clinicians and appointments real?", "No. Clinicians, posts, and appointment slots in this prototype are fictional samples, clearly labelled in the interface."],
                ["Can I control what I share?", "Yes. Posts can be public, limited to a community, or kept as private drafts. Privacy settings also let you manage consent and request a data export or account deletion."],
              ].map(([question, answer]) => (
                <details key={question} className="group py-5">
                  <summary className="cursor-pointer list-none pr-8 text-lg font-semibold marker:hidden">{question}</summary>
                  <p className="mt-3 leading-relaxed text-[#696260]">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pb-16 md:px-10 lg:px-16">
          <div className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#e3262e] to-[#ef5539] px-6 py-12 text-center text-white sm:px-12 md:py-16">
            <Heart className="mx-auto h-10 w-10" aria-hidden="true" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Your next step can start here.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-lg leading-relaxed text-white/90">Take a look around, choose what feels useful, and move at your own pace.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/signup" className="rounded-2xl bg-white px-6 py-3.5 font-semibold text-[#a91f27] transition hover:bg-[#fff1ef]">Create an account <ArrowRight className="ml-1 inline h-4 w-4" aria-hidden="true" /></Link>
              <Link to="/signin" className="rounded-2xl border border-white/40 bg-white/10 px-6 py-3.5 font-semibold text-white transition hover:bg-white/20">Sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-[#f0e8e6] bg-white px-6 py-10 md:px-10 lg:px-16">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <a href="#top" className="inline-flex items-center gap-2 text-xl font-bold">
              <Heart className="h-6 w-6 text-[#e3262e]" aria-hidden="true" />
              Heart<span className="text-[#e3262e]">Bridge</span>
            </a>
            <p className="mt-3 max-w-xl leading-relaxed text-[#696260]">A supportive health community prototype for conversation, connection, and care preparation.</p>
          </div>
          <div>
            <h3 className="font-semibold">Explore</h3>
            <div className="mt-3 flex flex-col items-start gap-2 text-sm text-[#696260]">
              <a href="#features" className="hover:text-[#d8202b]">Features</a>
              <a href="#how-it-works" className="hover:text-[#d8202b]">How it works</a>
              <a href="#faq" className="hover:text-[#d8202b]">FAQ</a>
            </div>
          </div>
          <div>
            <h3 className="font-semibold">Your account</h3>
            <div className="mt-3 flex flex-col items-start gap-2 text-sm text-[#696260]">
              <Link to="/signin" className="hover:text-[#d8202b]">Sign in</Link>
              <Link to="/signup" className="hover:text-[#d8202b]">Create account</Link>
            </div>
          </div>
          <div id="contact" className="scroll-mt-24">
            <h3 className="font-semibold">Contact</h3>
            <div className="mt-3 flex flex-col items-start gap-3 text-sm text-[#696260]">
              <a href="mailto:contact@gnn-hf.med" className="inline-flex items-center gap-2 hover:text-[#d8202b]">
                <Mail className="h-4 w-4 text-[#e3262e]" aria-hidden="true" /> contact@gnn-hf.med
              </a>
              <a href="tel:+15551234567" className="inline-flex items-center gap-2 hover:text-[#d8202b]">
                <Phone className="h-4 w-4 text-[#e3262e]" aria-hidden="true" /> +1 (555) 123-4567
              </a>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#77706e]">HeartBridge is a prototype and does not provide clinical support.</p>
          </div>
        </div>
        <div className="mt-8 border-t border-[#f0e8e6] pt-5 text-sm leading-relaxed text-[#77706e]">
          HeartBridge is not a clinician, therapist, or emergency service. If you may be in danger, contact local emergency services.
        </div>
      </footer>
    </div>
    </>
  )
}

export function SignIn() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  if (user) return <Navigate to={user.onboarded ? "/home" : "/onboarding"} replace />
  return (
    <AuthShell mode="signin" title="Welcome back" subtitle="Sign in to your HeartBridge account.">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setError("")
          try {
            const me = await login(email, password)
            navigate(me.onboarded ? "/home" : "/onboarding")
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not sign in.")
          } finally {
            setPending(false)
          }
        }}
      >
        <Field label="Email"><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-[#3b3635]">Password</label>
            <Link to="/forgot-password" className="text-xs font-medium text-[#d8202b] hover:text-[#b51720]">Forgot password?</Link>
          </div>
          <input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={pending} className="!w-full !rounded-xl !bg-[#e3262e] !py-3 !text-white hover:!bg-[#c91e27]">Sign in <ArrowRight size={16} aria-hidden="true" /></Button>
      </form>
      <p className="mt-4 text-center text-sm text-[#77706e]">New here? <Link to="/signup" className="font-medium text-[#d8202b]">Create an account</Link></p>
    </AuthShell>
  )
}

export function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    setMessage("")
    try {
      const response = await api<{ ok: boolean; reset_token?: string; message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
      setSent(true)
      setToken(response.reset_token ?? "")
      setMessage(response.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request a reset code.")
    } finally {
      setPending(false)
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    setMessage("")
    try {
      const response = await api<{ ok: boolean; message: string }>("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, token, password: newPassword }),
      })
      setMessage(response.message)
      setTimeout(() => navigate("/signin"), 1600)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the password.")
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell mode="forgot" title="Reset your password" subtitle="Request a demo reset code and choose a new password.">
      <div className="space-y-5">
        <form className="space-y-4" onSubmit={requestCode}>
          <Field label="Email"><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          {message ? <Alert>{message}</Alert> : null}
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={pending} className="!w-full !rounded-xl !bg-[#e3262e] !py-3 !text-white hover:!bg-[#c91e27]">
            {pending ? "Sending..." : "Send reset code"}
          </Button>
        </form>

        {sent ? (
          <form className="space-y-4 border-t border-[#f0e8e6] pt-5" onSubmit={resetPassword}>
            <Field label="Reset code" hint="This is returned by the demo API after the email request."><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} value={token} onChange={(event) => setToken(event.target.value)} required /></Field>
            <Field label="New password" hint="At least 8 characters with a letter and a number."><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
            <Button type="submit" disabled={pending} className="!w-full !rounded-xl !bg-[#202124] !py-3 !text-white hover:!bg-[#0f1013]">
              {pending ? "Updating..." : "Update password"}
            </Button>
          </form>
        ) : null}
      </div>
      <p className="mt-4 text-center text-sm text-[#77706e]">Remembered it? <Link to="/signin" className="font-medium text-[#d8202b]">Back to sign in</Link></p>
    </AuthShell>
  )
}

export function SignUp() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  if (user) return <Navigate to={user.onboarded ? "/home" : "/onboarding"} replace />
  return (
    <AuthShell mode="signup" title="Create your account" subtitle="Use a display name, not your diagnosis.">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setPending(true)
          setError("")
          try {
            await register(email, password, name)
            navigate("/onboarding")
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not create the account.")
          } finally {
            setPending(false)
          }
        }}
      >
        <Field label="Display name" hint="This is what other members see."><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Email"><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number."><input className={`${controlClass} rounded-xl border-[#e9e2e1] bg-[#fffdfc]`} type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={pending} className="!w-full !rounded-xl !bg-[#e3262e] !py-3 !text-white hover:!bg-[#c91e27]">Continue <ArrowRight size={16} aria-hidden="true" /></Button>
      </form>
      <p className="mt-4 text-center text-sm text-[#77706e]">Already registered? <Link to="/signin" className="font-medium text-[#d8202b]">Sign in</Link></p>
    </AuthShell>
  )
}

function AuthShell({ mode, title, subtitle, children }: { mode: "signin" | "signup" | "forgot"; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <section className="relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#e3262e] to-[#ef5039] px-6 py-10 text-center text-white lg:min-h-screen lg:px-12">
        <div className="pointer-events-none absolute inset-0 opacity-15" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,.55) 1px, transparent 1.5px)", backgroundSize: "24px 24px" }} />
        <div className="relative z-10 w-full max-w-lg">
          <div className="mx-auto overflow-hidden rounded-2xl border border-white/25 bg-white/90 p-3 shadow-2xl shadow-red-950/20 sm:max-w-sm">
            <img src="/heartbridge-care.png" alt="Hands gently holding a heart" className="aspect-[4/3] w-full rounded-xl object-cover" />
          </div>
          <h2 className="mt-8 text-2xl font-bold tracking-tight sm:text-3xl">You don’t have to face it alone.</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/90 sm:text-base">
            Find space to reflect, people who understand, and confidence for the conversations ahead.
          </p>
        </div>
      </section>
      <section className="relative flex min-h-[560px] items-center justify-center px-5 py-14 sm:px-10 lg:min-h-screen lg:px-12">
        <Link to="/" className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-xl border border-[#f2c9c6] bg-[#fff7f6] px-4 py-2 text-sm font-medium text-[#d8202b] transition hover:bg-[#ffedeb] sm:right-8 sm:top-8">
          <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" /> Back to home
        </Link>
        <div className="w-full max-w-md">
          <Link to="/" className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-[#202124]">
            <Heart className="h-7 w-7 text-[#e3262e]" aria-hidden="true" />
            Heart<span className="text-[#e3262e]">Bridge</span>
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#202124]">{title}</h1>
          <p className="mt-2 text-sm text-[#77706e]">{subtitle}</p>
          <div className="mt-6 rounded-3xl border border-[#f0e8e6] bg-white p-5 shadow-[0_16px_50px_-32px_rgba(80,37,37,0.32)] sm:p-6">
            {children}
          </div>
          <p className="mt-5 text-center text-xs leading-relaxed text-[#817977]">
            {mode === "signup"
              ? "By creating an account, you choose what to share and can manage your privacy preferences."
              : mode === "forgot"
                ? "This demo flow uses a short-lived reset code in the backend so you can test the password-reset path."
                : "Your account is for this HeartBridge community prototype."}
          </p>
          <p className="mt-2 text-center text-xs text-[#817977]">HeartBridge is not a clinic, therapist, or emergency service.</p>
        </div>
      </section>
    </div>
  )
}
