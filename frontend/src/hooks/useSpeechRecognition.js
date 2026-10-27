import { useCallback, useEffect, useRef, useState } from 'react'

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

const ERROR_MESSAGES = {
  'not-allowed': 'Permiso de micrófono denegado. Habilítalo en la configuración del navegador.',
  'service-not-allowed': 'El navegador no permite el reconocimiento de voz en este sitio.',
  'audio-capture': 'No se detectó ningún micrófono.',
  'network': 'Error de red en el reconocimiento de voz.',
  'no-speech': 'No te escuché. Intenta de nuevo.',
  'language-not-supported': 'El idioma configurado no está disponible.',
}

/**
 * Speech-to-Text con la Web Speech API.
 * Entrega la frase completa a `onFinal` cuando el usuario termina de hablar
 * (o cuando se detiene manualmente).
 */
export function useSpeechRecognition({ lang = 'es-CO', onFinal } = {}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)

  const recognitionRef = useRef(null)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const onFinalRef = useRef(onFinal)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])

  const supported = Boolean(SpeechRecognitionAPI)

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return
    setError(null)
    finalRef.current = ''
    interimRef.current = ''
    setInterim('')

    const rec = new SpeechRecognitionAPI()
    rec.lang = lang
    rec.continuous = false      // una frase por turno: experiencia tipo walkie-talkie
    rec.interimResults = true   // transcripción en tiempo real
    rec.maxAlternatives = 1

    rec.onstart = () => setListening(true)

    rec.onresult = (event) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalRef.current += t
        else interimText += t
      }
      interimRef.current = interimText
      setInterim((finalRef.current + ' ' + interimText).trim())
    }

    rec.onerror = (event) => {
      if (event.error !== 'aborted') {
        setError(ERROR_MESSAGES[event.error] || `Error de reconocimiento: ${event.error}`)
      }
    }

    rec.onend = () => {
      const text = (finalRef.current || interimRef.current).trim()
      recognitionRef.current = null
      setListening(false)
      setInterim('')
      if (text) onFinalRef.current?.(text)
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch (e) {
      recognitionRef.current = null
      setError('No fue posible iniciar el micrófono.')
    }
  }, [lang, supported])

  /** Detiene y entrega lo capturado hasta el momento. */
  const stop = useCallback(() => recognitionRef.current?.stop(), [])

  /** Cancela sin entregar texto. */
  const abort = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    recognitionRef.current?.abort()
  }, [])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { supported, listening, interim, error, start, stop, abort, clearError: () => setError(null) }
}
