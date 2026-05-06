import type { Bandwidth } from '../../types'

interface Props {
  alloc: Bandwidth
  size?: number
}

export default function Ring({ alloc, size = 96 }: Props) {
  const cats = [
    { id: 'work', v: alloc.work, c: '#1c1d1f' },
    { id: 'personal', v: alloc.personal, c: '#407ff2' },
    { id: 'admin', v: alloc.admin, c: '#8f99a8' },
    { id: 'learning', v: alloc.learning, c: '#d3d8df' },
  ]
  const r = (size - 12) / 2
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r

  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="6" />
      {cats.map(s => {
        const len = (s.v / 100) * C
        const dash = `${len} ${C - len}`
        const off = -acc
        acc += len
        return (
          <circle key={s.id} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.c} strokeWidth="6"
            strokeDasharray={dash} strokeDashoffset={off}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle"
        fontFamily="Newsreader, serif" fontSize="20" fill="#1c1d1f" fontWeight="400">
        6h
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
        fontFamily="Inter, sans-serif" fontSize="10" fill="#8f99a8" letterSpacing="0">
        today
      </text>
    </svg>
  )
}
