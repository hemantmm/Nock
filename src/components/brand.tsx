export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-lime" />
      <path
        d="M8.5 22.5V10.5h7.2a4.2 4.2 0 0 1 0 8.4H8.5"
        fill="none"
        stroke="#172006"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="22.5" r="2.1" fill="#172006" />
    </svg>
  );
}
