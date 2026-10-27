const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  let data = null
  try { data = await res.json() } catch { /* respuesta sin JSON */ }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : `Error ${res.status}`
    throw new Error(detail)
  }
  return data
}

export const getHealth = () => request('/api/health')

export const getSuggestions = async () => (await request('/api/suggestions')).suggestions ?? []

/** history: [{ role: 'user' | 'assistant', content: string }] */
export const sendChat = async (message, history = [], signal) =>
  (await request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
    signal,
  })).reply
