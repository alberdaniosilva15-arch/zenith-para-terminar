import React from 'react';

interface FullPageSpinnerProps {
  label?: string;
}

export default function FullPageSpinner({ label = 'A carregar...' }: FullPageSpinnerProps) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background gap-3">
      <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
