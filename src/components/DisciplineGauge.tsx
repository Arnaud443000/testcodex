const SIZE = 160;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function toneFor(score: number): string {
  if (score >= 75) return '#6FA88A';
  if (score >= 50) return '#8B7FE8';
  return '#D96659';
}

export function DisciplineGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = toneFor(clamped);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={SIZE} height={SIZE} role="img" aria-label={`Score de discipline ${clamped.toFixed(0)} sur 100`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="rgba(240,237,228,0.08)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#F0EDE4"
          fontSize="34"
          fontWeight="600"
        >
          {clamped.toFixed(0)}
        </text>
        <text
          x="50%"
          y="64%"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#9AA0C0"
          fontSize="12"
        >
          / 100
        </text>
      </svg>
    </div>
  );
}
