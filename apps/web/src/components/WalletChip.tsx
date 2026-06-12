import { truncateAddress } from "../wallet";

interface WalletChipProps {
  label: string;
  address: string | null;
  connecting: boolean;
  available: boolean | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WalletChip({
  label,
  address,
  connecting,
  available,
  onConnect,
  onDisconnect,
}: WalletChipProps) {
  return (
    <div className={`chip ${address ? "chip--on" : ""}`}>
      <span className="chip__label">{label}</span>
      {address ? (
        <>
          <span className="chip__addr">{truncateAddress(address, 5)}</span>
          <button type="button" className="chip__action" onClick={onDisconnect}>
            ×
          </button>
        </>
      ) : (
        <button
          type="button"
          className="chip__connect"
          onClick={onConnect}
          disabled={connecting || available === false}
        >
          {connecting ? "…" : "Connect"}
        </button>
      )}
    </div>
  );
}
