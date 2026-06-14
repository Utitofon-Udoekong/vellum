import { useCallback, useEffect, useRef, useState } from "react";
import { commitmentFromNote, parseField } from "./commitment";
import { bytesToHex } from "./bytes";
import { noteToCommitment, simulateIncrementalInserts } from "./merkle";
import { generateProof, prewarmWithdrawProving } from "./proof";
import { loadBatchSumCircuit, loadWithdrawCircuit } from "./circuits";
import { buildBatchSumWitness, buildWithdrawWitness } from "./witness";
import { recipientIdFromAddress, splitPubkeyLimbs } from "./pubkey";
import { DEFAULT_POOL_ID, DEFAULT_TOKEN_ID, DEMO_EMPLOYEE_G, DISTRIBUTOR_G, NETWORK_LABEL } from "./demo-config";
import { describePoolContractError, isBatchFinalizedError, isCommitmentExistsError } from "./pool-errors";
import { addressScVal, bytesScVal, i128ScVal, invokeContractWallet, readPoolBatchStatus, readPoolCommitmentCount, readPoolFinalizedRoot, readPoolTotalDeposited, readTokenBalance, readTokenDecimals, readTokenSymbol } from "./stellar";
import { useFreighter } from "./hooks/useFreighter";
import { WalletChip } from "./components/WalletChip";
import { StatusBar } from "./components/StatusBar";
import { BatchEditor } from "./components/BatchEditor";
import { BATCH_MAX, newBatchRow, sumHumanAmounts, validatePayeeAddress, type BatchRow } from "./payroll";
import { DEFAULT_TOKEN_DECIMALS, formatTokenAmount, parseHumanAmount, tryParseHumanAmount } from "./token-amount";
import type { StoredNote } from "./types";
import { clearPayrollSession, loadPayrollSession, noteSecretsForLeafIndex, savePayrollSession } from "./session";

type Mode = "company" | "employee" | "audit";

const RESTORE_NOTES_HINT =
  "No matching saved batch in this browser — on-chain data cannot recover payee rows.";
const NEW_PAYROLL_HINT =
  "Click New payroll session below (deploys a testnet pool while dev server is running).";

interface PoolBatchSummary {
  commitmentCount: number;
  totalDeposited: bigint;
  finalizedRootHex: string;
}

export default function App() {
  const company = useFreighter({ requiredAddress: DISTRIBUTOR_G });

  const [mode, setMode] = useState<Mode>("company");
  const [log, setLog] = useState("");
  const [activity, setActivity] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([
    newBatchRow({ payeeAddress: DEMO_EMPLOYEE_G, amount: "100" }),
  ]);
  const [manualTotal, setManualTotal] = useState(false);
  const [totalOverride, setTotalOverride] = useState("");
  const [poolId, setPoolId] = useState(DEFAULT_POOL_ID);
  const [tokenId, setTokenId] = useState(DEFAULT_TOKEN_ID);
  const [storedNotes, setStoredNotes] = useState<StoredNote[]>([]);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState(0);
  const employeeExpectedPayee = storedNotes[selectedNoteIdx]?.payeeAddress;
  const employee = useFreighter({ requiredAddress: employeeExpectedPayee });
  const [employeeTrustlineDone, setEmployeeTrustlineDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [onChainCommitments, setOnChainCommitments] = useState<string[]>([]);
  const [batchPrepared, setBatchPrepared] = useState(false);
  const [batchDeposited, setBatchDeposited] = useState(false);
  const [batchFinalized, setBatchFinalized] = useState(false);
  const [notesMatchPool, setNotesMatchPool] = useState<boolean | null>(null);
  const [poolSummary, setPoolSummary] = useState<PoolBatchSummary | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(DEFAULT_TOKEN_DECIMALS);
  const [tokenSymbol, setTokenSymbol] = useState("VELLUM");
  const [companyTokenBalance, setCompanyTokenBalance] = useState<bigint | null>(null);
  const [withdrawCrsReady, setWithdrawCrsReady] = useState(false);
  const [showSettings, setShowSettings] = useState(!DEFAULT_POOL_ID || !DEFAULT_TOKEN_ID);
  const lastRestoredPool = useRef<string | null>(null);

  const fmtAmount = (stroops: bigint) => `${formatTokenAmount(stroops, tokenDecimals)} ${tokenSymbol}`;

  const restoreNotesFromSession = useCallback(
    (notes: StoredNote[]) => {
      setStoredNotes(notes);
      setSelectedNoteIdx(0);
      if (notes.length) {
        setBatchRows(
          notes.map((n) => ({
            id: crypto.randomUUID(),
            payeeAddress: n.payeeAddress,
            amount: formatTokenAmount(parseField(n.amount), tokenDecimals),
          })),
        );
        void (async () => {
          try {
            const commitments = await Promise.all(
              notes.map(async (n) => {
                const { salt } = noteSecretsForLeafIndex(n.leafIndex);
                const bytes = await commitmentFromNote({
                  recipientId: parseField(n.recipientId),
                  amount: parseField(n.amount),
                  salt,
                });
                return Array.from(bytes)
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
              }),
            );
            setOnChainCommitments(commitments);
            setBatchPrepared(true);
          } catch {
            setBatchPrepared(false);
            setOnChainCommitments([]);
          }
        })();
      }
    },
    [tokenDecimals],
  );

  const resetPayrollState = useCallback(() => {
    clearPayrollSession();
    lastRestoredPool.current = null;
    setStoredNotes([]);
    setSelectedNoteIdx(0);
    setOnChainCommitments([]);
    setBatchPrepared(false);
    setBatchDeposited(false);
    setBatchFinalized(false);
    setNotesMatchPool(null);
    setPoolSummary(null);
    setEmployeeTrustlineDone(false);
    setWithdrawCrsReady(false);
    setBatchRows([newBatchRow({ payeeAddress: DEMO_EMPLOYEE_G, amount: "100" })]);
    setManualTotal(false);
    setTotalOverride("");
  }, []);

  const append = (msg: string) => setLog((prev) => (prev ? `${prev}\n${msg}` : msg));

  const syncPoolFromChain = useCallback(async (): Promise<0 | 1 | null> => {
    if (!poolId) return null;
    try {
      const status = await readPoolBatchStatus(poolId);
      if (status === 1) {
        setBatchFinalized(true);
        setBatchDeposited(true);
      }
      return status;
    } catch {
      return null;
    }
  }, [poolId]);

  const validateNotesAgainstPool = useCallback(
    async (
      notes: StoredNote[] = storedNotes,
      chainFinalized: boolean = batchFinalized,
    ): Promise<boolean | null> => {
      if (!poolId || !chainFinalized) {
        setNotesMatchPool(null);
        if (!chainFinalized) setPoolSummary(null);
        return null;
      }
      try {
        const [chainRoot, commitmentCount, totalDeposited] = await Promise.all([
          readPoolFinalizedRoot(poolId),
          readPoolCommitmentCount(poolId),
          readPoolTotalDeposited(poolId),
        ]);
        if (!chainRoot) {
          setNotesMatchPool(null);
          setPoolSummary(null);
          return null;
        }
        const finalizedRootHex = bytesToHex(chainRoot).toLowerCase();
        setPoolSummary({ commitmentCount, totalDeposited, finalizedRootHex });

        if (!notes.length) {
          setNotesMatchPool(false);
          return false;
        }

        const localRoot = notes[0]?.batchRootHex?.replace(/^0x/i, "").toLowerCase();
        if (!localRoot) {
          setNotesMatchPool(false);
          return false;
        }
        const match = localRoot === finalizedRootHex;
        setNotesMatchPool(match);
        return match;
      } catch {
        setNotesMatchPool(null);
        setPoolSummary(null);
        return null;
      }
    },
    [batchFinalized, poolId, storedNotes],
  );

  const syncEmployerSession = useCallback(
    async (opts?: { announce?: boolean }) => {
      if (!poolId) return;

      const session = loadPayrollSession(poolId);
      let notes = storedNotes;
      if (session?.notes.length) {
        const alreadyLoaded =
          storedNotes.length === session.notes.length &&
          storedNotes[0]?.batchRootHex === session.notes[0]?.batchRootHex;
        if (!alreadyLoaded) {
          restoreNotesFromSession(session.notes);
          notes = session.notes;
        }
      }

      const status = await syncPoolFromChain();
      const match = await validateNotesAgainstPool(notes, status === 1);

      if (!opts?.announce || lastRestoredPool.current === poolId) return;
      lastRestoredPool.current = poolId;

      if (session?.notes.length && match) {
        append(`Batch restored · ${session.notes.length} payee(s) for this pool`);
      } else if (session?.notes.length && match === false) {
        append(
          `Saved batch loaded (${session.notes.length} payee(s)) but does not match this pool on chain — ${NEW_PAYROLL_HINT}`,
        );
      } else if (status === 1) {
        append("No saved batch for this pool in this browser — use New payroll session to start fresh.");
      }
    },
    [poolId, restoreNotesFromSession, storedNotes, syncPoolFromChain, validateNotesAgainstPool],
  );

  useEffect(() => {
    lastRestoredPool.current = null;
    void syncEmployerSession();
  }, [poolId, syncEmployerSession]);

  useEffect(() => {
    if (company.address !== DISTRIBUTOR_G) return;
    void syncEmployerSession({ announce: true });
  }, [company.address, syncEmployerSession]);

  useEffect(() => {
    if (!tokenId) return;
    void (async () => {
      try {
        const [decimals, symbol] = await Promise.all([
          readTokenDecimals(tokenId),
          readTokenSymbol(tokenId),
        ]);
        setTokenDecimals(decimals);
        setTokenSymbol(symbol);
      } catch {
        setTokenDecimals(DEFAULT_TOKEN_DECIMALS);
        setTokenSymbol("TOKEN");
      }
    })();
  }, [tokenId]);

  const refreshCompanyBalance = useCallback(async () => {
    if (!tokenId || company.address !== DISTRIBUTOR_G) {
      setCompanyTokenBalance(null);
      return;
    }
    try {
      setCompanyTokenBalance(await readTokenBalance(tokenId, company.address));
    } catch {
      setCompanyTokenBalance(null);
    }
  }, [company.address, tokenId]);

  useEffect(() => {
    void refreshCompanyBalance();
  }, [refreshCompanyBalance]);

  const setStatus = (msg: string) => {
    setActivity(msg);
    append(msg);
  };

  const fail = (action: string, e: unknown) => {
    console.error(`[vellum] ${action}`, e);
    const poolMsg = describePoolContractError(e);
    const message = poolMsg ?? (e instanceof Error ? e.message : String(e));
    append(`${action} · ${message}`);
  };

  useEffect(() => {
    if (mode !== "employee" || !storedNotes.length || withdrawCrsReady) return;
    void (async () => {
      try {
        setActivity("Downloading withdraw prover data (~0.5 MB)…");
        await prewarmWithdrawProving();
        setWithdrawCrsReady(true);
        append("Withdraw prover ready");
      } catch (e) {
        fail("Prover download failed", e);
      } finally {
        setActivity("");
      }
    })();
  }, [mode, storedNotes.length, withdrawCrsReady]);

  useEffect(() => {
    setEmployeeTrustlineDone(false);
  }, [employeeExpectedPayee, employee.address]);

  const resolveBatchTotal = (): bigint | null => {
    const auto = sumHumanAmounts(batchRows, tokenDecimals);
    if (!manualTotal) return auto;
    const manual = tryParseHumanAmount(totalOverride, tokenDecimals);
    if (manual === null) return totalOverride.trim() === "" ? auto : null;
    return manual === auto ? manual : null;
  };

  const connectCompany = async (switchTo?: string) => {
    try {
      append(`Connected · ${await company.connect(switchTo)}`);
      await syncEmployerSession({ announce: true });
    } catch (e) {
      fail("Freighter", e);
    }
  };

  const requireCompanyAdmin = (): boolean => {
    if (company.address !== DISTRIBUTOR_G) {
      append("Open Freighter and select the company admin wallet, then try again.");
      return false;
    }
    return true;
  };

  const connectEmployee = async (switchTo?: string) => {
    try {
      append(`Connected · ${await employee.connect(switchTo)}`);
    } catch (e) {
      fail("Freighter", e);
    }
  };

  const requireEmployeePayee = (): boolean => {
    if (!employeeExpectedPayee || employee.address !== employeeExpectedPayee) {
      append("Open Freighter and select your payee wallet, then try again.");
      return false;
    }
    return true;
  };

  const startNewPayrollSession = async () => {
    if (busy) return;
    if (
      !window.confirm(
        "Deploy a new testnet pool and reset this browser session? Takes about a minute (requires pnpm dev).",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      setStatus("Deploying new pool on testnet…");
      resetPayrollState();
      const res = await fetch("/api/new-payroll", { method: "POST" });
      const body = (await res.json()) as { poolId?: string; tokenId?: string; error?: string };
      if (!res.ok || !body.poolId || !body.tokenId) {
        throw new Error(body.error ?? "Deploy failed — run pnpm demo:deploy in a terminal");
      }
      setPoolId(body.poolId);
      setTokenId(body.tokenId);
      setShowSettings(true);
      append(
        `New payroll session · pool ${body.poolId.slice(0, 8)}… — Step 1 Prepare, then Deposit, then Finalize.`,
      );
    } catch (e) {
      fail("New payroll", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const distributorPrepare = async () => {
    if (batchRows.length > BATCH_MAX) return append(`Max ${BATCH_MAX} payees`);
    for (const row of batchRows) {
      const err = validatePayeeAddress(row.payeeAddress);
      if (err) return append(`${row.payeeAddress.slice(0, 8)}… · ${err}`);
      try {
        const stroops = parseHumanAmount(row.amount, tokenDecimals);
        if (stroops <= 0n) return append("Each amount must be greater than zero");
      } catch (e) {
        return append(e instanceof Error ? e.message : "Invalid amount");
      }
    }

    const total = resolveBatchTotal();
    if (total === null) return append("Manual total must equal row sum");

    setBusy(true);
    try {
      setStatus("Building Merkle tree and commitments…");
      const draftNotes = await Promise.all(
        batchRows.map(async (row, i) => {
          const { lo, hi } = splitPubkeyLimbs(row.payeeAddress);
          const recipientId = await recipientIdFromAddress(row.payeeAddress);
          const amount = parseHumanAmount(row.amount, tokenDecimals);
          return {
            payeeAddress: row.payeeAddress,
            pubkeyLo: lo,
            pubkeyHi: hi,
            recipientId,
            amount,
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

      const chainStatus = poolId ? await syncPoolFromChain() : null;
      if (chainStatus === 1) {
        const chainRoot = poolId ? await readPoolFinalizedRoot(poolId) : null;
        const matchesPool =
          !!chainRoot && batchRootHex.toLowerCase() === bytesToHex(chainRoot).toLowerCase();
        if (!matchesPool) {
          const onChain =
            poolSummary ??
            (poolId
              ? {
                  commitmentCount: await readPoolCommitmentCount(poolId),
                  totalDeposited: await readPoolTotalDeposited(poolId),
                  finalizedRootHex: chainRoot ? bytesToHex(chainRoot).toLowerCase() : "?",
                }
              : null);
          const yours = `${batchRows.length} row(s), total ${fmtAmount(resolveBatchTotal() ?? 0n)}`;
          const theirs = onChain
            ? `${onChain.commitmentCount} payee(s), total ${fmtAmount(onChain.totalDeposited)}`
            : "unknown";
          fail(
            "Restore batch",
            new Error(
              onChain && onChain.commitmentCount !== batchRows.length
                ? `This pool is locked to ${onChain.commitmentCount} payee(s) (total ${fmtAmount(onChain.totalDeposited)}) — you have ${batchRows.length}. ` +
                    "You cannot pay different addresses on a finalized pool. " +
                    NEW_PAYROLL_HINT
                : `Batch still does not match pool ${poolId.slice(0, 8)}… — on chain: ${theirs}; yours: ${yours}. ` +
                    "Match the original payee addresses, amounts, and row order, or " +
                    NEW_PAYROLL_HINT.toLowerCase(),
            ),
          );
          return;
        }
      }

      setOnChainCommitments(commitments);
      setStoredNotes(notes);
      setBatchPrepared(true);
      if (poolId && tokenId) {
        savePayrollSession({ poolId, tokenId, notes });
      }

      if (chainStatus === 1) {
        setNotesMatchPool(true);
        append(
          `Notes restored for finalized pool · ${notes.length} payees — Employee tab → Connect → Trustline → Withdraw.`,
        );
      } else {
        setBatchDeposited(false);
        setBatchFinalized(false);
        setNotesMatchPool(null);
        append(`Prepared · ${notes.length} payees · total ${fmtAmount(total)}`);
      }
    } catch (e) {
      fail("Prepare failed", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const distributorDepositAll = async () => {
    if (!poolId || !requireCompanyAdmin()) return;
    if (!onChainCommitments.length) return append("Prepare first");
    const chainStatus = await syncPoolFromChain();
    if (chainStatus === 1 || batchFinalized) {
      return append("Batch already finalized on chain — switch to Employee tab to withdraw.");
    }
    setBusy(true);
    try {
      setStatus(
        `Depositing ${onChainCommitments.length} commitment(s) — Freighter will ask once per payee.`,
      );
      for (let i = 0; i < onChainCommitments.length; i++) {
        const hex = onChainCommitments[i];
        const bytes = new Uint8Array(hex.length / 2);
        for (let j = 0; j < bytes.length; j++) bytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
        try {
          const hash = await invokeContractWallet(
            DISTRIBUTOR_G,
            poolId,
            "deposit",
            [bytesScVal(bytes)],
            company.signTx,
            (msg) => setStatus(`Deposit ${i + 1}/${onChainCommitments.length} · ${msg}`),
          );
          append(`Deposited ${i + 1}/${onChainCommitments.length} · ${hash.slice(0, 12)}…`);
        } catch (e) {
          if (isCommitmentExistsError(e)) {
            append(`Already on chain ${i + 1}/${onChainCommitments.length} · ${hex.slice(0, 12)}…`);
            continue;
          }
          if (isBatchFinalizedError(e)) {
            setBatchFinalized(true);
            setBatchDeposited(true);
            append("Batch already finalized — switch to Employee tab to withdraw.");
            return;
          }
          throw e;
        }
      }
      append("Deposit step complete — proceed to Finalize");
      setBatchDeposited(true);
    } catch (e) {
      fail("Deposit failed", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const distributorFinalize = async () => {
    if (!poolId || !requireCompanyAdmin()) return;
    const notes = storedNotes.length ? storedNotes : (loadPayrollSession(poolId)?.notes ?? []);
    if (!notes.length) return append("Prepare first");

    const chainStatus = await syncPoolFromChain();
    if (chainStatus === 1 || batchFinalized) {
      return append(
        "Batch already finalized on chain — Employee tab → Withdraw. For a new payroll, run pnpm demo:prep and update the pool ID in settings.",
      );
    }

    const amounts = notes.map((n) => parseField(n.amount));
    const total = amounts.reduce((a, b) => a + b, 0n);

    setBusy(true);
    try {
      setStatus("Proving batch sum in browser (~1–2 min, keep this tab open)…");
      const witness = await buildBatchSumWitness(amounts);
      const circuit = await loadBatchSumCircuit();
      const { proof, publicInputs } = await generateProof(
        circuit,
        witness as unknown as Record<string, string | string[]>,
      );
      setStatus("Proof ready — approve finalize batch in Freighter…");
      const hash = await invokeContractWallet(
        DISTRIBUTOR_G,
        poolId,
        "finalize_batch",
        [i128ScVal(total), bytesScVal(publicInputs), bytesScVal(proof)],
        company.signTx,
        setStatus,
      );
      append(`Finalized · ${fmtAmount(total)} · ${hash.slice(0, 12)}…`);
      setBatchFinalized(true);
      void refreshCompanyBalance();
    } catch (e) {
      if (isBatchFinalizedError(e)) {
        setBatchFinalized(true);
        setBatchDeposited(true);
        append(
          "Batch already finalized on chain — Employee tab → Withdraw. (Proof was generated but not needed.)",
        );
        return;
      }
      fail("Finalize failed", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const employeeTrustline = async () => {
    if (!tokenId || !requireEmployeePayee()) return;
    setBusy(true);
    try {
      setStatus("Approve trustline in Freighter…");
      const hash = await invokeContractWallet(
        employee.address!,
        tokenId,
        "trust",
        [addressScVal(employee.address!)],
        employee.signTx,
        setStatus,
      );
      setEmployeeTrustlineDone(true);
      append(`Trustline · ${hash.slice(0, 12)}…`);
    } catch (e) {
      fail("Trustline failed", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const employeeWithdraw = async () => {
    if (!poolId || !requireEmployeePayee()) return;
    if (notesMatchPool !== true) {
      return append(
        "Saved batch does not match this pool — Company → Prepare (same payees as deposit), or New payroll session.",
      );
    }
    const note = storedNotes[selectedNoteIdx];
    if (!note) return append("No prepared batch — run company flow first");

    setBusy(true);
    try {
      if (!withdrawCrsReady) {
        setStatus("Downloading withdraw prover data (~0.5 MB)…");
        await prewarmWithdrawProving();
        setWithdrawCrsReady(true);
      }
      const { salt, privKey } = noteSecretsForLeafIndex(note.leafIndex);
      const parsed = {
        recipientId: parseField(note.recipientId),
        pubkeyLo: parseField(note.pubkeyLo),
        pubkeyHi: parseField(note.pubkeyHi),
        amount: parseField(note.amount),
        salt,
        privKey,
        leafIndex: note.leafIndex,
      };
      setStatus("Proving withdraw in browser (keep this tab open)…");
      const witness = await buildWithdrawWitness(
        { ...parsed, payeeAddress: note.payeeAddress },
        {
          batchRootHex: note.batchRootHex,
          pathSiblings: note.pathSiblings,
          pathBits: note.pathBits,
        },
        storedNotes.map((n) => ({
          payeeAddress: n.payeeAddress,
          amount: parseField(n.amount),
          leafIndex: n.leafIndex,
        })),
      );
      const circuit = await loadWithdrawCircuit();
      const { proof, publicInputs } = await generateProof(
        circuit,
        witness as unknown as Record<string, string | string[]>,
      );
      setStatus("Proof ready — approve withdraw in Freighter…");
      const hash = await invokeContractWallet(
        employee.address!,
        poolId,
        "withdraw",
        [addressScVal(employee.address!), bytesScVal(publicInputs), bytesScVal(proof)],
        employee.signTx,
        setStatus,
      );
      append(`Withdrawn · ${fmtAmount(parseField(note.amount))} · ${hash.slice(0, 12)}…`);
    } catch (e) {
      fail("Withdraw failed", e);
    } finally {
      setActivity("");
      setBusy(false);
    }
  };

  const auditorVerify = async () => {
    const notes = storedNotes.length ? storedNotes : (loadPayrollSession(poolId)?.notes ?? []);
    if (!notes.length) return append("Nothing to verify");
    const n = notes[selectedNoteIdx] ?? notes[0];
    const recomputed = await commitmentFromNote({
      recipientId: parseField(n.recipientId),
      amount: parseField(n.amount),
      salt: noteSecretsForLeafIndex(n.leafIndex).salt,
    });
    const hex = Array.from(recomputed)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    append(onChainCommitments.includes(hex) ? `Verified · ${hex.slice(0, 16)}…` : "Mismatch");
  };

  const companyStep: 1 | 2 | 3 = batchFinalized
    ? 3
    : !batchPrepared
      ? 1
      : !batchDeposited
        ? 2
        : 3;

  const companyStepHint = batchFinalized
    ? notesMatchPool === false
      ? poolSummary
        ? batchRows.length !== poolSummary.commitmentCount
          ? `This pool is finalized for ${poolSummary.commitmentCount} payee(s) (total ${fmtAmount(poolSummary.totalDeposited)}) — not ${batchRows.length}. Original employees can still withdraw if you restore their exact rows. ${NEW_PAYROLL_HINT}`
          : `Same payee count but wrong addresses, amounts, or order (total ${fmtAmount(poolSummary.totalDeposited)} on chain). ${RESTORE_NOTES_HINT} ${NEW_PAYROLL_HINT}`
        : `Saved batch does not match pool ${poolId ? `${poolId.slice(0, 8)}…` : ""} on chain. ${RESTORE_NOTES_HINT} ${NEW_PAYROLL_HINT}`
      : notesMatchPool === true
        ? "Batch restored for this pool. Employee tab → Connect payee → Trustline → Withdraw."
        : storedNotes.length
          ? "Checking saved batch against finalized pool…"
          : `Pool finalized but no saved batch in this browser. ${RESTORE_NOTES_HINT} ${NEW_PAYROLL_HINT}`
    : !batchPrepared
      ? "Step 1 — Prepare builds commitments locally (no wallet needed)."
      : company.address !== DISTRIBUTOR_G
        ? "Step 2 — Open Freighter, select the company wallet, then Deposit."
        : !batchDeposited
          ? "Step 2 — Deposit posts each commitment (one Freighter approval per payee)."
          : !batchFinalized
            ? "Step 3 — Finalize proves the batch total (~1–2 min), then one Freighter approval."
            : "Batch finalized on chain.";

  const employeeWalletReady = !!(
    employeeExpectedPayee &&
    employee.address &&
    employee.address === employeeExpectedPayee
  );

  const employeeStep: 1 | 2 | 3 = !storedNotes.length || !batchFinalized
    ? 1
    : !employeeWalletReady
      ? 1
      : !employeeTrustlineDone
        ? 2
        : 3;

  const employeeStepHint = !storedNotes.length
    ? `No saved batch in this browser. ${NEW_PAYROLL_HINT}`
    : !batchFinalized
      ? "Waiting for the company to finalize the batch before you can withdraw."
      : notesMatchPool === false
        ? poolSummary && batchRows.length !== poolSummary.commitmentCount
          ? `This pool pays ${poolSummary.commitmentCount} original payee(s) only. ${NEW_PAYROLL_HINT}`
          : `Saved notes do not match this finalized pool. ${RESTORE_NOTES_HINT} ${NEW_PAYROLL_HINT}`
        : notesMatchPool === null
          ? "Checking saved batch against finalized pool…"
          : !employeeWalletReady
            ? employeeExpectedPayee
              ? `Step 1 — Open Freighter, select ${employeeExpectedPayee.slice(0, 8)}…${employeeExpectedPayee.slice(-4)}, then connect.`
              : "Step 1 — Open Freighter and connect your payee wallet."
            : !employeeTrustlineDone
              ? "Step 2 — Add trustline for the payout token (one Freighter approval)."
              : "Step 3 — Withdraw proves your entitlement (~1–2 min), then one Freighter approval.";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="" className="brand__mark" width={28} height={28} />
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
            onChange={(e) => {
              const next = e.target.value;
              if (next.trim() !== poolId.trim()) resetPayrollState();
              setPoolId(next);
            }}
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
              freighterActive={company.freighterActive}
              expectedAddress={DISTRIBUTOR_G}
              connecting={company.connecting}
              available={company.available}
              onConnect={connectCompany}
              onDisconnect={company.disconnect}
            />
            {company.address === DISTRIBUTOR_G && tokenId && companyTokenBalance !== null && (
              <p className="company-balance">
                Payout token balance · {fmtAmount(companyTokenBalance)}
              </p>
            )}
            <div className="panel">
              <div className="panel__toolbar">
                <button
                  type="button"
                  className="panel__new-payroll"
                  onClick={startNewPayrollSession}
                  disabled={busy}
                  title="Deploy a fresh testnet pool and reset saved batch data"
                >
                  New payroll session
                </button>
              </div>
              <BatchEditor
                rows={batchRows}
                manualTotal={manualTotal}
                totalOverride={totalOverride}
                tokenDecimals={tokenDecimals}
                tokenSymbol={tokenSymbol}
                onRowsChange={setBatchRows}
                onManualTotalChange={setManualTotal}
                onTotalOverrideChange={setTotalOverride}
              />
              <p className="hint">{companyStepHint}</p>
              {busy && activity ? (
                <div className="activity" role="status" aria-live="polite">
                  <span className="activity__pulse" aria-hidden />
                  {activity}
                </div>
              ) : null}
              <div className="actions actions--steps">
                <button
                  type="button"
                  className={
                    companyStep === 1 || notesMatchPool === false ? "actions__step--next" : ""
                  }
                  onClick={distributorPrepare}
                  disabled={busy}
                  title={
                    notesMatchPool === false
                      ? "Rebuild saved notes from the table — must match the on-chain payroll"
                      : "Step 1 — build Merkle commitments locally"
                  }
                >
                  <span className="actions__step-num">1</span>
                  {notesMatchPool === false ? "Restore batch" : "Prepare"}
                </button>
                <button
                  type="button"
                  className={companyStep === 2 ? "actions__step--next" : ""}
                  onClick={distributorDepositAll}
                  disabled={busy || batchFinalized || !batchPrepared || !onChainCommitments.length}
                  title="Step 2 — after Prepare; posts each commitment to the pool"
                >
                  <span className="actions__step-num">2</span>
                  Deposit
                </button>
                <button
                  type="button"
                  className={`actions__primary ${companyStep === 3 && !batchFinalized ? "actions__step--next" : ""}`}
                  onClick={distributorFinalize}
                  disabled={busy || !batchDeposited || batchFinalized}
                  title={
                    batchFinalized
                      ? "Batch already finalized on chain"
                      : "Step 3 — after Deposit; ZK proof (~1–2 min)"
                  }
                >
                  <span className="actions__step-num">3</span>
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
              freighterActive={employee.freighterActive}
              expectedAddress={employeeExpectedPayee}
              connecting={employee.connecting}
              available={employee.available}
              onConnect={connectEmployee}
              onDisconnect={employee.disconnect}
            />
            <div className="panel">
              <p className="hint">{employeeStepHint}</p>
              {storedNotes.length > 0 && (
                <div className="field">
                  <label htmlFor="payee-select">Claim as</label>
                  <select
                    id="payee-select"
                    value={selectedNoteIdx}
                    onChange={(e) => setSelectedNoteIdx(Number(e.target.value))}
                  >
                    {storedNotes.map((n, i) => {
                      const short = `${n.payeeAddress.slice(0, 8)}…${n.payeeAddress.slice(-4)}`;
                      const connected = employee.address === n.payeeAddress;
                      const amountLabel = fmtAmount(parseField(n.amount));
                      return (
                        <option key={n.leafIndex} value={i}>
                          {connected ? `${short} · ${amountLabel}` : short}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              {busy && activity ? (
                <div className="activity" role="status" aria-live="polite">
                  <span className="activity__pulse" aria-hidden />
                  {activity}
                </div>
              ) : null}
              <div className="actions actions--steps">
                <button
                  type="button"
                  className={employeeStep === 2 ? "actions__step--next" : ""}
                  onClick={employeeTrustline}
                  disabled={busy || !storedNotes.length || !batchFinalized || !employeeWalletReady}
                  title="Step 2 — after Connect; add token trustline"
                >
                  <span className="actions__step-num">2</span>
                  Trustline
                </button>
                <button
                  type="button"
                  className={`actions__primary ${employeeStep === 3 ? "actions__step--next" : ""}`}
                  onClick={employeeWithdraw}
                  disabled={
                    busy ||
                    !storedNotes.length ||
                    !batchFinalized ||
                    !employeeWalletReady ||
                    !employeeTrustlineDone ||
                    notesMatchPool !== true
                  }
                  title="Step 3 — after Trustline; ZK proof (~1–2 min)"
                >
                  <span className="actions__step-num">3</span>
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
                      {n.payeeAddress.slice(0, 8)}… · {n.payeeAddress.slice(-4)}
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

      <StatusBar message={log} activity={activity} busy={busy} />
    </div>
  );
}
