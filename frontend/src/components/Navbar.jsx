// frontend/src/components/Navbar.jsx
import React from 'react'
import { Link } from 'react-router-dom'

export default function Navbar(){
  return (
    <nav style={{ padding: 12, display: 'flex', gap: 12 }}>
      <Link to="/">Home</Link>
      <Link to="/login">Login</Link>
      <Link to="/register">Register</Link>
    </nav>
  )
}
