import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function useAuth(){
  const [user, setUser] = useState(null)

  useEffect(()=>{
    // get initial session user
    (async ()=>{
      try {
        const { data } = await supabase.auth.getUser()
        setUser(data?.user ?? null)
      } catch (err) {
        console.warn('getUser error', err)
      }
    })()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    setUser(data.user)
    return data
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    setUser(data.user)
    return data
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, signUp, signIn, signOut }
}
