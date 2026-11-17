import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { saveSession } from '../lib/session'
import { serializeProfileForm, validateProfileForm } from '../lib/agencyProfile'
import AgencyProfileFields from '../components/AgencyProfileFields'
import './Auth.css'

export default function Register({ onRegister }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    agencyName: '',
    country: '',
    alignment: '',
    launchSiteName: '',
    launchSiteLat: '',
    launchSiteLon: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')

    const profileError = validateProfileForm(formData)
    if (profileError) {
      setError(profileError)
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          agencyName: formData.agencyName,
          country: formData.country,
          ...serializeProfileForm(formData),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Registration failed')
      }

      localStorage.setItem('afm_user', JSON.stringify(data.user))
      localStorage.setItem('afm_agency', JSON.stringify(data.agency))
      saveSession(data.session)
      onRegister(data.user)
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
          <span className="auth-meta">NEW AGENCY</span>
        </div>

        <div className="auth-panel-body">
          <h1 className="auth-title">Registrasi Agensi</h1>
          <p className="auth-sub">Inisialisasi direktori // Cycle 14</p>

          {error && <div className="auth-error">&gt; {error}</div>}

          <form onSubmit={handleRegister} className="auth-form">
            <label className="auth-field">
              Email
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="director@agency.gov"
                autoComplete="email"
                required
              />
            </label>

            <label className="auth-field">
              Password
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Minimal 6 karakter"
                autoComplete="new-password"
                required
              />
            </label>

            <label className="auth-field">
              Nama Agensi
              <input
                type="text"
                name="agencyName"
                value={formData.agencyName}
                onChange={handleChange}
                placeholder="Valoria Space Agency"
                required
              />
            </label>

            <label className="auth-field">
              Negara
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                placeholder="Valoria"
              />
            </label>

            <div className="auth-section">
              <span>Profil Operasional</span>
              <p>Alignment dan launch site dipakai untuk diplomasi serta peluncuran.</p>
            </div>

            <AgencyProfileFields
              form={formData}
              onChange={setFormData}
              variant="auth"
              disabled={loading}
            />

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Mendaftarkan...' : 'Buat Agensi // Register'}
            </button>
          </form>

          <p className="auth-foot">
            Sudah punya agensi? <Link to="/login">Login</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
