// packages/nextjs/components/TransferOwnershipModal.tsx
"use client";

import React, { useState } from "react";
import { useAccount } from "wagmi";
import { ArrowRightIcon, UserCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { hexToUint8 } from "~~/lib/bytes";
import { loadDeviceKey } from "~~/lib/deviceKeys";
import { wrapAesKeyForRecipients } from "~~/lib/wrapKeys";
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
  fileHashHex: `0x${string}`;
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
  const { address } = useAccount();
  const [newOwner, setNewOwner] = useState("");
  const [step, setStep] = useState<"input" | "rekey" | "blockchain" | "database" | "done">("input");
  // FIX: Ensure txHash is used or ignored if truly not needed by linter
  const [txHash, setTxHash] = useState("");

  const { writeContractAsync: writeFileVault } = useScaffoldWriteContract({
    contractName: "FileVault",
  });

  const handleTransfer = async () => {
    try {
      if (!address) return;

      if (!newOwner || !/^0x[0-9a-fA-F]{40}$/.test(newOwner)) {
        notification.error("Invalid Ethereum address");
        return;
      }
      if (newOwner.toLowerCase() === currentOwner.toLowerCase()) {
        notification.error("Cannot transfer to yourself");
        return;
      }

      setStep("rekey");
      console.log("[Transfer] Starting crypto handover...");

      const resolveRes = await fetch("/api/users/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [newOwner] }),
      });
      const resolveJson = await resolveRes.json();

      if (!resolveJson.ok || !resolveJson.found?.length) {
        throw new Error("New owner is not registered (Public Key not found). They must login once first.");
      }
      const newOwnerUser = resolveJson.found[0];

      const currentKeyRec = await loadDeviceKey(address, fileHashHex);
      if (!currentKeyRec) {
        throw new Error("Could not decrypt file. You might be missing the key on this device.");
      }

      const [newWrappedKey] = await wrapAesKeyForRecipients(hexToUint8(currentKeyRec.rawKeyHex), [newOwnerUser]);

      console.log("[Transfer] ✅ Crypto handover prepared");

      setStep("blockchain");
      console.log(`[Transfer] Calling transferFileOwnership...`);

      const hash = await writeFileVault({
        functionName: "transferFileOwnership",
        args: [fileHashHex as `0x${string}`, newOwner as `0x${string}`],
      });

      if (!hash) throw new Error("Transaction failed");
      setTxHash(hash);

      setStep("database");
      console.log(`[Transfer] Syncing database...`);

      const res = await fetch("/api/files/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHashHex,
          newOwnerAddr: newOwner,
          blockchainTxHash: hash,
          newEncryptedKey: newWrappedKey,
        }),
      });

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("API Error: 404 or 500. Check console.");
      }

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Database sync failed");

      setStep("done");
      notification.success("Ownership Transferred & Keys Rotated!");
      if (onSuccess) setTimeout(() => onSuccess(), 1500);
    } catch (e: any) {
      console.error("[Transfer] Error:", e);
      notification.error(e?.message || "Transfer failed");
      if (step !== "done") setStep("input");
    }
  };

  const handleClose = () => {
    if (["rekey", "blockchain", "database"].includes(step)) {
      notification.warning("Please wait for the transfer to complete");
      return;
    }
    setNewOwner("");
    setStep("input");
    setTxHash("");
    onClose();
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ArrowRightIcon className="w-6 h-6" /> Transfer Ownership
            </h3>
            {filename && <p className="text-sm opacity-60 mt-1">File: {filename}</p>}
          </div>
          <button
            onClick={handleClose}
            className="btn btn-sm btn-circle btn-ghost"
            disabled={step !== "input" && step !== "done"}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="alert alert-info text-sm mb-4">
          <UserCircleIcon className="w-5 h-5" />
          <div>
            <p className="font-semibold">Current Owner</p>
            <p className="font-mono text-xs">{formatAddress(currentOwner)}</p>
          </div>
        </div>

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
            </div>
            <div className="modal-action">
              <button onClick={handleClose} className="btn btn-ghost">
                Cancel
              </button>
              <button onClick={handleTransfer} className="btn btn-primary" disabled={!newOwner}>
                Transfer
              </button>
            </div>
          </>
        )}

        {step === "rekey" && (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="loading loading-spinner loading-lg text-secondary mb-4"></span>
            <p className="font-semibold">Re-Encrypting Keys...</p>
            <p className="text-sm opacity-60 mt-2">Securing file for new owner</p>
          </div>
        )}

        {step === "blockchain" && (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <p className="font-semibold">Processing Blockchain Transaction...</p>
          </div>
        )}

        {step === "database" && (
          <div className="flex flex-col items-center justify-center py-8">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <p className="font-semibold">Syncing Database...</p>
            <p className="text-sm opacity-60 mt-2">Updating owner and saving new keys</p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-4 text-success">
              ✓
            </div>
            <p className="font-bold text-lg mb-2">Transfer Complete!</p>
            {/* FIX: Ensure txHash is used here to prevent linter error */}
            {txHash && (
              <a
                href={`https://sepolia-optimism.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="link link-primary text-xs mt-2 block"
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
