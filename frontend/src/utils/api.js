const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

export const api = {
  async request(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  },

  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' })
  },

  async post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    })
  },

  async put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  }
}
