/** Het MLC-beeldmerk: één doorlopende lijn, vierkante uiteinden, ronde bochten. */
export function Beeldmerk({ className = "", color = "currentColor", strokeWidth = 19 }: { className?: string; color?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="102.5 120 263 146" className={className} aria-hidden="true">
      <path
        d="M122.9,234.5l38.5-94.7c1.2-2.9,6.7-3.1,8.1-.4l33.2,62.4c.4.7,1.6.8,2.2.2l58.6-60.6c1.5-1.5,4.8-.9,4.9,1l3.8,105.3c0,.7,1.1,1,1.8.5l70.3-45.8"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="round"
        strokeMiterlimit={10}
      />
    </svg>
  );
}

/** Paginakop met de lijn als ankerpunt. */
export function PageHeader({ eyebrow, title, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="h1">{title}</h1>
        </div>
        {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
      </div>
      <div className="rule" />
    </header>
  );
}

/** Sectiekop: titel met een dunne lijn ernaast. */
export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-4">
      <h2 className="h2 shrink-0">{children}</h2>
      <div className="h-px flex-1 bg-lijn" />
      {aside}
    </div>
  );
}
