import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function EquityCurveChart({
  data,
}: {
  data: { date: string; cumulative: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-cream/40">
        Pas encore assez de trades clôturés pour tracer une courbe.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B7FE8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8B7FE8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#F0EDE4" strokeOpacity={0.05} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#9AA0C0', fontSize: 11 }}
            axisLine={{ stroke: '#F0EDE4', strokeOpacity: 0.1 }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: '#9AA0C0', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={70}
            tickFormatter={(value: number) => value.toFixed(0)}
          />
          <Tooltip
            contentStyle={{
              background: '#1E2347',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              color: '#F0EDE4',
            }}
            formatter={(value) => [Number(value).toFixed(2), 'PnL cumulé']}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="#4A5FD9"
            strokeWidth={2}
            fill="url(#equityFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
