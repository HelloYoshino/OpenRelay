export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M8 20.5c2.2-5.6 5-8.5 8-8.5s5.8 2.9 8 8.5"
        fill="none"
        stroke="var(--accent-contrast)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="21" r="2.6" fill="var(--accent-contrast)" />
    </svg>
  );
}
