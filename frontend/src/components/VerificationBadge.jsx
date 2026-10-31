const STYLE = {
  pending: { cls: 'border-warning/50 bg-warning/10 text-warning', text: 'Verifying with live data…', spin: true },
  verified: { cls: 'border-ok/50 bg-ok/10 text-ok', text: 'Fix verified ✓' },
  failed: { cls: 'border-critical/50 bg-critical/10 text-critical', text: 'Still abnormal, reopened' },
}

// Shows the result of the data-based fix check. "none" shows nothing.
export default function VerificationBadge({ verification }) {
  const s = STYLE[verification]
  if (!s) return null
  return (
    <span className={`verify-pop inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.spin && <span className="h-3 w-3 animate-spin rounded-full border-2 border-warning border-t-transparent" />}
      {s.text}
    </span>
  )
}
