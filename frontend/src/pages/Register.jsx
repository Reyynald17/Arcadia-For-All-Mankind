import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './Auth.css'

export default function Register({ onRegister }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    agencyName: '',
    country: '',
    culture: '',
    history: '',
    targets: ''
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
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
          culture: formData.culture,
          history: formData.history,
          targets: formData.targets
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      localStorage.setItem('afm_user', JSON.stringify(data.user))
      localStorage.setItem('afm_agency', JSON.stringify(data.agency))
      onRegister(data.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box auth-box-register">
        <h1>🚀 Arcadia For All Mankind</h1>
        <h2>Create Your Space Agency</h2>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleRegister} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="agencyName">Agency Name</label>
            <input
              id="agencyName"
              type="text"
              name="agencyName"
              value={formData.agencyName}
              onChange={handleChange}
              placeholder="e.g., Soviet Space Program"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="country">Country</label>
              <input
                id="country"
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                placeholder="e.g., Soviet Union"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="culture">Culture</label>
              <input
                id="culture"
                type="text"
                name="culture"
                value={formData.culture}
                onChange={handleChange}
                placeholder="e.g., Communist"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="history">History/Background</label>
            <textarea
              id="history"
              name="history"
              value={formData.history}
              onChange={handleChange}
              placeholder="Tell us about your agency..."
              rows="3"
            />
          </div>

          <div className="form-group">
            <label htmlFor="targets">Mission Targets</label>
            <textarea
              id="targets"
              name="targets"
              value={formData.targets}
              onChange={handleChange}
              placeholder="What are your goals? (Moon landing, Mars mission, etc.)"
              rows="3"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating Agency...' : 'Create Agency'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Login here</Link>
        </p>
      </div>
    </div>
  )
}