import { useCallback, useEffect, useRef, useState } from 'react'
import CamiOrb from './CamiOrb.jsx'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis.js'
import { getSuggestions, sendChat } from '../api/cami.js'

const LANG = 'es-CO'

const STATUS_LABEL = {
  idle: 'Inactivo',
  listening: 'Escuchando...',
  thinking: 'Pensando...',
  speaking: 'Hablando...',
}
const STATUS_DOT = {
  idle: 'bg-slate-400',
  listening: 'bg-rose-400 animate-pulse',
  thinking: 'bg-amber-300 animate-pulse',
  speaking: 'bg-emerald-400 animate-pulse',
}

const FALLBACK_SUGGESTIONS = [
  '¿Cuáles son los horarios de atención?',
  '¿Cómo agendo una cita presencial?',
  '¿Cómo radico una PQRS en línea?',
  '¿Dónde están ubicadas las oficinas?',
]

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hola, soy Cami, su asistente de atención ciudadana. Toque el micrófono y cuénteme en qué le puedo ayudar.',
}

let idSeq = 0
const uid = () => `${Date.now()}-${++idSeq}`

/* ------------------------------ Iconos ------------------------------ */
const Icon = {
  Mic: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  ),
  Stop: (p) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
  ),
  VolumeOn: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </svg>
  ),
  VolumeOff: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6" />
    </svg>
  ),
  Send: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m22 2-7 20-4-9-9-4 20-7zM22 2 11 13" />
    </svg>
  ),
  Trash: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  ),
  Speaker: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  ),
}

/* ------------------------------ Componente ------------------------------ */
export default function CamiChat() {
  const [messages, setMessages] = useState([WELCOME])
  const [suggestions, setSuggestions] = useState([])
  const [thinking, setThinking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const [text, setText] = useState('')
  const [apiError, setApiError] = useState(null)

  const messagesRef = useRef(messages)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const handsFreeRef = useRef(handsFree)
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { handsFreeRef.current = handsFree }, [handsFree])

  const tts = useSpeechSynthesis({ lang: LANG })

  // El STT se declara con un callback estable que apunta a handleSend vía ref
  const handleSendRef = useRef(() => {})
  const stt = useSpeechRecognition({ lang: LANG, onFinal: (t) => handleSendRef.current(t) })

  const status = stt.listening ? 'listening' : thinking ? 'thinking' : tts.speaking ? 'speaking' : 'idle'

  /* ---- Sugerencias ---- */
  useEffect(() => {
    getSuggestions()
      .then((s) => setSuggestions(s.length ? s : FALLBACK_SUGGESTIONS))
      .catch(() => setSuggestions(FALLBACK_SUGGESTIONS))
  }, [])

  /* ---- Auto-scroll ---- */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, stt.interim, thinking])

  /* ---- Hablar respuesta ---- */
  const speakReply = useCallback(
    (reply) => {
      if (muted || !tts.supported) return
      tts.speak(reply, {
        onEnd: () => {
          // Modo manos libres: vuelve a escuchar al terminar de hablar
          if (handsFreeRef.current && stt.supported) setTimeout(() => stt.start(), 250)
        },
      })
    },
    [muted, tts, stt]
  )

  /* ---- Enviar mensaje al backend ---- */
  const handleSend = useCallback(
    async (raw) => {
      const message = raw.trim()
      if (!message) return
      tts.cancel()
      abortRef.current?.abort()
      setApiError(null)

      const history = messagesRef.current
        .filter((m) => m.id !== 'welcome' && !m.error)
        .map(({ role, content }) => ({ role, content }))

      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: message }])
      setThinking(true)

      const controller = new AbortController()
      abortRef.current = controller
      try {
        const reply = await sendChat(message, history, controller.signal)
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: reply }])
        speakReply(reply)
      } catch (err) {
        if (err.name === 'AbortError') return
        const msg = err.message || 'No pude conectarme con el servidor.'
        setApiError(msg)
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', error: true, content: 'Lo siento, tuve un problema para responder. ¿Lo intentamos de nuevo?' },
        ])
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setThinking(false)
        }
      }
    },
    [tts, speakReply]
  )
  useEffect(() => { handleSendRef.current = handleSend }, [handleSend])

  /* ---- Botón de micrófono (toggle + interrupción) ---- */
  const onMicClick = () => {
    if (stt.listening) return stt.stop()
    if (thinking) return
    tts.cancel() // barge-in: interrumpe a Cami si está hablando
    stt.start()
  }

  // Atajo: barra espaciadora para hablar (fuera del input de texto)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return
      e.preventDefault()
      onMicClick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleMute = () => {
    setMuted((m) => {
      if (!m) tts.cancel()
      return !m
    })
  }

  const clearChat = () => {
    tts.cancel()
    stt.abort()
    abortRef.current?.abort()
    setThinking(false)
    setApiError(null)
    setMessages([WELCOME])
  }

  const onSubmitText = (e) => {
    e.preventDefault()
    if (!text.trim() || thinking) return
    handleSend(text)
    setText('')
  }

  const errorText = stt.error || apiError

  /* ------------------------------ UI ------------------------------ */
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e1b4b_0%,_#020617_60%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cami</h1>
            <p className="text-sm text-slate-400">Asistente de voz · Atención ciudadana</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm" role="status" aria-live="polite">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
              {STATUS_LABEL[status]}
            </span>
            <button
              onClick={toggleMute}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                muted ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
              aria-pressed={muted}
              title={muted ? 'Activar voz de Cami' : 'Silenciar voz de Cami'}
            >
              {muted ? <Icon.VolumeOff className="h-4 w-4" /> : <Icon.VolumeOn className="h-4 w-4" />}
              <span className="hidden sm:inline">{muted ? 'Silenciada' : 'Voz activa'}</span>
            </button>
            <button
              onClick={clearChat}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10"
              title="Reiniciar conversación"
            >
              <Icon.Trash className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="grid flex-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* Panel de voz */}
          <section className="flex flex-col items-center justify-center gap-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-10">
            <CamiOrb status={status} size={220} />

            <div className="min-h-[3rem] max-w-md text-center text-lg text-slate-200">
              {stt.listening ? (
                <span className="italic text-slate-300">{stt.interim || 'Te escucho...'}</span>
              ) : thinking ? (
                <span className="text-slate-400">Un momento, estoy buscando la respuesta...</span>
              ) : tts.speaking ? (
                <span className="text-slate-400">Toque el micrófono para interrumpir</span>
              ) : (
                <span className="text-slate-400">Toque el micrófono o presione la barra espaciadora</span>
              )}
            </div>

            {/* Botón principal */}
            <div className="flex items-center gap-4">
              {tts.speaking && (
                <button
                  onClick={tts.cancel}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/10"
                  title="Detener voz"
                  aria-label="Detener voz"
                >
                  <Icon.Stop className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={onMicClick}
                disabled={!stt.supported || thinking}
                aria-label={stt.listening ? 'Detener micrófono' : 'Hablar con Cami'}
                aria-pressed={stt.listening}
                className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-xl transition focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 ${
                  stt.listening
                    ? 'scale-110 bg-rose-500 shadow-rose-500/40 hover:bg-rose-600'
                    : 'bg-indigo-500 shadow-indigo-500/40 hover:scale-105 hover:bg-indigo-400'
                }`}
              >
                {stt.listening ? <Icon.Stop className="h-8 w-8" /> : <Icon.Mic className="h-9 w-9" />}
              </button>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={handsFree}
                onChange={(e) => setHandsFree(e.target.checked)}
                disabled={!stt.supported || muted}
              />
              Modo manos libres (escuchar de nuevo al terminar)
            </label>

            {!stt.supported && (
              <p className="max-w-sm rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200">
                Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge, o escribe tu pregunta.
              </p>
            )}
            {errorText && (
              <p className="max-w-sm rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-200">
                {errorText}
              </p>
            )}

            {/* Sugerencias */}
            <div className="flex max-w-lg flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  disabled={thinking}
                  className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-4 py-2 text-sm text-indigo-100 transition hover:border-indigo-300/50 hover:bg-indigo-400/20 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          {/* Panel de chat */}
          <section className="flex max-h-[80vh] min-h-[420px] flex-col rounded-3xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 px-5 py-3 text-sm font-medium text-slate-300">Transcripción</div>

            <div ref={scrollRef} className="chat-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} onReplay={!muted && tts.supported ? () => tts.speak(m.content) : null} />
              ))}

              {stt.listening && stt.interim && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md border border-dashed border-indigo-300/40 px-4 py-2.5 italic text-slate-300">
                    {stt.interim}
                  </div>
                </div>
              )}

              {thinking && (
                <div className="flex justify-start">
                  <div className="flex gap-1 rounded-2xl rounded-bl-md bg-white/10 px-4 py-3">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={onSubmitText} className="flex gap-2 border-t border-white/10 p-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="O escribe tu pregunta..."
                className="flex-1 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-indigo-400/60"
              />
              <button
                type="submit"
                disabled={!text.trim() || thinking}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:opacity-40"
                aria-label="Enviar"
              >
                <Icon.Send className="h-4 w-4" />
              </button>
            </form>
          </section>
        </main>

        <footer className="mt-4 text-center text-xs text-slate-500">
          {tts.voice ? `Voz: ${tts.voice.name} (${tts.voice.lang})` : 'Voz del sistema por defecto'} · Prototipo
        </footer>
      </div>
    </div>
  )
}

function MessageBubble({ message, onReplay }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-indigo-500 text-white'
            : message.error
            ? 'rounded-bl-md border border-rose-400/30 bg-rose-500/10 text-rose-100'
            : 'rounded-bl-md bg-white/10 text-slate-100'
        }`}
      >
        {!isUser && <div className="mb-0.5 text-xs font-semibold text-emerald-300/90">Cami</div>}
        {message.content}
        {!isUser && !message.error && onReplay && (
          <button
            onClick={onReplay}
            className="absolute -right-9 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 opacity-0 transition hover:bg-white/10 hover:text-slate-200 group-hover:opacity-100 focus:opacity-100"
            title="Escuchar de nuevo"
            aria-label="Escuchar de nuevo"
          >
            <Icon.Speaker className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
