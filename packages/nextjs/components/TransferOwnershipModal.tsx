// packages/nextjs/components/TransferOwnershipModal.tsx
"use client";

import React, { useState } from "react";
import { ArrowRightIcon, UserCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

// packages/nextjs/components/TransferOwnershipModal.tsx

type Props = {
  isOpen: boolean;
  onClose: () => void;
  fileHashHex: string;
  filename?: string;
  currentOwner: string;
  onSuccess?: () => void;
};

export default function TransferOwnershipModal({
  isOpen,
  onClose,
  fileHashHex,
  filename,
  currentOwner,
  onSuccess,
}: Props) {
  const [newOwner, setNewOwner] = useState("");
  const [step, setStep] = useState<"input" | "blockchain" | "database" | "done">("input");
  const [txHash, setTxHash] = useState("");

  const { writeContractAsync: writeFileVault } = useScaffoldWriteContract({
    contractName: "FileVault",
  });

  const handleTransfer = async () => {
    try {
      // Validation
      if (!newOwner || !/^0x[0-9a-fA-F]{40}$/.test(newOwner)) {
        notification.error("Invalid Ethereum address");
        return;
      }

      if (newOwner.toLowerCase() === currentOwner.toLowerCase()) {
        notification.error("Cannot transfer to yourself");
        return;
      }

      // Step 1: Blockchain transaction
      setStep("blockchain");
      console.log(`[Transfer] Calling transferFileOwnership on blockchain...`);

      const hash = await writeFileVault({
        functionName: "transferFileOwnership",
        args: [fileHashHex as `0x${string}`, newOwner as `0x${string}`],
      });

      if (!hash) {
        throw new Error("Transaction failed - no tx hash returned");
      }

      setTxHash(hash);
      console.log(`[Transfer] ✅ Blockchain transaction confirmed: ${hash}`);

      // Step 2: Update database
      setStep("database");
      console.log(`[Transfer] Syncing database...`);

      const res = await fetch("/api/files/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHashHex,
          newOwnerAddr: newOwner,
          blockchainTxHash: hash,
        }),
      });

      // --- ERROR HANDLING FIX START ---
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        const text = await res.text();
        console.error("[Transfer] API returned HTML error:", text.slice(0, 500)); // Log first 500 chars
        throw new Error(`API Error: Endpoint not found (404) or Server Error (500). Check console.`);
      }

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Database sync failed (${res.status})`);
      }
      // --- ERROR HANDLING FIX END ---

      console.log(`[Transfer] ✅ Database synced successfully`);

      // Step 3: Done
      setStep("done");
      notification.success("File ownership transferred successfully!");

      // Call success callback if provided
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1500);
      }
    } catch (e: any) {
      console.error("[Transfer] Error:", e);
      notification.error(e?.message || "Transfer failed");
      // Only reset if we haven't finished the blockchain part successfully
      // If blockchain succeeded but DB failed, user might want to see the error state
      if (step !== "done") {
        setStep("input");
      }
    }
  };

  const handleClose = () => {
    if (step === "blockchain" || step === "database") {
      notification.warning("Please wait for the transfer to complete");
      return;
    }
    setNewOwner("");
    setStep("input");
    setTxHash("");
    onClose();
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ArrowRightIcon className="w-6 h-6" />
              Transfer File Ownership
            </h3>
            {filename && <p className="text-sm opacity-60 mt-1">File: {filename}</p>}
          </div>
          <button
            onClick={handleClose}
            className="btn btn-sm btn-circle btn-ghost"
            disabled={step === "blockchain" || step === "database"}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Current Owner */}
        <div className="alert alert-info text-sm mb-4">
          <UserCircleIcon className="w-5 h-5" />
          <div>
            <p className="font-semibold">Current Owner</p>
            <p className="font-mono text-xs">{formatAddress(currentOwner)}</p>
          </div>
        </div>

        {/* Step: Input */}
        {step === "input" && (
          <>
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text font-semibold">New Owner Address</span>
              </label>
              <input
                type="text"
                placeholder="0x..."
                className="input input-bordered font-mono text-sm"
                value={newOwner}
                onChange={e => setNewOwner(e.target.value.trim())}
              />
              <label className="label">
                <span className="label-text-alt">Enter the Ethereum address of the new owner</span>
              </label>
            </div>

            <div className="alert alert-warning text-xs mb-4">
              <span>
                ⚠️ This action is <strong>irreversible</strong>. You will lose all control over this file. The new owner
                will be able to manage access permissions.
              </span>
            </div>

            <div className="modal-action">
              <button onClick={handleClose} className="btn btn-ghost">
                Cancel
              </button>
              <button onClick={handleTransfer} className="btn btn-primary" disabled={!newOwner}>
                Transfer Ownership
              </button>
            </div>
          </>
        )}

        {/* Step: Blockchain Transaction */}
        {step === "blockchain" && (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <p className="font-semibold">Processing Blockchain Transaction...</p>
            <p className="text-sm opacity-60 mt-2">Please confirm in your wallet</p>
          </div>
        )}

        {/* Step: Database Sync */}
        {step === "database" && (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <p className="font-semibold">Syncing Database...</p>
            <p className="text-sm opacity-60 mt-2">Updating ownership records</p>
            {txHash && (
              <p className="text-xs font-mono mt-4 opacity-40">
                Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </p>
            )}
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-bold text-lg mb-2">Transfer Complete!</p>
            <p className="text-sm opacity-60 text-center mb-4">
              File ownership has been transferred to
              <br />
              <span className="font-mono text-primary">{formatAddress(newOwner)}</span>
            </p>
            {txHash && (
              <a
                href={`https://sepolia-optimism.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="link link-primary text-xs"
              >
                View on Etherscan
              </a>
            )}
            <button onClick={handleClose} className="btn btn-primary mt-6">
              Close
            </button>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={handleClose}></div>
    </div>
  );
}
