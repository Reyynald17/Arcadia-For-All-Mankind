import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'

export default function Dashboard({ user }) {
  const [agency, setAgency] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const fetchAgency = async () => {
      try {
        const session = JSON.parse(localStorage.getItem('afm_session') || '{}')
        const response = await fetch(
          `${import.meta.env.VITE_API_URL}/agency/${user.id}`,
          {
            headers: {
              'Authorization': `Bearer ${session.access_token}`
            }
          }
        )

        if (!response.ok) {
          throw new Error('Failed to fetch agency data')
        }

        const data = await response.json()
        setAgency(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchAgency()
  }, [user])

  const handleLogout = () => {
    localStorage.removeItem('afm_user')
    localStorage.removeItem('afm_session')
    localStorage.removeItem('afm_agency')
    navigate('/login')
  }

  if (loading) {
    return <div className="loading">Loading agency data...</div>
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  if (!agency) {
    return <div className="error">No agency data found</div>
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>{agency.name}</h1>
          <p className="country-badge">{agency.country}</p>
        </div>
        <button className="btn-logout" onClick={handleLogout}>Logout</button>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-grid">
          {/* Agency Overview */}
          <section className="card agency-overview">
            <h2>Agency Overview</h2>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">Culture:</span>
                <span className="value">{agency.culture || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="label">Total Launches:</span>
                <span className="value">{agency.total_launches}</span>
              </div>
              <div className="info-item">
                <span className="label">Successful Launches:</span>
                <span className="value">{agency.successful_launches}</span>
              </div>
              <div className="info-item">
                <span className="label">Success Rate:</span>
                <span className="value">
                  {agency.total_launches > 0
                    ? ((agency.successful_launches / agency.total_launches) * 100).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
            </div>
            <p className="history">{agency.history || 'No history recorded'}</p>
          </section>

          {/* Resources */}
          <section className="card resources">
            <h2>Resources</h2>
            <div className="resource-item">
              <div className="resource-header">
                <span>Action Points (AP)</span>
                <span className="resource-value">{agency.ap}</span>
              </div>
              <div className="progress-bar">
                <div className="progress" style={{ width: `${(agency.ap / 100) * 100}%` }}></div>
              </div>
            </div>

            <div className="resource-item">
              <div className="resource-header">
                <span>Budget</span>
                <span className="resource-value">${agency.budget}B</span>
              </div>
              <div className="progress-bar">
                <div className="progress" style={{ width: `${(agency.budget / 100) * 100}%` }}></div>
              </div>
            </div>

            <div className="resource-item">
              <div className="resource-header">
                <span>Research Points (RP)</span>
                <span className="resource-value">{agency.rp}</span>
              </div>
              <div className="progress-bar">
                <div className="progress" style={{ width: `${(agency.rp / 100) * 100}%` }}></div>
              </div>
            </div>
          </section>

          {/* Statistics */}
          <section className="card statistics">
            <h2>Key Statistics</h2>
            <div className="stat-grid">
              <div className="stat-box">
                <h3>Space Infrastructure (SI)</h3>
                <p className="stat-value">{agency.si}</p>
              </div>
              <div className="stat-box">
                <h3>International Prestige Index (IPI)</h3>
                <p className="stat-value">{agency.ipi}</p>
              </div>
              <div className="stat-box">
                <h3>Space Launch Readiness (SLR)</h3>
                <p className="stat-value">{agency.slr}</p>
              </div>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="card quick-actions">
            <h2>Quick Actions</h2>
            <div className="button-group">
              <button className="btn-action">Research Tech</button>
              <button className="btn-action">Produce Equipment</button>
              <button className="btn-action">Launch Mission</button>
              <button className="btn-action">View Rankings</button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}