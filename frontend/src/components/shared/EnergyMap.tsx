import { useMemo } from 'react'

export default function EnergyMap() {
  const buckets = useMemo(() => {
    const arr: { h: number; v: number; errors: boolean }[] = []
    for (let i = 0; i < 90; i++) {
      const h = 7 + i / 6
      let v: number
      if (h < 8.5) v = 25 + Math.random() * 15
      else if (h < 11.5) v = 70 + Math.random() * 22
      else if (h < 12.5) v = 45 + Math.random() * 20
      else if (h < 13.5) v = 8 + Math.random() * 8
      else if (h < 14.5) v = 30 + Math.random() * 15
      else if (h < 15.5) v = 55 + Math.random() * 20
      else if (h < 16.5) v = 65 + Math.random() * 15
      else if (h < 18) v = 50 + Math.random() * 15
      else v = 18 + Math.random() * 12
      const errors = (h >= 14.5 && h < 15.5) || (h >= 17 && h < 18)
      arr.push({ h, v, errors })
    }
    return arr
  }, [])

  const w = 100 / buckets.length
  const hours = [7, 9, 11, 13, 15, 17, 19, 21]

  return (
    <div className="em">
      <div className="em-area">
        <div className="em-region" style={{ left: `${((13 - 7) / 15) * 100}%`, width: `${(1 / 15) * 100}%` }}>
          <span className="em-region-label">lunch · black hole</span>
        </div>
        <div className="em-region" style={{ left: `${((14.5 - 7) / 15) * 100}%`, width: `${(1 / 15) * 100}%` }}>
          <span className="em-region-label">thrashing</span>
        </div>
        <div className="em-region" style={{ left: `${((16.5 - 7) / 15) * 100}%`, width: `${(1.5 / 15) * 100}%` }}>
          <span className="em-region-label">past cutoff</span>
        </div>
        {buckets.map((b, i) => (
          <span
            key={i}
            className={`em-bar ${b.v > 65 ? 'peak' : b.errors ? 'warn' : ''}`}
            style={{ left: `${i * w + w / 2}%`, height: `${(b.v / 100) * 100}%` }}
          />
        ))}
        <span className="em-now" style={{ left: `${((14.6 - 7) / 15) * 100}%` }} />
      </div>
      <div className="em-x">
        {hours.map(h => (
          <span key={h} style={{ left: `${((h - 7) / 15) * 100}%` }}>
            {h.toString().padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  )
}
