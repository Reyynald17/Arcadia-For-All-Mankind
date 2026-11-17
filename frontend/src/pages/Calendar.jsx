import { useCallback, useEffect, useMemo, useState } from 'react'

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAY_MS = 86400000

const pad = (value) => String(value).padStart(2, '0')

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function formatDate(date, withWeekday = false) {
  const weekday = `${WEEKDAYS[date.getUTCDay()]} `
  return `${withWeekday ? weekday : ''}${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function formatClock(date) {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}D ${pad(hours)}H ${pad(minutes)}M`
  return `${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`
}

function StatCell({ label, value, hint, accent = false }) {
  return (
    <div className="bg-carbon-surface px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-widest text-neutral-400">{label}</div>
      <div className={`mt-1 text-sm font-bold tabular-nums ${accent ? 'text-flight-amber' : 'text-neutral-100'}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[9px] text-neutral-400 leading-snug">{hint}</div> : null}
    </div>
  )
}

export default function Calendar({ apiRequest }) {
  const [data, setData] = useState(null)
  const [syncedAt, setSyncedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nowTick, setNowTick] = useState(Date.now())

  const loadCalendar = useCallback(async () => {
    try {
      const payload = await apiRequest('/calendar')
      setData(payload)
      setSyncedAt(Date.now())
      setError('')
    } catch (err) {
      setError(err.message || 'Calendar feed unavailable')
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    loadCalendar()
    const timer = setInterval(loadCalendar, 60000)
    return () => clearInterval(timer)
  }, [loadCalendar])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const live = useMemo(() => {
    if (!data) return null
    const realNow = new Date(nowTick)
    const baseGame = Date.parse(data.gameNow)
    const multiplier = Number(data.season?.time_scale_multiplier) || data.conversion?.gameDaysPerRealDay || 52.142857
    const elapsed = syncedAt ? nowTick - syncedAt : 0
    const gameNow = new Date((Number.isFinite(baseGame) ? baseGame : nowTick) + elapsed * multiplier)

    const yearStart = Date.parse(data.conversion?.acdYearStartRealAt)
    const yearEnd = Date.parse(data.conversion?.acdYearEndRealAt)
    const span = yearEnd - yearStart
    const progress = Number.isFinite(span) && span > 0
      ? Math.min(1, Math.max(0, (nowTick - yearStart) / span))
      : 0
    const remainingMs = Number.isFinite(yearEnd) ? Math.max(0, yearEnd - nowTick) : 0

    return { realNow, gameNow, multiplier, progress, remainingMs, yearStart, yearEnd }
  }, [data, nowTick, syncedAt])

  if (loading && !data) {
    return (
      <div className="border border-carbon-border bg-carbon-surface px-4 py-6 text-center text-[10px] uppercase tracking-widest text-neutral-400">
        // Sinkronisasi kalender ACD<span className="afm-cursor ml-2" />
      </div>
    )
  }

  if (!data || !live) {
    return (
      <div className="border border-alert-red/40 bg-alert-red/10 px-4 py-3 text-[11px] text-alert-red">
        Calendar feed gagal dimuat: {error || 'UNKNOWN'}
      </div>
    )
  }

  const game = live.gameNow
  const acdYear = game.getUTCFullYear()
  const acdMonth = game.getUTCMonth()
  const monthDays = daysInMonth(acdYear, acdMonth)
  const firstWeekday = new Date(Date.UTC(acdYear, acdMonth, 1)).getUTCDay()
  const todayDate = game.getUTCDate()
  const conversion = data.conversion || {}
  const realDaysPerGameYear = Number(conversion.realDaysPerGameYear) || 7
  const realDaysPerGameMonth = realDaysPerGameYear / 12
  const realHoursPerGameMonth = realDaysPerGameMonth * 24
  const gameDaysPerRealHour = live.multiplier / 24
  const yearProgressPercent = Math.round(live.progress * 100)

  const cells = []
  for (let index = 0; index < firstWeekday; index += 1) cells.push(null)
  for (let day = 1; day <= monthDays; day += 1) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-headline text-sm font-bold uppercase tracking-widest text-neutral-100">
            ACD Calendar // Temporal Sync
          </h1>
          <p className="text-[10px] text-neutral-400 mt-1">
            Perbandingan waktu nyata dengan kalender ACD. Skala aktif 1 minggu real life = 1 tahun ACD.
          </p>
        </div>
        <button
          type="button"
          onClick={loadCalendar}
          className="border border-carbon-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-300 hover:text-flight-amber hover:border-flight-amber/50 bezier-fast flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">sync</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-[10px] uppercase tracking-wider text-alert-red">
          Feed stale: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-carbon-border border border-carbon-border">
        <section className="bg-carbon-surface">
          <div className="flex items-center justify-between border-b border-carbon-border px-3 py-2">
            <span className="flex items-center gap-1.5 font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-200">
              <span className="material-symbols-outlined text-sm text-neutral-400">public</span>
              Real Life // UTC
            </span>
            <span className="text-[9px] uppercase tracking-widest text-neutral-400">now</span>
          </div>
          <div className="p-3">
            <div className="text-2xl font-bold tabular-nums text-neutral-100">
              {formatDate(live.realNow, true)}
            </div>
            <div className="mt-1 text-xs tabular-nums text-neutral-400">
              {formatClock(live.realNow)} UTC
            </div>
            <div className="mt-3 text-[10px] text-neutral-400 leading-relaxed">
              Kalender nyata berjalan 1 hari per 24 jam. Satu minggu real life memetakan satu tahun
              penuh di kalender ACD.
            </div>
          </div>
        </section>

        <section className="bg-carbon-surface">
          <div className="flex items-center justify-between border-b border-carbon-border px-3 py-2">
            <span className="flex items-center gap-1.5 font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-200">
              <span className="material-symbols-outlined text-sm text-flight-amber">calendar_month</span>
              ACD Calendar // Game
            </span>
            <span className="text-[9px] uppercase tracking-widest text-flight-amber">
              {live.multiplier.toFixed(2)}x
            </span>
          </div>
          <div className="p-3">
            <div className="text-2xl font-bold tabular-nums text-flight-amber">
              {formatDate(game, true)}
            </div>
            <div className="mt-1 text-xs tabular-nums text-neutral-400">
              {formatClock(game)} ACD // Tahun {acdYear}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="border border-flight-amber/40 bg-flight-amber/10 px-2 py-1 text-[9px] uppercase tracking-wider text-flight-amber">
                1 minggu real = 1 tahun ACD
              </span>
              <span className="text-[9px] text-neutral-400">
                1 hari real = {live.multiplier.toFixed(2)} hari ACD
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-carbon-border border border-carbon-border">
        <StatCell
          label="1 hari real"
          value={`${live.multiplier.toFixed(2)} hari ACD`}
          hint={`${gameDaysPerRealHour.toFixed(2)} hari ACD per jam real`}
        />
        <StatCell
          label="1 minggu real"
          value="1 tahun ACD"
          hint={`${Number(conversion.gameDaysPerRealWeek || 365).toFixed(1)} hari ACD`}
          accent
        />
        <StatCell
          label="1 bulan ACD"
          value={`≈ ${realHoursPerGameMonth.toFixed(1)} jam real`}
          hint={`${realDaysPerGameMonth.toFixed(2)} hari real`}
        />
        <StatCell
          label="1 tahun ACD"
          value={`≈ ${realDaysPerGameYear.toFixed(2)} hari real`}
          hint={`${(conversion.acdYearRealDays || 7).toFixed(2)} hari real tahun ini`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-px bg-carbon-border border border-carbon-border">
        <section className="lg:col-span-7 bg-carbon-surface">
          <div className="flex items-center justify-between border-b border-carbon-border px-3 py-2">
            <h2 className="font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-200">
              {MONTHS[acdMonth]} {acdYear} // ACD Month Grid
            </h2>
            <span className="text-[9px] uppercase tracking-widest text-neutral-400">
              Tahun {acdYear}
            </span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-7 gap-px bg-carbon-border border border-carbon-border text-center">
              {WEEKDAYS.map((day) => (
                <div key={day} className="bg-carbon-container py-1 text-[8px] uppercase tracking-widest text-neutral-400">
                  {day}
                </div>
              ))}
              {cells.map((day, index) => (
                <div
                  key={`cell-${index}`}
                  className={`aspect-square flex items-center justify-center text-[10px] tabular-nums ${
                    day === todayDate
                      ? 'bg-flight-amber text-black font-bold'
                      : day
                        ? 'bg-carbon-surface text-neutral-300'
                        : 'bg-carbon-bg text-transparent'
                  }`}
                >
                  {day || '·'}
                </div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-neutral-400">
              Tanggal ACD bergerak ±{live.multiplier.toFixed(2)} hari per hari real, jadi satu bulan
              ACD selesai dalam beberapa jam real.
            </div>
          </div>
        </section>

        <aside className="lg:col-span-5 bg-carbon-surface flex flex-col">
          <div className="flex items-center justify-between border-b border-carbon-border px-3 py-2">
            <h2 className="font-headline text-[10px] font-bold uppercase tracking-widest text-neutral-200">
              ACD Year {acdYear} // Progress
            </h2>
            <span className="text-[10px] tabular-nums text-flight-amber">{yearProgressPercent}%</span>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <div className="h-2 bg-carbon-bg">
                <div
                  className="h-full bg-flight-amber transition-all duration-500"
                  style={{ width: `${Math.max(1, yearProgressPercent)}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[9px] text-neutral-400">
                <span>{formatDate(new Date(live.yearStart))}</span>
                <span>{formatDate(new Date(live.yearEnd))}</span>
              </div>
            </div>

            <div className="divide-y divide-carbon-border border border-carbon-border">
              <div className="flex items-center justify-between px-2.5 py-2 text-[10px]">
                <span className="uppercase tracking-wide text-neutral-400">Sisa tahun ACD</span>
                <span className="tabular-nums text-neutral-100">{formatDuration(live.remainingMs)} real</span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-2 text-[10px]">
                <span className="uppercase tracking-wide text-neutral-400">Total tahun ACD</span>
                <span className="tabular-nums text-neutral-100">
                  {(conversion.acdYearRealDays || 7).toFixed(2)} hari real
                </span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-2 text-[10px]">
                <span className="uppercase tracking-wide text-neutral-400">Season</span>
                <span className="tabular-nums text-neutral-100 text-right truncate max-w-[60%]">
                  {data.season?.name || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-2 text-[10px]">
                <span className="uppercase tracking-wide text-neutral-400">Epoch</span>
                <span className="tabular-nums text-neutral-100">{data.season?.epoch_game_date || '—'}</span>
              </div>
            </div>

            <p className="text-[9px] leading-relaxed text-neutral-400">
              Kalender mengikuti season aktif dan multiplier waktu server. Tahun kabisat ACD tetap
              dihitung, sehingga durasi tahun real bisa sedikit di atas 7 hari.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
