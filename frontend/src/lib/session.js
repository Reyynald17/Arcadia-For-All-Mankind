const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787/api').replace(/\/$/, '')
const SESSION_KEY = 'afm_session'

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveSession(session) {
  if (session?.access_token) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem('afm_user')
  localStorage.removeItem('afm_agency')
}

export async function getAccessToken() {
  const session = getStoredSession()
  if (!session?.access_token) return null

  const expiresAt = Number(session.expires_at)
  const stillValid = !Number.isFinite(expiresAt) || Date.now() / 1000 < expiresAt - 60
  if (stillValid) return session.access_token

  if (!session.refresh_token) return null

  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
    if (!response.ok) return null

    const payload = await response.json()
    saveSession(payload.session)
    return payload.session?.access_token || null
  } catch {
    return null
  }
}
