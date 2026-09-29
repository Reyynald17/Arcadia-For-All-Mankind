function StatsCard({ label, value, max, icon }) {
  const percentage = max ? (value / max) * 100 : 0
  const status = value >= 70 ? 'good' : value >= 40 ? 'normal' : 'critical'

  return (
    <div className={`stats-card stats-${status}`}>
      <div className="stats-icon">{icon}</div>
      <div className="stats-body">
        <label>{label}</label>
        <div className="stats-value">
          {value}
          {max && `/${max}`}
        </div>
        {max && (
          <div className="stats-bar">
            <div className="stats-fill" style={{ width: `${percentage}%` }}></div>
          </div>
        )}
      </div>
    </div>
  )
}

export default StatsCard
