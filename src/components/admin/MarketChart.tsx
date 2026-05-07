import React from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface MarketChartProps {
  zonesData: { name: string; demand: number; risk: number }[];
}

export default function MarketChart({ zonesData }: MarketChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={zonesData}>
        <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} tick={{ fontWeight: '900', fill: '#94a3b8' }} />
        <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: '10px' }} />
        <Bar dataKey="demand" radius={[10, 10, 10, 10]} barSize={24}>
          {zonesData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.risk > 15 ? '#ef4444' : '#4f46e5'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
