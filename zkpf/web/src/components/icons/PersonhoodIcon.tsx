interface PersonhoodIconProps {
  className?: string;
  size?: number;
}

export function PersonhoodIcon({ className = '', size = 24 }: PersonhoodIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="8"
        r="4"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M6 21C6 17 8.68629 14 12 14C15.3137 14 18 17 18 21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M2 12L6 8L10 12M14 12L18 8L22 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

