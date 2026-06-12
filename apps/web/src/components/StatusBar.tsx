interface StatusBarProps {
  message: string;
  busy: boolean;
}

export function StatusBar({ message, busy }: StatusBarProps) {
  const lastLine = message.trim().split("\n").pop() ?? "";

  return (
    <footer className="status">
      {busy && <span className="status__pulse" aria-hidden />}
      <span className="status__text">{busy ? "Processing…" : lastLine}</span>
    </footer>
  );
}
