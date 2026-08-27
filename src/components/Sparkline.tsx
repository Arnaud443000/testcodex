import { Line, LineChart, ResponsiveContainer } from 'recharts';

const COLORS = {
  success: '#6FA88A',
  danger: '#D96659',
  accent: '#8B7FE8',
};

export function Sparkline({
  data,
  tone = 'accent',
}: {
  data: number[];
  tone?: keyof typeof COLORS;
}) {
  if (data.length < 2) {
    return <div className="h-10" />;
  }

  const points = data.map((value, index) => ({ index, value }));

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={COLORS[tone]}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
