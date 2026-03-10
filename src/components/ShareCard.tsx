import React from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import { motion } from 'framer-motion';

interface ShareCardProps {
  entityCount: number;
  visible: boolean;
}

export const ShareCard: React.FC<ShareCardProps> = ({ entityCount, visible }) => {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md mx-auto"
    >
      <div
        className="rounded-2xl p-8 text-center"
        style={{
          background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--success-soft)' }}
        >
          <ShieldCheck size={28} style={{ color: 'var(--success)' }} />
        </div>

        <h3
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
        >
          Redacted {entityCount} PII {entityCount === 1 ? 'entity' : 'entities'}
        </h3>

        <div
          className="flex items-center justify-center gap-2 text-sm mb-4"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <Lock size={14} />
          Zero bytes uploaded
        </div>

        <p className="text-xs" style={{ color: 'var(--ink-tertiary)' }}>
          Powered by LocalRedact - your document never leaves your browser
        </p>
      </div>
    </motion.div>
  );
};
