import { useRef } from "react";
import {
  BATCH_MAX,
  newBatchRow,
  parsePayrollCsv,
  sumHumanAmounts,
  validatePayeeAddress,
  type BatchRow,
} from "../payroll";
import { formatTokenAmount, tryParseHumanAmount } from "../token-amount";

interface BatchEditorProps {
  rows: BatchRow[];
  manualTotal: boolean;
  totalOverride: string;
  tokenDecimals: number;
  tokenSymbol: string;
  onRowsChange: (rows: BatchRow[]) => void;
  onManualTotalChange: (manual: boolean) => void;
  onTotalOverrideChange: (total: string) => void;
}

export function BatchEditor({
  rows,
  manualTotal,
  totalOverride,
  tokenDecimals,
  tokenSymbol,
  onRowsChange,
  onManualTotalChange,
  onTotalOverrideChange,
}: BatchEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const autoTotalStroops = sumHumanAmounts(rows, tokenDecimals);
  const autoTotalLabel = formatTokenAmount(autoTotalStroops, tokenDecimals);
  const manualStroops = tryParseHumanAmount(totalOverride, tokenDecimals);
  const totalMismatch =
    manualTotal && totalOverride.trim() !== "" && manualStroops !== null && manualStroops !== autoTotalStroops;

  const updateRow = (id: string, patch: Partial<BatchRow>) => {
    onRowsChange(
      rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.payeeAddress !== undefined) {
          next.error = validatePayeeAddress(patch.payeeAddress);
        }
        return next;
      }),
    );
  };

  const addRow = () => {
    if (rows.length >= BATCH_MAX) return;
    onRowsChange([...rows, newBatchRow()]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 1) return;
    onRowsChange(rows.filter((r) => r.id !== id));
  };

  const onCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parsePayrollCsv(String(reader.result ?? ""));
      if (!parsed.length) return;
      onRowsChange(
        parsed.map((r) => ({
          ...r,
          error: validatePayeeAddress(r.payeeAddress),
        })),
      );
    };
    reader.readAsText(file);
  };

  return (
    <div className="batch">
      <div className="batch__toolbar">
        <button type="button" className="btn-text" onClick={addRow} disabled={rows.length >= BATCH_MAX}>
          + Add
        </button>
        <button type="button" className="btn-text" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCsv(f);
            e.target.value = "";
          }}
        />
        <span className="batch__count">
          {rows.length}/{BATCH_MAX}
        </span>
      </div>

      <div className="batch__table">
        <div className="batch__head">
          <span>Address</span>
          <span>Amount ({tokenSymbol})</span>
          <span />
        </div>
        {rows.map((row) => (
          <div key={row.id} className={`batch__row ${row.error ? "batch__row--error" : ""}`}>
            <input
              value={row.payeeAddress}
              onChange={(e) => updateRow(row.id, { payeeAddress: e.target.value.trim() })}
              placeholder="G…"
              spellCheck={false}
            />
            <input
              value={row.amount}
              onChange={(e) => updateRow(row.id, { amount: e.target.value })}
              placeholder="0"
              inputMode="decimal"
            />
            <button type="button" className="batch__remove" onClick={() => removeRow(row.id)} aria-label="Remove">
              ×
            </button>
            {row.error && <span className="batch__error">{row.error}</span>}
          </div>
        ))}
      </div>

      <div className="batch__total">
        <label className="batch__total-toggle">
          <input
            type="checkbox"
            checked={manualTotal}
            onChange={(e) => onManualTotalChange(e.target.checked)}
          />
          Manual total
        </label>
        {manualTotal ? (
          <input
            className={`batch__total-manual ${totalMismatch ? "batch__total-input--warn" : ""}`}
            value={totalOverride}
            onChange={(e) => onTotalOverrideChange(e.target.value)}
            inputMode="decimal"
            placeholder={autoTotalLabel}
          />
        ) : (
          <output className="batch__total-value">
            {autoTotalLabel} {tokenSymbol}
          </output>
        )}
        {totalMismatch && (
          <span className="batch__error">
            Must equal sum of rows ({autoTotalLabel} {tokenSymbol})
          </span>
        )}
      </div>
    </div>
  );
}
