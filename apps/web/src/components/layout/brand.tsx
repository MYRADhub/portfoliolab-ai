/** The PortfolioLab mark: three bars of different heights in a rounded square, echoing a portfolio of different risks. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <rect
        x="7"
        y="15"
        width="4.5"
        height="10"
        rx="1.5"
        fill="var(--primary-foreground)"
        opacity="0.7"
      />
      <rect x="13.75" y="9" width="4.5" height="16" rx="1.5" fill="var(--primary-foreground)" />
      <rect
        x="20.5"
        y="12"
        width="4.5"
        height="13"
        rx="1.5"
        fill="var(--primary-foreground)"
        opacity="0.85"
      />
    </svg>
  );
}
