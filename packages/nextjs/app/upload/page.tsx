"use client";

import React, { CSSProperties, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  CheckCircleIcon,
  CloudArrowUpIcon,
  DocumentIcon,
  LockClosedIcon,
  Square2StackIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { bytesToHex } from "~~/lib/bytes";
import { saveDeviceKey } from "~~/lib/deviceKeys";
import { type RecipientUser, wrapAesKeyForRecipients } from "~~/lib/wrapKeys";
import { aesEncryptFile, sha256Hex, uint8ToBlob } from "~~/utils/crypto";
import { pinBlobToIPFS } from "~~/utils/ipfs";
import { notification } from "~~/utils/scaffold-eth";

// --- Types ---

type Step = "idle" | "encrypting" | "pinning" | "wrapping" | "blockchain" | "committing" | "done" | "error";

type ResolvedUser = {
  did: string;
  wallet_addr: string;
  enc_alg: string;
  enc_pubkey_hex: string;
};

type ResolveResponse = { ok: true; found: ResolvedUser[]; missing: string[] } | { ok: false; error: string };

type UserStatus =
  | { state: "unknown" }
  | { state: "loading" }
  | { state: "unregistered" }
  | { state: "registered"; did: string };

type CommitUploadResponse = { ok: boolean; file?: any; wrappedCount?: number; error?: string };

// --- Helper Component: CopyableValue ---
const CopyableValue = ({ label, value, isLink = false }: { label: string; value: string; isLink?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const truncated = value.length > 24 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;

  return (
    <div className="flex justify-between items-center bg-base-200 p-3 rounded-lg text-sm">
      <span className="font-semibold opacity-70">{label}</span>
      <div className="flex items-center gap-2">
        {isLink ? (
          <Link href={value} target="_blank" rel="noreferrer" className="link link-primary font-mono">
            {truncated}
          </Link>
        ) : (
          <span className="font-mono opacity-80">{truncated}</span>
        )}
        <button onClick={handleCopy} className="btn btn-ghost btn-xs">
          {copied ? <CheckCircleIcon className="w-4 h-4 text-success" /> : <Square2StackIcon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};

export default function UploadPage() {
  const { address } = useAccount();
  const [file, setFile] = useState<File | null>(null);
  const [recipients, setRecipients] = useState<string>("");
  const [status, setStatus] = useState<Step>("idle");
  const [message, setMessage] = useState<string>("");

  // Results state
  const [lastCid, setLastCid] = useState<string>("");
  const [lastHash, setLastHash] = useState<string>("");
  const [lastTxHash, setLastTxHash] = useState<string>("");
  const [unregistered, setUnregistered] = useState<string[]>([]);

  const [userStatus, setUserStatus] = useState<UserStatus>({ state: "unknown" });
  const [isDragOver, setIsDragOver] = useState(false);

  const { writeContractAsync: writeFileVault } = useScaffoldWriteContract({
    contractName: "FileVault",
  });

  // Calculate Progress Percentage based on Step
  const getProgress = () => {
    switch (status) {
      case "idle":
        return 0;
      case "encrypting":
        return 15;
      case "pinning":
        return 35;
      case "wrapping":
        return 55;
      case "blockchain":
        return 75;
      case "committing":
        return 90;
      case "done":
        return 100;
      case "error":
        return 0;
      default:
        return 0;
    }
  };

  const progress = getProgress();

  // 1. Check Registration Status (Strict Validation)
  useEffect(() => {
    const checkUser = async () => {
      if (!address) return setUserStatus({ state: "unknown" });
      try {
        setUserStatus({ state: "loading" });

        const res = await fetch(`/api/users/me`);
        const json = await res.json();

        // Check if session exists AND matches connected wallet
        if (!res.ok || !json.ok || !json.registered || json.user?.walletAddr.toLowerCase() !== address.toLowerCase()) {
          setUserStatus({ state: "unregistered" });
        } else {
          setUserStatus({ state: "registered", did: json.user.did });
        }
      } catch (e) {
        console.error(e);
        setUserStatus({ state: "unregistered" });
      }
    };
    checkUser();
  }, [address]);

  // 2. Drag & Drop Handlers
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleUpload = async () => {
    try {
      if (!file || !address) return;

      // File Size Validation
      const limitMB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB) || 10;
      const MAX_BYTES = limitMB * 1024 * 1024;

      if (file.size > MAX_BYTES) {
        setStatus("error");
        setMessage(`File too large!! Max limit is ${limitMB}MB.`);
        return;
      }

      // ============================================
      // STEP 1: Client-Side Encryption
      // ============================================
      setStatus("encrypting");
      setMessage("Encrypting file locally...");

      const enc = await aesEncryptFile(file);
      const fileHash = await sha256Hex(enc.ciphertext);
      const ivHex = bytesToHex(enc.iv);
      setLastHash(fileHash);

      // Save key locally for uploader
      await saveDeviceKey(address, fileHash, {
        rawKeyHex: bytesToHex(enc.rawKey),
        ivHex,
      });

      // ============================================
      // STEP 2: Pin to IPFS
      // ============================================
      setStatus("pinning");
      setMessage("Pinning encrypted data to IPFS...");
      const { cid } = await pinBlobToIPFS(uint8ToBlob(enc.ciphertext), `${file.name}.enc`);
      setLastCid(cid);

      // ============================================
      // STEP 3: Recipient Resolution & Key Wrapping
      // ============================================
      setStatus("wrapping");
      setMessage("Processing access control...");

      const allowed = recipients
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);

      if (allowed.some(a => !/^0x[0-9a-fA-F]{40}$/.test(a))) {
        throw new Error("Invalid recipient address format");
      }

      let wrappedKeysPayload: any[] = [];
      let missingUsers: string[] = [];

      if (allowed.length > 0) {
        const resolveRes = await fetch("/api/users/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: allowed }),
        });
        const resolveJson = (await resolveRes.json()) as ResolveResponse;
        if (!resolveJson.ok) throw new Error(resolveJson.error);

        missingUsers = resolveJson.missing;
        setUnregistered(missingUsers);

        if (resolveJson.found.length > 0) {
          wrappedKeysPayload = await wrapAesKeyForRecipients(enc.rawKey, resolveJson.found as RecipientUser[]);
        }
      }

      // ============================================
      // STEP 4: BLOCKCHAIN TRANSACTION (FIRST!)
      // ============================================
      setStatus("blockchain");
      setMessage("Waiting for blockchain confirmation...");

      let txHash: string | undefined;
      try {
        txHash = await writeFileVault({
          functionName: "storeFileHash",
          args: [fileHash as `0x${string}`, cid, allowed as `0x${string}`[]],
        });

        if (!txHash) {
          throw new Error("Transaction failed - no tx hash returned");
        }

        setLastTxHash(txHash);
        console.log(`✅ Blockchain transaction confirmed: ${txHash}`);
      } catch (chainErr: any) {
        console.error("Blockchain transaction failed:", chainErr);

        // Rollback: Unpin from IPFS since blockchain failed
        await fetch("/api/ipfs/unpin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cid }),
        }).catch(console.error);

        throw new Error(chainErr?.message || "Blockchain transaction failed. Upload cancelled.");
      }

      // ============================================
      // STEP 5: Database Commit (AFTER blockchain)
      // ============================================
      setStatus("committing");
      setMessage("Saving metadata to database...");

      const commitRes = await fetch("/api/files/commit-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileHashHex: fileHash,
          cid,
          ivHex,
          sizeBytes: file.size,
          mimeType: file.type || "application/octet-stream",
          filename: file.name,
          pinProvider: "pinata",
          wrappedKeys: wrappedKeysPayload,
          blockchainTxHash: txHash, // NEW: Include tx hash for tracking
        }),
      });

      const commitJson = (await commitRes.json()) as CommitUploadResponse;

      if (!commitJson.ok) {
        console.error(" Database commit failed:", commitJson.error);
        // Note: File is already on blockchain, so this is less critical
        // We could implement a retry mechanism here
        notification.warning("File uploaded to blockchain but database sync failed. Contact support.");
      }

      // ============================================
      // STEP 6: Success!
      // ============================================
      setStatus("done");
      setMessage("Upload complete!");
      notification.success("File uploaded & secured successfully");
    } catch (e: any) {
      console.error("Upload error:", e);
      setStatus("error");
      setMessage(e?.message || "Upload failed");
      notification.error(e?.message || "Upload failed");
    }
  };

  const reset = () => {
    setFile(null);
    setRecipients("");
    setStatus("idle");
    setMessage("");
    setLastCid("");
    setLastHash("");
    setLastTxHash("");
    setUnregistered([]);
  };

  // --- Rendering ---

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <CloudArrowUpIcon className="w-16 h-16 text-base-content/30" />
        <h1 className="text-2xl font-bold">Secure Upload</h1>
        <p className="max-w-md opacity-70">Please connect your wallet to upload and encrypt files.</p>
      </div>
    );
  }

  if (userStatus.state === "unregistered") {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-base-100 rounded-2xl border border-warning/20 shadow-lg text-center">
        <LockClosedIcon className="w-12 h-12 text-warning mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Registration Required</h2>
        <p className="opacity-70 mb-6">
          To perform secure cryptographic uploads, you must register your device&apos;s encryption key.
        </p>
        <Link href="/" className="btn btn-warning">
          Go to Login
        </Link>
      </div>
    );
  }

  // Upload Success View
  if (status === "done") {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="card bg-base-100 shadow-xl border border-success/20">
          <div className="card-body">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-3">
                <CheckCircleIcon className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-2xl font-bold">Upload Successful!</h2>
              <p className="opacity-60">Your file is encrypted, pinned, and recorded on-chain.</p>
            </div>

            <div className="space-y-3">
              <CopyableValue label="CID" value={lastCid} />
              <CopyableValue label="File Hash" value={lastHash} />
              <CopyableValue label="Tx Hash" value={lastTxHash} isLink />
            </div>

            {unregistered.length > 0 && (
              <div className="alert alert-warning text-sm mt-4">
                <span>
                  Note: Some recipients ({unregistered.length}) were not registered and could not be granted access.
                </span>
              </div>
            )}

            <div className="card-actions justify-center mt-6">
              <button className="btn btn-primary" onClick={reset}>
                Upload Another
              </button>
              <Link href="/files" className="btn btn-outline">
                Go to Vault
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Upload Form View
  return (
    <div className="max-w-3xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-5 gap-8">
      {/* Left Column: File Drop & Form */}
      <div className="lg:col-span-3 space-y-6">
        <h1 className="text-2xl font-bold">Secure Upload</h1>

        {/* Dropzone */}
        {!file ? (
          <div
            onDragOver={e => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-2xl h-64 flex flex-col items-center justify-center transition-all cursor-pointer bg-base-100 ${
              isDragOver ? "border-primary bg-primary/5" : "border-base-300"
            }`}
          >
            <CloudArrowUpIcon className={`w-12 h-12 mb-3 ${isDragOver ? "text-primary" : "text-base-content/20"}`} />
            <p className="font-semibold text-lg">Drag & Drop file here</p>
            <p className="text-sm opacity-50 mb-4">or</p>
            <label className="btn btn-sm btn-outline">
              Browse Files
              <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <p className="text-xs opacity-40 mt-4">
              Max {process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB || 10}MB • AES-256 Encrypted
            </p>
          </div>
        ) : (
          <div className="card bg-base-100 border border-base-200 shadow-sm p-4 flex flex-row items-center gap-4">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
              <DocumentIcon className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-grow overflow-hidden">
              <h3 className="font-bold truncate">{file.name}</h3>
              <p className="text-xs opacity-60">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button onClick={() => setFile(null)} className="btn btn-square btn-sm btn-ghost">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Recipients (Accordion) */}
        <div className="collapse collapse-arrow border border-base-200 bg-base-100 rounded-xl">
          <input type="checkbox" />
          <div className="collapse-title font-medium text-sm"> Grant Access </div>
          <div className="collapse-content">
            <textarea
              className="textarea textarea-bordered w-full text-sm font-mono h-24"
              placeholder="0xAddress1, 0xAddress2..."
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
            />
            <p className="text-xs opacity-60 mt-2">
              Only registered users can be granted access. You can also grant access later from your vault.
            </p>
          </div>
        </div>

        {/* Action Button */}
        <button
          className="btn btn-primary w-full"
          disabled={!file || status !== "idle" || userStatus.state !== "registered"}
          onClick={handleUpload}
        >
          {status === "idle" ? "Encrypt & Upload" : "Processing..."}
        </button>

        {status === "error" && (
          <div className="alert alert-error text-sm">
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* Right Column: Status & Progress */}
      <div className="lg:col-span-2">
        <div className="card bg-base-100 border border-base-200 p-6 h-full flex flex-col">
          <h3 className="font-semibold mb-6">Process Status</h3>

          <ul className="steps steps-vertical w-full text-xs">
            <li className={`step ${status !== "idle" ? "step-primary" : ""}`}>
              <span className="text-left w-full pl-2">Encrypting locally</span>
            </li>
            <li
              className={`step ${["pinning", "wrapping", "blockchain", "committing", "done"].includes(status) ? "step-primary" : ""}`}
            >
              <span className="text-left w-full pl-2">Pinning to IPFS</span>
            </li>
            <li
              className={`step ${["wrapping", "blockchain", "committing", "done"].includes(status) ? "step-primary" : ""}`}
            >
              <span className="text-left w-full pl-2">Access Control</span>
            </li>
            <li className={`step ${["blockchain", "committing", "done"].includes(status) ? "step-primary" : ""}`}>
              <span className="text-left w-full pl-2"> Blockchain Tx</span>
            </li>
            <li className={`step ${["committing", "done"].includes(status) ? "step-primary" : ""}`}>
              <span className="text-left w-full pl-2">Database Sync</span>
            </li>
          </ul>

          <div className="mt-auto flex flex-col items-center justify-center pt-8 min-h-[140px]">
            {status !== "idle" && status !== "error" ? (
              <>
                {/* CIRCULAR PROGRESS BAR */}
                <div
                  className="radial-progress text-primary transition-all duration-500 ease-out"
                  style={{ "--value": progress, "--size": "5rem", "--thickness": "5px" } as CSSProperties}
                  role="progressbar"
                >
                  <span className="text-sm font-bold">{progress}%</span>
                </div>
                <p className="text-xs opacity-60 mt-4 animate-pulse text-center px-4">{message}</p>
              </>
            ) : (
              <div className="text-center opacity-30">
                <div className="w-16 h-16 rounded-full border-4 border-base-300 mx-auto mb-2 flex items-center justify-center">
                  <span className="text-xl font-bold">0%</span>
                </div>
                <p className="text-xs">Ready to start</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
