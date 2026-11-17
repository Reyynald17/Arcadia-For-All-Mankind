import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import GmPanel from './pages/GmPanel'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // A user row without a session cannot call JWT-protected routes.
    const savedUser = localStorage.getItem('afm_user')
    const savedSession = localStorage.getItem('afm_session')
    if (savedUser && savedSession) {
      setUser(JSON.parse(savedUser))
    } else {
      localStorage.removeItem('afm_user')
      localStorage.removeItem('afm_agency')
    }
    setLoading(false)
  }, [])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={setUser} />} />
      <Route path="/register" element={<Register onRegister={setUser} />} />
      <Route path="/gm" element={<GmPanel />} />
      <Route
        path="/dashboard"
        element={user ? <Dashboard user={user} /> : <Navigate to="/login" />}
      />
      <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} />
    </Routes>
  )
}

export default App
