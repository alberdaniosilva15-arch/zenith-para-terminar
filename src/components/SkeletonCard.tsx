import React from 'react';

const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`zr-card zr-card--soft p-4 animate-pulse-gold ${className}`}>
      <div className="flex gap-4 mb-4">
        <div className="w-12 h-12 rounded-full bg-white/5" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 bg-white/5 rounded w-3/4" />
          <div className="h-3 bg-white/5 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-white/5 rounded" />
        <div className="h-3 bg-white/5 rounded w-5/6" />
      </div>
    </div>
  );
};

export default SkeletonCard;
