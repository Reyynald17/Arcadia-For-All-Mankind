import { useEffect, useState } from 'react'

const STEPS = [
  {
    id: 'hangar',
    icon: 'precision_manufacturing',
    title: 'Rakit wahana pertama',
    body: 'Buka Hangar lalu rakit sounding rocket. Biayanya sekitar $500K dan selesai dalam 30 hari game; setelah selesai vehicle masuk status testing dan siap diluncurkan.',
    action: { label: 'Buka Hangar', view: 'engineering', tab: 'hangar' },
  },
  {
    id: 'flight',
    icon: 'rocket_launch',
    title: 'Jalankan misi uji',
    body: 'Di Flight Deck tekan Autorisasi Luncur. Rollout memakan 45-60 hari game lalu countdown 1 hari. Skor AGM menentukan hasil; reliabilitas vehicle yang tinggi menambah peluang sukses.',
    action: { label: 'Buka Flight', view: 'flight' },
  },
  {
    id: 'tracking',
    icon: 'satellite_alt',
    title: 'Pantau orbit',
    body: 'Tracking menampilkan posisi misi aktif di 2D Map dan 3D Globe. Gunakan toggle tampilan, lalu pan, tilt, atau zoom untuk memeriksa orbit.',
    action: { label: 'Buka Tracking', view: 'tracking' },
  },
  {
    id: 'research',
    icon: 'science',
    title: 'Buka teknologi baru',
    body: 'R&D memakai science points dan funding. Setiap riset butuh 70-300 hari game dan prasyaratnya harus selesai lebih dulu, jadi urutkan node dari akar tech tree.',
    action: { label: 'Buka R&D', view: 'engineering', tab: 'tech' },
  },
  {
    id: 'relations',
    icon: 'handshake',
    title: 'Bangun diplomasi',
    body: 'Di Relations kamu bisa mengirim cooperation agreement untuk menaikkan relasi. Proposal lintas bloc lebih mahal, dan agensi netral punya batas saturasi 25%.',
    action: { label: 'Buka Relations', view: 'relations' },
  },
  {
    id: 'loop',
    icon: 'monitoring',
    title: 'Jaga siklus operasi',
    body: 'Misi sukses menambah RP dan mencatat SLR. Funding hanya berkurang, jadi seimbangkan biaya riset, produksi, dan peluncuran agar agensi tetap berjalan.',
  },
]

function storageKey(agencyId) {
  return `afm_tutorial_v1_${agencyId || 'anon'}`
}

function readTutorialState(agencyId) {
  try {
    const raw = localStorage.getItem(storageKey(agencyId))
    if (!raw) return { confirmed: false, step: 0, done: false }
    const parsed = JSON.parse(raw)
    return {
      confirmed: Boolean(parsed?.confirmed),
      step: Number.isInteger(parsed?.step) ? Math.max(0, Math.min(STEPS.length - 1, parsed.step)) : 0,
      done: Boolean(parsed?.done),
    }
  } catch {
    return { confirmed: false, step: 0, done: false }
  }
}

function writeTutorialState(agencyId, state) {
  try {
    localStorage.setItem(storageKey(agencyId), JSON.stringify(state))
  } catch {
    // Storage can be unavailable in private mode; progress just won't persist.
  }
}

export default function TutorialPanel({ open, onClose, agencyId, onNavigate }) {
  const [phase, setPhase] = useState('confirm')
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!open) return
    const state = readTutorialState(agencyId)
    if (!state.confirmed) {
      setPhase('confirm')
      setStep(0)
      setDone(false)
      return
    }
    setPhase('active')
    setStep(state.step)
    setDone(state.done)
  }, [open, agencyId])

  if (!open) return null

  const start = () => {
    writeTutorialState(agencyId, { confirmed: true, step: 0, done: false })
    setPhase('active')
    setStep(0)
    setDone(false)
  }

  const goToStep = (next) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next))
    writeTutorialState(agencyId, { confirmed: true, step: clamped, done: false })
    setStep(clamped)
    setDone(false)
  }

  const finish = () => {
    writeTutorialState(agencyId, { confirmed: true, step: STEPS.length - 1, done: true })
    setDone(true)
  }

  const restart = () => {
    writeTutorialState(agencyId, { confirmed: true, step: 0, done: false })
    setStep(0)
    setDone(false)
  }

  const current = STEPS[step]
  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <aside
      role="dialog"
      aria-labelledby="tutorial-title"
      className="fixed bottom-4 right-4 z-[90] w-[calc(100%-2rem)] max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto custom-scroll border border-carbon-border bg-carbon-surface shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-carbon-border bg-carbon-container px-3 py-2">
        <span className="flex items-center gap-1.5 font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-100">
          <span className="material-symbols-outlined text-sm text-flight-amber">school</span>
          Tutorial // Panduan Operasi
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup tutorial"
          className="text-neutral-400 hover:text-neutral-100 bezier-fast"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>

      {phase === 'confirm' ? (
        <div className="p-4 space-y-3">
          <h2 id="tutorial-title" className="font-headline text-sm font-bold uppercase tracking-wider text-neutral-100">
            Ikuti tutorial?
          </h2>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            Tutorial akan memandu alur awal: rakit wahana, luncurkan misi, pantau orbit, riset
            teknologi, lalu bangun diplomasi. Panel bisa ditutup kapan saja dan dilanjutkan lagi
            nanti.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 hover:border-carbon-border-light bezier-fast"
            >
              Nanti saja
            </button>
            <button
              type="button"
              onClick={start}
              className="bg-flight-amber hover:bg-flight-amber-dim px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
            >
              Ya, mulai
            </button>
          </div>
        </div>
      ) : done ? (
        <div className="p-4 space-y-3">
          <h2 id="tutorial-title" className="font-headline text-sm font-bold uppercase tracking-wider text-telemetry-green">
            Tutorial selesai
          </h2>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            Alur dasar sudah kamu ketahui. Lanjutkan riset, tingkatkan reliabilitas vehicle, dan
            jaga funding untuk misi berikutnya.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={restart}
              className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 hover:border-carbon-border-light bezier-fast"
            >
              Ulangi
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-flight-amber hover:bg-flight-amber-dim px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
            >
              Tutup
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-neutral-400">
              <span>Langkah {step + 1} / {STEPS.length}</span>
              <span className="text-flight-amber">{Math.round(progress)}%</span>
            </div>
            <div className="h-1 bg-carbon-bg">
              <div className="h-full bg-flight-amber transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <h2 id="tutorial-title" className="flex items-center gap-1.5 font-headline text-sm font-bold uppercase tracking-wider text-neutral-100">
            <span className="material-symbols-outlined text-base text-flight-amber">{current.icon}</span>
            {current.title}
          </h2>
          <p className="text-[11px] leading-relaxed text-neutral-300">{current.body}</p>

          {current.action && (
            <button
              type="button"
              onClick={() => onNavigate?.(current.action.view, current.action.tab)}
              className="w-full border border-flight-amber/50 bg-flight-amber/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-flight-amber hover:bg-flight-amber/20 bezier-fast flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm normal-case">open_in_new</span>
              {current.action.label}
            </button>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-carbon-border pt-3">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
              className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-neutral-100 hover:border-carbon-border-light disabled:opacity-40 disabled:cursor-not-allowed bezier-fast"
            >
              Kembali
            </button>
            {step === STEPS.length - 1 ? (
              <button
                type="button"
                onClick={finish}
                className="bg-flight-amber hover:bg-flight-amber-dim px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
              >
                Selesai
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="bg-flight-amber hover:bg-flight-amber-dim px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black bezier-fast"
              >
                Lanjut
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
