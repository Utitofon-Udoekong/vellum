import { useEffect, useState } from "react";
import { commitmentFromNote, parseField } from "./commitment";
import { noteToCommitment, simulateIncrementalInserts } from "./merkle";
import { generateProof } from "./proof";
import { loadBatchSumCircuit, loadWithdrawCircuit } from "./circuits";
import { buildBatchSumWitness, buildWithdrawWitness } from "./witness";
import { recipientIdFromAddress, splitPubkeyLimbs } from "./pubkey";
import { DEFAULT_POOL_ID, DEFAULT_TOKEN_ID, DEMO_EMPLOYEE_G, NETWORK_LABEL } from "./demo-config";
import { addressScVal, bytesScVal, i128ScVal, invokeContractWallet } from "./stellar";
import { useFreighter } from "./hooks/useFreighter";
import { WalletChip } from "./components/WalletChip";
import { StatusBar } from "./components/StatusBar";
import { BatchEditor } from "./components/BatchEditor";
import { BATCH_MAX, newBatchRow, sumAmounts, validatePayeeAddress, type BatchRow } from "./payroll";

type Mode = "company" | "employee" | "audit";

interface StoredNote {
  payeeAddress: string;
  pubkeyLo: string;
  pubkeyHi: string;
  recipientId: string;
  amount: string;
  salt: string;
  privKey: string;
  leafIndex: number;
  batchRootHex: string;
  pathSiblings: string[];
  pathBits: string[];
}

export default function App() {
  const company = useFreighter();
  const employee = useFreighter();

  const [mode, setMode] = useState<Mode>("company");
  const [log, setLog] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([
    newBatchRow({ payeeAddress: DEMO_EMPLOYEE_G, amount: "100" }),
  ]);
  const [manualTotal, setManualTotal] = useState(false);
  const [totalOverride, setTotalOverride] = useState("");
  const [poolId, setPoolId] = useState(DEFAULT_POOL_ID);
  const [tokenId, setTokenId] = useState(DEFAULT_TOKEN_ID);
  const [storedNotes, setStoredNotes] = useState<StoredNote[]>([]);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [onChainCommitments, setOnChainCommitments] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(!DEFAULT_POOL_ID || !DEFAULT_TOKEN_ID);

  useEffect(() => {
    const raw = localStorage.getItem("vellum-notes");
    if (!raw) return;
    try {
      const notes = JSON.parse(raw) as StoredNote[];
      setStoredNotes(notes);
      if (notes.length) {
        setBatchRows(
          notes.map((n) => ({
            id: crypto.randomUUID(),
            payeeAddress: n.payeeAddress,
            amount: String(n.amount),
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const append = (msg: string) => setLog((prev) => (prev ? `${prev}\n${msg}` : msg));

  const resolveBatchTotal = (): bigint | null => {
    const auto = sumAmounts(batchRows);
    if (!manualTotal) return auto;
    const trimmed = totalOverride.trim();
    if (!trimmed) return auto;
    try {
      const manual = BigInt(trimmed);
      return manual === auto ? manual : null;
    } catch {
      return null;
    }
  };

  const connectCompany = async () => {
    try {
      append(`Connected · ${await company.connect()}`);
    } catch (e) {
      append(`Connect failed · ${String(e)}`);
    }
  };

  const connectEmployee = async () => {
    try {
      const addr = await employee.connect();
      const note = storedNotes[selectedNoteIdx];
      if (note?.payeeAddress && note.payeeAddress !== addr) {
        append("Wallet does not match selected payee");
        return;
      }
      append(`Connected · ${addr}`);
    } catch (e) {
      append(`Connect failed · ${String(e)}`);
    }
  };

  const distributorPrepare = async () => {
    if (batchRows.length > BATCH_MAX) return append(`Max ${BATCH_MAX} payees`);
    for (const row of batchRows) {
      const err = validatePayeeAddress(row.payeeAddress);
      if (err) return append(`${row.payeeAddress.slice(0, 8)}… · ${err}`);
      if (!row.amount.trim()) return append("Amount required on every row");
    }

    const total = resolveBatchTotal();
    if (total === null) return append("Manual total must equal row sum");

    setBusy(true);
    try {
      const draftNotes = await Promise.all(
        batchRows.map(async (row, i) => {
          const { lo, hi } = splitPubkeyLimbs(row.payeeAddress);
          const recipientId = await recipientIdFromAddress(row.payeeAddress);
          return {
            payeeAddress: row.payeeAddress,
            pubkeyLo: lo,
            pubkeyHi: hi,
            recipientId,
            amount: parseField(row.amount),
            salt: BigInt(42 + i),
            privKey: BigInt(7 + i),
            leafIndex: i,
          };
        }),
      );

      const leaves: Uint8Array[] = [];
      for (const n of draftNotes) {
        leaves.push(await noteToCommitment(n));
      }

      const { root, paths } = await simulateIncrementalInserts(leaves);
      const batchRootHex = Array.from(root)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const notes: StoredNote[] = draftNotes.map((n, i) => ({
        payeeAddress: n.payeeAddress,
        pubkeyLo: n.pubkeyLo.toString(),
        pubkeyHi: n.pubkeyHi.toString(),
        recipientId: n.recipientId.toString(),
        amount: n.amount.toString(),
        salt: n.salt.toString(),
        privKey: n.privKey.toString(),
        leafIndex: i,
        batchRootHex,
        pathSiblings: paths[i].siblings.map((s) => s.toString()),
        pathBits: paths[i].bits.map((b) => b.toString()),
      }));

      const commitments = leaves.map((c) =>
        Array.from(c)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );

      setOnChainCommitments(commitments);
      setStoredNotes(notes);
      localStorage.setItem("vellum-notes", JSON.stringify(notes));
      append(`Prepared · ${notes.length} payees · total ${total}`);
    } finally {
      setBusy(false);
    }
  };

  const distributorDepositAll = async () => {
    if (!poolId || !company.address) return append("Connect company wallet");
    if (!onChainCommitments.length) return append("Prepare first");
    setBusy(true);
    try {
      for (const hex of onChainCommitments) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let j = 0; j < bytes.length; j++) bytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
        const hash = await invokeContractWallet(
          company.address,
          poolId,
          "deposit",
          [bytesScVal(bytes)],
          company.signTx,
        );
        append(`Deposited · ${hash.slice(0, 12)}…`);
      }
    } catch (e) {
      append(`Deposit failed · ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const distributorFinalize = async () => {
    if (!poolId || !company.address) return append("Connect company wallet");
    const notes = storedNotes.length
      ? storedNotes
      : (JSON.parse(localStorage.getItem("vellum-notes") ?? "[]") as StoredNote[]);
    if (!notes.length) return append("Prepare first");

    const amounts = notes.map((n) => parseField(n.amount));
    const total = amounts.reduce((a, b) => a + b, 0n);

    setBusy(true);
    try {
      append("Proving batch sum…");
      const witness = await buildBatchSumWitness(amounts);
      const circuit = await loadBatchSumCircuit();
      const { proof, publicInputs } = await generateProof(
        circuit,
        witness as unknown as Record<string, string | string[]>,
      );
      const hash = await invokeContractWallet(
        company.address,
        poolId,
        "finalize_batch",
        [i128ScVal(total), bytesScVal(publicInputs), bytesScVal(proof)],
        company.signTx,
      );
      append(`Finalized · ${total} · ${hash.slice(0, 12)}…`);
    } catch (e) {
      append(`Finalize failed · ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const employeeTrustline = async () => {
    if (!tokenId || !employee.address) return append("Connect wallet");
    setBusy(true);
    try {
      const hash = await invokeContractWallet(
        employee.address,
        tokenId,
        "trust",
        [addressScVal(employee.address)],
        employee.signTx,
      );
      append(`Trustline · ${hash.slice(0, 12)}…`);
    } catch (e) {
      append(`Trustline failed · ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const employeeWithdraw = async () => {
    if (!poolId || !employee.address) return append("Connect wallet");
    const note = storedNotes[selectedNoteIdx];
    if (!note) return append("No prepared batch — run company flow first");
    if (note.payeeAddress !== employee.address) return append("Wrong wallet for selected payee");

    setBusy(true);
    try {
      const parsed = {
        recipientId: parseField(note.recipientId),
        pubkeyLo: parseField(note.pubkeyLo),
        pubkeyHi: parseField(note.pubkeyHi),
        amount: parseField(note.amount),
        salt: parseField(note.salt),
        privKey: parseField(note.privKey),
        leafIndex: note.leafIndex,
      };
      append("Proving withdraw…");
      const witness = await buildWithdrawWitness(parsed, {
        batchRootHex: note.batchRootHex,
        pathSiblings: note.pathSiblings,
        pathBits: note.pathBits,
      });
      const circuit = await loadWithdrawCircuit();
      const { proof, publicInputs } = await generateProof(
        circuit,
        witness as unknown as Record<string, string | string[]>,
      );
      const hash = await invokeContractWallet(
        employee.address,
        poolId,
        "withdraw",
        [addressScVal(employee.address), bytesScVal(publicInputs), bytesScVal(proof)],
        employee.signTx,
      );
      append(`Withdrawn · ${hash.slice(0, 12)}…`);
    } catch (e) {
      append(`Withdraw failed · ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const auditorVerify = async () => {
    const notes = storedNotes.length
      ? storedNotes
      : (JSON.parse(localStorage.getItem("vellum-notes") ?? "[]") as StoredNote[]);
    if (!notes.length) return append("Nothing to verify");
    const n = notes[selectedNoteIdx] ?? notes[0];
    const recomputed = await commitmentFromNote({
      recipientId: parseField(n.recipientId),
      amount: parseField(n.amount),
      salt: parseField(n.salt),
    });
    const hex = Array.from(recomputed)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    append(onChainCommitments.includes(hex) ? `Verified · ${hex.slice(0, 16)}…` : "Mismatch");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden />
          <span className="brand__name">Vellum</span>
        </div>
        <span className="network">{NETWORK_LABEL}</span>
      </header>

      <nav className="nav nav--mode">
        {(["company", "employee", "audit"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`nav__item ${mode === m ? "nav__item--active" : ""}`}
            onClick={() => setMode(m)}
          >
            {m === "company" ? "Company" : m === "employee" ? "Employee" : "Audit"}
          </button>
        ))}
        <button
          type="button"
          className="settings-toggle"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
        >
          ···
        </button>
      </nav>

      {showSettings && (
        <div className="settings">
          <input
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            placeholder="Payroll pool"
          />
          <input
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="Payout token"
          />
        </div>
      )}

      <main className="stage">
        {mode === "company" && (
          <>
            <WalletChip
              label="Company"
              address={company.address}
              connecting={company.connecting}
              available={company.available}
              onConnect={connectCompany}
              onDisconnect={company.disconnect}
            />
            <div className="panel">
              <BatchEditor
                rows={batchRows}
                manualTotal={manualTotal}
                totalOverride={totalOverride}
                onRowsChange={setBatchRows}
                onManualTotalChange={setManualTotal}
                onTotalOverrideChange={setTotalOverride}
              />
              <div className="actions">
                <button type="button" onClick={distributorPrepare} disabled={busy}>
                  Prepare
                </button>
                <button
                  type="button"
                  onClick={distributorDepositAll}
                  disabled={busy || !company.address}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className="actions__primary"
                  onClick={distributorFinalize}
                  disabled={busy || !company.address}
                >
                  Finalize
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "employee" && (
          <>
            <WalletChip
              label="Payee"
              address={employee.address}
              connecting={employee.connecting}
              available={employee.available}
              onConnect={connectEmployee}
              onDisconnect={employee.disconnect}
            />
            <div className="panel">
              {storedNotes.length > 0 && (
                <div className="field">
                  <label htmlFor="payee-select">Claim as</label>
                  <select
                    id="payee-select"
                    value={selectedNoteIdx}
                    onChange={(e) => setSelectedNoteIdx(Number(e.target.value))}
                  >
                    {storedNotes.map((n, i) => (
                      <option key={n.leafIndex} value={i}>
                        {n.payeeAddress.slice(0, 8)}…{n.payeeAddress.slice(-4)} · {n.amount}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="actions">
                <button type="button" onClick={employeeTrustline} disabled={busy || !employee.address}>
                  Trustline
                </button>
                <button
                  type="button"
                  className="actions__primary"
                  onClick={employeeWithdraw}
                  disabled={busy || !employee.address || !storedNotes.length}
                >
                  Withdraw
                </button>
              </div>
            </div>
          </>
        )}

        {mode === "audit" && (
          <div className="panel">
            {storedNotes.length > 0 && (
              <div className="field">
                <label htmlFor="audit-select">Leaf</label>
                <select
                  id="audit-select"
                  value={selectedNoteIdx}
                  onChange={(e) => setSelectedNoteIdx(Number(e.target.value))}
                >
                  {storedNotes.map((n, i) => (
                    <option key={n.leafIndex} value={i}>
                      {n.payeeAddress.slice(0, 8)}… · {n.amount}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" className="actions__primary" onClick={auditorVerify} disabled={busy}>
              Verify leaf
            </button>
          </div>
        )}
      </main>

      <StatusBar message={log} busy={busy} />
    </div>
  );
}
