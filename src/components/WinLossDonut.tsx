import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS: Record<string, string> = {
  Gagnants: '#6FA88A',
  Perdants: '#D96659',
  Breakeven: '#9AA0C0',
};

export function WinLossDonut({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-cream/40">
        Pas encore de trade clôturé.
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="relative h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="65%"
            outerRadius="100%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={COLORS[entry.name] ?? '#8B7FE8'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#1E2347',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#F0EDE4',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-cream">{total}</span>
        <span className="text-xs text-cream/50">trades</span>
      </div>
    </div>
  );
}
