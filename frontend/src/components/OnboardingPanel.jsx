import { useEffect, useState } from 'react'
import AgencyProfileFields from './AgencyProfileFields'
import {
  createProfileFormState,
  serializeProfileForm,
  validateProfileForm,
} from '../lib/agencyProfile'

export default function OnboardingPanel({ agency, apiRequest, onSaved, onLogout }) {
  const [form, setForm] = useState(() => createProfileFormState(agency))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(createProfileFormState(agency))
    setError('')
  }, [agency?.id])

  if (!agency?.id) return null

  const handleSubmit = async (event) => {
    event.preventDefault()
    const validationError = validateProfileForm(form)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = await apiRequest(`/agency/${agency.id}/profile`, {
        method: 'PATCH',
        body: JSON.stringify(serializeProfileForm(form)),
      })
      onSaved(payload.agency)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan profil agensi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-start sm:items-center justify-center p-4 overflow-y-auto custom-scroll"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-lg border border-carbon-border bg-carbon-surface my-auto">
        <div className="flex items-center justify-between gap-2 border-b border-carbon-border bg-carbon-container px-4 py-2.5">
          <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-neutral-100">
            Onboarding // Profil Agensi
          </span>
          <span className="text-[9px] uppercase tracking-widest text-flight-amber">
            Wajib sebelum operasi
          </span>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <h2 id="onboarding-title" className="font-headline text-sm font-bold uppercase tracking-widest text-neutral-100">
              Tentukan identitas misi
            </h2>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Pilih alignment dan launch site agensi. Alignment menjadi bloc diplomasi dan
              terkunci setelah profil disimpan.
            </p>
          </div>

          {error && (
            <div className="border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-[10px] uppercase tracking-wider text-alert-red">
              &gt; {error}
            </div>
          )}

          <AgencyProfileFields form={form} onChange={setForm} disabled={saving} />

          <div className="flex items-center justify-end gap-2 border-t border-carbon-border pt-3">
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 hover:border-carbon-border-light bezier-fast"
              >
                Logout
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="bg-flight-amber hover:bg-flight-amber-dim disabled:opacity-60 disabled:cursor-not-allowed px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
            >
              {saving ? 'Menyimpan...' : 'Kunci Profil // Mulai Operasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
