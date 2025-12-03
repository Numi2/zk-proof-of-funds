import { useNetwork } from "./context/NetworkContext";

function TestnetIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M12 6V12M12 16H12.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function MainnetIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function NetworkToggle() {
  const { network, setNetwork, isMainnet } = useNetwork();

  const handleToggle = () => {
    const newNetwork = isMainnet ? "testnet" : "mainnet";
    if (confirm(`Switch to ${newNetwork}? This will reload the page.`)) {
      setNetwork(newNetwork);
    }
  };

  return (
    <button
      className="network-toggle"
      onClick={handleToggle}
      aria-label={`Switch to ${isMainnet ? "testnet" : "mainnet"}`}
      title={`Current: ${network}. Click to switch to ${isMainnet ? "testnet" : "mainnet"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: "6px",
        background: "var(--bg-tertiary, rgba(15, 23, 42, 0.5))",
        color: "var(--text-primary, #e2e8f0)",
        cursor: "pointer",
        fontSize: "0.75rem",
        fontWeight: 500,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover, rgba(30, 64, 175, 0.85))";
        e.currentTarget.style.borderColor = "var(--border-hover, rgba(129, 140, 248, 0.6))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-tertiary, rgba(15, 23, 42, 0.5))";
        e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.2)";
      }}
    >
      {isMainnet ? <MainnetIcon size={16} /> : <TestnetIcon size={16} />}
      <span>{network.toUpperCase()}</span>
    </button>
  );
}

