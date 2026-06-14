interface StatusBarProps {
  message: string;
  activity: string;
  busy: boolean;
}

export function StatusBar({ message, activity, busy }: StatusBarProps) {
  const lastLine = message.trim().split("\n").pop() ?? "";
  const text = (busy && activity) || lastLine || (busy ? "Working…" : "");

  return (
    <footer className={`status ${busy ? "status--busy" : ""}`} role="status" aria-live="polite">
      {busy && <span className="status__pulse" aria-hidden />}
      <span className="status__text">{text}</span>
    </footer>
  );
}
