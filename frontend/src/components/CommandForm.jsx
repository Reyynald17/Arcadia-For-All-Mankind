import { useState } from 'react'

function CommandForm({ agencyId, onCommandExecuted }) {
  const [command, setCommand] = useState('')
  const [selectedCommand, setSelectedCommand] = useState('research')
  const [params, setParams] = useState({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const commandsList = [
    { id: 'research', label: '🔬 Start Research', fields: ['technology'] },
    { id: 'production', label: '🏗️ Produce Vehicle', fields: ['vehicleName', 'vehicleType'] },
    { id: 'launch', label: '🚀 Launch Mission', fields: ['missionName', 'missionType'] }
  ]

  const handleParamChange = (field, value) => {
    setParams({ ...params, [field]: value })
  }

  const handleExecuteCommand = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      let endpoint = ''
      let body = { agencyId }

      if (selectedCommand === 'research') {
        endpoint = '/api/research/start'
        body.technologyName = params.technology
      } else if (selectedCommand === 'production') {
        endpoint = '/api/production/vehicle'
        body.vehicleName = params.vehicleName
        body.vehicleType = params.vehicleType
      } else if (selectedCommand === 'launch') {
        endpoint = '/api/launch/mission'
        body.missionName = params.missionName
        body.missionType = params.missionType
        body.vehicleId = params.vehicleId
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Command failed')
      }

      setMessage(`✅ ${data.message}`)
      setParams({})
      setTimeout(() => {
        onCommandExecuted()
        setMessage('')
      }, 1000)
    } catch (error) {
      setMessage(`❌ ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const currentCommand = commandsList.find((c) => c.id === selectedCommand)

  return (
    <div className="command-form">
      <h3>⚙️ Command Center</h3>
      {message && <div className={`command-message ${message.includes('✅') ? 'success' : 'error'}`}>{message}</div>}
      <form onSubmit={handleExecuteCommand}>
        <div className="form-group">
          <label>Select Command</label>
          <select
            value={selectedCommand}
            onChange={(e) => {
              setSelectedCommand(e.target.value)
              setParams({})
            }}
          >
            {commandsList.map((cmd) => (
              <option key={cmd.id} value={cmd.id}>
                {cmd.label}
              </option>
            ))}
          </select>
        </div>

        {currentCommand &&
          currentCommand.fields.map((field) => {
            if (field === 'vehicleType') {
              return (
                <div key={field} className="form-group">
                  <label>Vehicle Type</label>
                  <select
                    value={params[field] || ''}
                    onChange={(e) => handleParamChange(field, e.target.value)}
                    required
                  >
                    <option value="">Select type...</option>
                    <option value="sounding-rocket">Sounding Rocket</option>
                    <option value="orbital-rocket">Orbital Rocket</option>
                    <option value="satellite">Satellite</option>
                    <option value="capsule">Capsule</option>
                  </select>
                </div>
              )
            } else if (field === 'missionType') {
              return (
                <div key={field} className="form-group">
                  <label>Mission Type</label>
                  <select
                    value={params[field] || ''}
                    onChange={(e) => handleParamChange(field, e.target.value)}
                    required
                  >
                    <option value="">Select type...</option>
                    <option value="test">Test Flight</option>
                    <option value="scientific">Scientific</option>
                    <option value="manned">Manned</option>
                  </select>
                </div>
              )
            } else {
              return (
                <div key={field} className="form-group">
                  <label>{field.replace(/([A-Z])/g, ' $1').trim()}</label>
                  <input
                    type="text"
                    value={params[field] || ''}
                    onChange={(e) => handleParamChange(field, e.target.value)}
                    required
                  />
                </div>
              )
            }
          })}

        <button type="submit" disabled={loading}>
          {loading ? 'Executing...' : 'Execute Command'}
        </button>
      </form>
    </div>
  )
}

export default CommandForm
