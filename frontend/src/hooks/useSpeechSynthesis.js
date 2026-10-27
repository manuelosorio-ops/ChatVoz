import { useCallback, useEffect, useRef, useState } from 'react'

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

// Nombres comunes de voces femeninas en español (Chrome, Edge, Safari/macOS, Windows, Android)
const FEMALE_HINTS = [
  'salome', 'dalia', 'paloma', 'elvira', 'helena', 'laura', 'sabina', 'paulina', 'monica', 'mónica',
  'marisol', 'soledad', 'angelica', 'francisca', 'esperanza', 'lucia', 'lucía', 'female', 'mujer',
  'google español',
]
const LANG_PRIORITY = ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-ES']

function scoreVoice(v) {
  const name = v.name.toLowerCase()
  const lang = (v.lang || '').replace('_', '-')
  if (!lang.toLowerCase().startsWith('es')) return -1
  let score = 10
  const idx = LANG_PRIORITY.findIndex((l) => lang.toLowerCase() === l.toLowerCase())
  if (idx >= 0) score += (LANG_PRIORITY.length - idx) * 3
  if (FEMALE_HINTS.some((h) => name.includes(h))) score += 20
  if (/natural|neural|online|premium|enhanced/.test(name)) score += 8
  if (/male|hombre|jorge|diego|juan|pablo|raul|raúl|carlos|alvaro|álvaro/.test(name) && !name.includes('female')) score -= 25
  return score
}

export function pickSpanishFemaleVoice(voices) {
  return [...voices].map((v) => [v, scoreVoice(v)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Text-to-Speech con window.speechSynthesis. */
export function useSpeechSynthesis({ lang = 'es-CO', rate = 1.02, pitch = 1.05 } = {}) {
  const [speaking, setSpeaking] = useState(false)
  const [voice, setVoice] = useState(null)
  const utteranceRef = useRef(null) // referencia viva: evita que Chrome recolecte la utterance y no dispare onend
  const keepAliveRef = useRef(null)

  const supported = Boolean(synth)

  useEffect(() => {
    if (!supported) return
    const load = () => setVoice(pickSpanishFemaleVoice(synth.getVoices()))
    load()
    synth.addEventListener?.('voiceschanged', load)
    return () => synth.removeEventListener?.('voiceschanged', load)
  }, [supported])

  const clearKeepAlive = () => {
    clearInterval(keepAliveRef.current)
    keepAliveRef.current = null
  }

  const cancel = useCallback(() => {
    if (!supported) return
    clearKeepAlive()
    synth.cancel()
    setSpeaking(false)
  }, [supported])

  const speak = useCallback(
    (text, { onEnd } = {}) => {
      if (!supported || !text) { onEnd?.(); return }
      synth.cancel()

      const u = new SpeechSynthesisUtterance(text)
      u.lang = voice?.lang || lang
      if (voice) u.voice = voice
      u.rate = rate
      u.pitch = pitch

      const finish = () => {
        clearKeepAlive()
        if (utteranceRef.current === u) {
          utteranceRef.current = null
          setSpeaking(false)
        }
        onEnd?.()
      }
      u.onstart = () => setSpeaking(true)
      u.onend = finish
      u.onerror = finish

      utteranceRef.current = u
      setSpeaking(true)
      synth.speak(u)

      // Workaround de Chrome: las voces remotas (Google) se congelan en textos de ~15 s
      clearKeepAlive()
      if (voice && !voice.localService) keepAliveRef.current = setInterval(() => {
        if (synth.speaking && !synth.paused) { synth.pause(); synth.resume() }
      }, 10000)
    },
    [supported, voice, lang, rate, pitch]
  )

  useEffect(() => () => { clearKeepAlive(); synth?.cancel() }, [])

  return { supported, speaking, voice, speak, cancel }
}
