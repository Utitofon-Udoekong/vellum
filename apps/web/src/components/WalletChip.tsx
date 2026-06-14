import { truncateAddress } from "../wallet";

interface WalletChipProps {
  label: string;
  address: string | null;
  freighterActive?: string | null;
  expectedAddress?: string;
  connecting: boolean;
  available: boolean | null;
  onConnect: (switchTo?: string) => void;
  onDisconnect: () => void;
}

function connectLabel(
  connecting: boolean,
  available: boolean | null,
  freighterActive: string | null | undefined,
  expectedAddress: string | undefined,
): string {
  if (available === false) return "No Freighter";
  if (connecting) return "…";
  if (expectedAddress && freighterActive && freighterActive !== expectedAddress) {
    return "Switch account";
  }
  return "Open Freighter";
}

export function WalletChip({
  label,
  address,
  freighterActive,
  expectedAddress,
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
          <button type="button" className="chip__disconnect" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          className="chip__connect"
          onClick={() => {
            const switching =
              expectedAddress && freighterActive && freighterActive !== expectedAddress;
            onConnect(switching ? expectedAddress : undefined);
          }}
          disabled={connecting || available === false}
          title={
            available === false
              ? "Install the Freighter browser extension"
              : expectedAddress && freighterActive && freighterActive !== expectedAddress
                ? "Open Freighter to switch to the required account"
                : "Open Freighter to connect"
          }
        >
          {connectLabel(connecting, available, freighterActive, expectedAddress)}
        </button>
      )}
    </div>
  );
}
