interface P2PIconProps {
  className?: string;
  size?: number;
}

export function P2PIcon({ className = '', size = 24 }: P2PIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 12C8 10.8954 8.89543 10 10 10C11.1046 10 12 10.8954 12 12C12 13.1046 11.1046 14 10 14C8.89543 14 8 13.1046 8 12Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M12 12C12 10.8954 12.8954 10 14 10C15.1046 10 16 10.8954 16 12C16 13.1046 15.1046 14 14 14C12.8954 14 12 13.1046 12 12Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M4 8L8 12L4 16M20 8L16 12L20 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

