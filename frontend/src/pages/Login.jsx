import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './Auth.css'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      localStorage.setItem('afm_user', JSON.stringify(data.user))
      localStorage.setItem('afm_session', JSON.stringify(data.session))
      onLogin(data.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-panel-head">
          <span className="auth-brand">
            <span className="material-symbols-outlined">satellite_alt</span>
            ARCADIA : AFM
          </span>
          <span className="auth-meta">SYS.1969</span>
        </div>

        <div className="auth-panel-body">
          <h1 className="auth-title">Mission Control Login</h1>
          <p className="auth-sub">Akses direktori agensi // Cycle 14</p>

          {error && <div className="auth-error">&gt; {error}</div>}

          <form onSubmit={handleLogin} className="auth-form">
            <label className="auth-field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="director@agency.gov"
                autoComplete="email"
                required
              />
            </label>

            <label className="auth-field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                autoComplete="current-password"
                required
              />
            </label>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Menghubungkan...' : 'Masuk // Login'}
            </button>
          </form>

          <p className="auth-foot">
            Belum punya agensi? <Link to="/register">Registrasi</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
