// packages/nextjs/app/files/shared/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  DocumentIcon,
  LockClosedIcon,
  PhotoIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { decryptFileFromIpfs, unwrapFileAesKeyForRecipient } from "~~/lib/recipientDecrypt";
import { notification } from "~~/utils/scaffold-eth";

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// packages/nextjs/app/files/shared/page.tsx

// --- Types ---

// Represents a file that has been shared specifically with the current user
type SharedFileRow = {
  fileHashHex: string | null;
  ivHex: string | null;
  recipientDid: string;
  algorithm: string;
  keyVersion: number;
  wrappedKeyHex: string | null; // Encrypted AES key (wrapped with my public key)
  ephemeralPubHex: string | null; // Ephemeral key for ECDH unwrap
  cid: string;
  mimeType: string | null;
  filename: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

type ApiResponse = { ok: true; rows: SharedFileRow[] } | { ok: false; error: string };

export default function FilesSharedWithMePage() {
  const { address, isConnected } = useAccount();
  const [rows, setRows] = useState<SharedFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Fetch files on load (and when wallet changes)
  useEffect(() => {
    // Reset on switch
    setRows([]);
    if (isConnected && address) fetchSharedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  const fetchSharedFiles = async () => {
    try {
      setLoading(true);

      // 1. Strict Session Check
      // We must ensure the backend session matches the wallet address currently connected.
      const meRes = await fetch("/api/users/me");
      const meJson = await meRes.json();

      if (!meRes.ok || !meJson.registered || meJson.user?.walletAddr.toLowerCase() !== address?.toLowerCase()) {
        throw new Error("Wallet mismatch. Please login via Overview.");
      }

      // 2. Fetch Data (Only files shared with MY DID)
      const res = await fetch("/api/files/for-recipient", {
        method: "POST",
      });

      const json = (await res.json()) as ApiResponse;
      if (!json.ok) {
        throw new Error(json.error);
      }

      setRows(json.rows || []);
    } catch (e: any) {
      console.error(e);
      if (e.message.includes("mismatch")) {
        notification.error("Session invalid. Please re-login at Home.");
      } else {
        notification.error("Failed to load shared files");
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle Decryption: Unwrap AES Key -> Decrypt File
  const handleDecrypt = async (row: SharedFileRow) => {
    if (!address) return;
    const rowId = row.fileHashHex ?? row.cid;

    try {
      setBusyId(rowId);

      if (!row.wrappedKeyHex || !row.ephemeralPubHex || !row.ivHex) {
        throw new Error("Missing cryptographic metadata for this file");
      }

      // 1. Unwrap Key (Client-Side ECDH)
      // Uses the receiver's private Identity Key (stored in IndexedDB)
      // combined with the sender's ephemeral public key to derive the AES key.
      // Pass 'address' to select the correct Identity Key.
      const fileKey = await unwrapFileAesKeyForRecipient(address, row.wrappedKeyHex, row.ephemeralPubHex);

      // 2. Decrypt File Content from IPFS
      const blob = await decryptFileFromIpfs(row.cid, fileKey, row.ivHex, row.mimeType);

      // 3. Trigger Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.filename || `shared-${row.cid.slice(0, 8)}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      notification.success("File decrypted & downloaded");
    } catch (e: any) {
      console.error(e);
      let msg = e?.message || "Decryption failed";

      // User-friendly error for wrong key
      if (msg.includes("OperationError") || msg.includes("InvalidAccessError")) {
        msg = "Device key mismatch. Please ensure you have restored the correct backup for this wallet.";
      }
      notification.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  // Helper to choose an icon based on MIME type
  const getFileIcon = (mime: string | null) => {
    if (mime?.startsWith("image/")) return <PhotoIcon className="w-8 h-8 text-secondary" />;
    return <DocumentIcon className="w-8 h-8 text-primary" />;
  };

  // --- Rendering ---

  // 1. Wallet Not Connected
  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <LockClosedIcon className="w-16 h-16 text-base-content/30" />
        <h1 className="text-2xl font-bold">Encrypted Storage</h1>
        <p className="max-w-md opacity-70">Connect your wallet to access secure files shared with you.</p>
      </div>
    );
  }

  // 2. Main Shared Files Grid
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShieldCheckIcon className="w-8 h-8 text-success" />
            Shared With Me
          </h1>
          <p className="text-sm opacity-60 mt-1">Files securely encrypted for your DID. Only you can decrypt them.</p>
        </div>
        <button onClick={fetchSharedFiles} disabled={loading} className="btn btn-ghost btn-sm gap-2">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Empty State */}
      {!loading && rows.length === 0 && (
        <div className="card bg-base-100 border-2 border-dashed border-base-300 p-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <DocumentIcon className="w-12 h-12 text-base-content/20" />
            <h3 className="font-semibold text-lg">No shared files found</h3>
            <p className="text-sm opacity-60 max-w-sm">
              When someone securely shares a file with your wallet address, it will appear here.
            </p>
          </div>
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(row => {
          const rowId = row.fileHashHex ?? row.cid;
          const isBusy = busyId === rowId;
          const dateStr = row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "Unknown date";
          const sizeStr = row.sizeBytes ? `${(row.sizeBytes / 1024 / 1024).toFixed(2)} MB` : "Unknown size";

          return (
            <div
              key={rowId}
              className="card bg-base-100 shadow-sm border border-base-200 hover:shadow-md transition-shadow"
            >
              <div className="card-body p-5">
                {/* Card Header: Icon + Name */}
                <div className="flex items-start gap-3 mb-2">
                  <div className="p-2 bg-base-200 rounded-lg">{getFileIcon(row.mimeType)}</div>
                  <div className="overflow-hidden">
                    <h3 className="font-semibold truncate" title={row.filename || "Untitled"}>
                      {row.filename || "Untitled File"}
                    </h3>
                    <p className="text-xs opacity-50 truncate font-mono">
                      {row.mimeType || "application/octet-stream"}
                    </p>
                  </div>
                </div>

                {/* Metadata Tags */}
                <div className="flex flex-wrap gap-2 text-xs opacity-70 my-2">
                  <span className="badge badge-ghost badge-sm">{sizeStr}</span>
                  <span className="badge badge-ghost badge-sm">{dateStr}</span>
                </div>

                {/* Actions */}
                <div className="card-actions justify-end mt-auto pt-2">
                  <button
                    onClick={() => handleDecrypt(row)}
                    disabled={isBusy}
                    className="btn btn-primary btn-sm w-full gap-2"
                  >
                    {isBusy ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    )}
                    {isBusy ? "Decrypting..." : "Decrypt & Download"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="text-center text-xs opacity-40 mt-12 max-w-2xl mx-auto">
        Decryption happens entirely in your browser using your local device key. If you switch browsers, you must
        restore your key from{" "}
        <Link href="/settings/keys" className="underline hover:opacity-100">
          Settings
        </Link>
        .
      </div>
    </div>
  );
}
