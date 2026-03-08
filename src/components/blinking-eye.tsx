export function BlinkingEye({ className = "w-5 h-3" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center shrink-0 ${className}`}>
      <svg viewBox="0 0 32 21" fill="none" className="w-full h-full">
        <style>{`
          @keyframes blink {
            0%, 85%, 100% { transform: scaleY(1); }
            90% { transform: scaleY(0.05); }
          }
          .eye-blink { animation: blink 3s ease-in-out infinite; transform-origin: center; }
        `}</style>
        <g className="eye-blink">
          <path
            d="M16 2C17.242 2.93147 18.25 4.13931 18.944 5.52786C19.639 6.91642 20 8.44755 20 10C20 11.5525 19.639 13.0836 18.944 14.4721C18.25 15.8607 17.242 17.0685 16 18C14.758 17.0685 13.75 15.8607 13.056 14.4721C12.361 13.0836 12 11.5525 12 10C12 8.44755 12.361 6.91642 13.056 5.52786C13.75 4.13931 14.758 2.93147 16 2Z"
            fill="var(--primary)"
          />
          <circle cx="10" cy="10" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <circle cx="22" cy="10" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <circle cx="16" cy="10" r="2.5" fill="var(--background)" />
        </g>
      </svg>
    </span>
  );
}
