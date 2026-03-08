export function BlinkingEye({ className = "w-5 h-3" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center shrink-0 ${className}`}>
      <svg viewBox="0 0 24 14" fill="none" className="w-full h-full">
        <style>{`
          @keyframes eyeBlink {
            0%, 80%, 100% { transform: scaleY(1); }
            85% { transform: scaleY(0.05); }
            90% { transform: scaleY(1); }
            95% { transform: scaleY(0.05); }
          }
          @keyframes irisShift {
            0%, 80% { fill: var(--primary); }
            85% { fill: white; }
            90% { fill: var(--primary); }
            95% { fill: #111; }
            100% { fill: var(--primary); }
          }
          @keyframes pupilShift {
            0%, 80% { fill: var(--background); }
            85% { fill: #111; }
            90% { fill: var(--background); }
            95% { fill: white; }
            100% { fill: var(--background); }
          }
          .eye-group { animation: eyeBlink 4s ease-in-out infinite; transform-origin: center; }
          .iris { animation: irisShift 4s ease-in-out infinite; }
          .pupil { animation: pupilShift 4s ease-in-out infinite; }
        `}</style>
        <g className="eye-group">
          <path
            d="M12 1C6 1 1 7 1 7s5 6 11 6 11-6 11-6-5-6-11-6Z"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <circle cx="12" cy="7" r="4" className="iris" />
          <circle cx="12" cy="7" r="1.5" className="pupil" />
        </g>
      </svg>
    </span>
  );
}
