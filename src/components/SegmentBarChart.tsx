import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function SegmentBarChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-cream/40">
        Pas encore de données.
      </div>
    );
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: '#9AA0C0', fontSize: 11 }}
            axisLine={{ stroke: '#F0EDE4', strokeOpacity: 0.1 }}
            tickLine={false}
            interval={0}
            angle={data.length > 6 ? -30 : 0}
            textAnchor={data.length > 6 ? 'end' : 'middle'}
            height={data.length > 6 ? 50 : 30}
          />
          <YAxis
            tick={{ fill: '#9AA0C0', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            contentStyle={{
              background: '#1E2347',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#F0EDE4',
            }}
            formatter={(value) => [Number(value).toFixed(2), 'PnL']}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.value >= 0 ? '#6FA88A' : '#D96659'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
