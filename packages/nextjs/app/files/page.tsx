// /packages/nextjs/app/files/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  ArrowDownTrayIcon,
  ArrowRightIcon, // Added this
  CheckCircleIcon,
  ClockIcon,
  DocumentIcon,
  KeyIcon,
  LockClosedIcon,
  PhotoIcon,
  Square2StackIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import AuditLogModal from "~~/components/AuditLogModal";
import TransferOwnershipModal from "~~/components/TransferOwnershipModal";
// Added this
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { hexToUint8 } from "~~/lib/bytes";
import { loadDeviceKey } from "~~/lib/deviceKeys";
import { type RecipientUser, wrapAesKeyForRecipients } from "~~/lib/wrapKeys";
import { aesDecryptToBlob } from "~~/utils/crypto";
import { notification } from "~~/utils/scaffold-eth";

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// /packages/nextjs/app/files/page.tsx

// --- Types ---
type FileRow = {
  id: string;
  file_hash: string;
  cid: string;
  iv: string | null;
  uploader_did: string | null;
  uploader_addr: string;
  size_bytes: number | null;
  mime_type: string | null;
  filename: string | null;
  pin_status: string | null;
  pin_provider: string | null;
  pinned: boolean | null;
  created_at: string;
  tx_hash?: string | null;
};

type FilesApiResponse = { ok: true; files: FileRow[] } | { ok: false; error: string };

type RecipientRow = {
  recipientDid: string;
  walletAddr: string;
  algorithm: string;
  keyVersion: number;
  createdAt: string;
};

type RecipientsApiResponse = { ok: true; recipients: RecipientRow[] } | { ok: false; error: string };

type ResolveUser = {
  did: string;
  wallet_addr: string;
  enc_alg: string;
  enc_pubkey_hex: string;
};

type ResolveResponse = { ok: true; found: ResolveUser[]; missing: string[] } | { ok: false; error: string };

// --- Helper Components ---
const CopyableValue = ({ label, value, isLink = false }: { label: string; value: string | null; isLink?: boolean }) => {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncated = value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm">
      <span className="font-semibold text-base-content/70 w-24">{label}:</span>
      <div className="flex items-center gap-2 bg-base-200 px-2 py-1 rounded-md">
        {isLink ? (
          <a href={value} target="_blank" rel="noreferrer" className="link link-primary font-mono text-xs">
            {truncated}
          </a>
        ) : (
          <span className="font-mono text-xs">{truncated}</span>
        )}
        <button onClick={handleCopy} className="btn btn-ghost btn-xs p-0 min-h-0 h-auto" title="Copy full value">
          {copied ? <CheckCircleIcon className="w-4 h-4 text-success" /> : <Square2StackIcon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};

export default function FilesPage() {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // State for Delete Action
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const { writeContractAsync: writeFileVault } = useScaffoldWriteContract({
    contractName: "FileVault",
  });

  // Access Management State
  const [accessFile, setAccessFile] = useState<FileRow | null>(null);
  const [accessRecipients, setAccessRecipients] = useState<RecipientRow[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [addrToGrant, setAddrToGrant] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);

  // Audit Log State
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [selectedFileHash, setSelectedFileHash] = useState("");
  const [selectedFilename, setSelectedFilename] = useState("");

  // Transfer Ownership State
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [fileToTransfer, setFileToTransfer] = useState<{
    fileHashHex: `0x${string}`;
    filename: string;
    currentOwner: string;
  } | null>(null);

  const ipfsGatewayBase = "https://gateway.pinata.cloud/ipfs";

  useEffect(() => {
    setFiles([]);
    setError(null);
    if (!isConnected || !address) return;
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const meRes = await fetch("/api/users/me");
      const meJson = await meRes.json();

      if (!meRes.ok || !meJson.registered || meJson.user?.walletAddr.toLowerCase() !== address?.toLowerCase()) {
        throw new Error("Wallet mismatch. Please return to Overview to login.");
      }

      const res = await fetch(`/api/files/by-uploader`);
      const json = (await res.json()) as FilesApiResponse;

      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(!json.ok ? json.error : `HTTP error ${res.status}`);
      }
      setFiles(json.files);
    } catch (e: any) {
      console.error(e);
      if (e.message.includes("mismatch")) {
        setError("Session invalid for this wallet. Please go to Home to login.");
      } else {
        setError(e?.message || "Failed to load files");
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper to normalize hash
  function computeFileHashHex(file: FileRow): `0x${string}` | null {
    if (!file.file_hash) return null;
    const raw = file.file_hash.startsWith("\\x") ? `0x${file.file_hash.slice(2)}` : file.file_hash;
    return /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw as `0x${string}`) : null;
  }

  // ---- Logic: Open Transfer Modal ----
  const openTransferModal = (file: FileRow) => {
    const fileHashHex = computeFileHashHex(file);
    if (!fileHashHex) return notification.error("Invalid file hash");

    setFileToTransfer({
      fileHashHex,
      filename: file.filename || "Untitled",
      currentOwner: file.uploader_addr,
    });
    setTransferModalOpen(true);
  };

  // ---- Logic: Delete File ----
  async function handleDelete(file: FileRow) {
    if (!confirm("Are you sure? This will delete the file from the blockchain and storage.")) return;

    const fileHashHex = computeFileHashHex(file);
    if (!fileHashHex) return notification.error("Invalid file hash");

    try {
      setIsDeleting(file.id);

      // 1. On-Chain Delete
      await writeFileVault({
        functionName: "deleteFile",
        args: [fileHashHex],
      });

      // 2. Off-Chain Cleanup
      const res = await fetch("/api/files/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileHashHex, cid: file.cid }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Cleanup failed");

      notification.success("File deleted successfully");
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e: any) {
      console.error("Delete error:", e);
      notification.error(e.message || "Failed to delete file");
    } finally {
      setIsDeleting(null);
    }
  }

  // ---- Logic: Client-Side Decryption ----
  async function handleDecrypt(file: FileRow) {
    if (!address) return;
    try {
      if (!file.cid) throw new Error("No CID available");
      const fileHashHex = computeFileHashHex(file);
      if (!fileHashHex) throw new Error("Invalid hash");

      const keyRec = await loadDeviceKey(address, fileHashHex);
      if (!keyRec) {
        notification.error("No local encryption key found on this device.");
        return;
      }

      const toastId = notification.loading("Fetching & Decrypting...");
      const res = await fetch(`${ipfsGatewayBase}/${file.cid}`);
      if (!res.ok) throw new Error("IPFS fetch failed");
      const ciphertext = new Uint8Array(await res.arrayBuffer());

      const mimeType = file.mime_type || "application/octet-stream";
      const blob = await aesDecryptToBlob(ciphertext, hexToUint8(keyRec.ivHex), hexToUint8(keyRec.rawKeyHex), mimeType);

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (file.filename || "decrypted.bin").replace(/\.(enc|cipher)$/i, "");
      document.body.appendChild(a);
      a.click();
      a.remove();

      notification.remove(toastId);
      notification.success("Decrypted successfully");
    } catch (e: any) {
      console.error(e);
      notification.error("Decryption failed: " + e.message);
    }
  }

  // ---- Logic: Access Management ----
  async function loadRecipients(file: FileRow) {
    const fileHashHex = computeFileHashHex(file);
    if (!fileHashHex) throw new Error("Invalid fileHash");

    const res = await fetch(`/api/files/recipients?fileHashHex=${encodeURIComponent(fileHashHex)}`);
    const json = (await res.json()) as RecipientsApiResponse;
    if (!json.ok) throw new Error(json.error);
    setAccessRecipients(json.recipients);
  }

  async function openManageAccess(file: FileRow) {
    try {
      setAccessFile(file);
      setAccessLoading(true);
      setAccessError(null);
      setAccessRecipients([]);
      await loadRecipients(file);
    } catch (e: any) {
      setAccessError(e.message);
    } finally {
      setAccessLoading(false);
    }
  }

  async function handleGrant() {
    if (!accessFile || !address) return;
    const fileHashHex = computeFileHashHex(accessFile);
    if (!fileHashHex) return setAccessError("Invalid file hash");

    const addr = addrToGrant.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return setAccessError("Invalid EVM address");

    try {
      setGrantBusy(true);
      setAccessError(null);

      const res = await fetch("/api/users/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [addr] }),
      });
      const resolveJson = (await res.json()) as ResolveResponse;
      if (!resolveJson.ok || !resolveJson.found.length) {
        throw new Error("User not found or not registered.");
      }
      const user = resolveJson.found[0] as ResolveUser & RecipientUser;

      const keyRec = await loadDeviceKey(address, fileHashHex);
      if (!keyRec) throw new Error("Local encryption key not found. Cannot grant access.");

      const [wrapped] = await wrapAesKeyForRecipients(hexToUint8(keyRec.rawKeyHex), [user]);

      await writeFileVault({
        functionName: "grantAccess",
        args: [fileHashHex, addr as `0x${string}`],
      });

      const wrapRes = await fetch("/api/files/wrap-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileHashHex, wrappedKeys: [wrapped] }),
      });
      if (!wrapRes.ok) throw new Error("Failed to save wrapped key.");

      await loadRecipients(accessFile);
      setAddrToGrant("");
      notification.success("Access granted!");
    } catch (e: any) {
      setAccessError(e.message);
    } finally {
      setGrantBusy(false);
    }
  }

  async function handleRevoke(r: RecipientRow) {
    if (!accessFile) return;
    const fileHashHex = computeFileHashHex(accessFile);
    if (!fileHashHex) return;

    try {
      setRevokeBusyId(r.recipientDid);

      await writeFileVault({
        functionName: "revokeAccess",
        args: [fileHashHex, r.walletAddr as `0x${string}`],
      });

      await fetch("/api/files/revoke-recipient", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileHashHex, recipientDid: r.recipientDid }),
      });

      await loadRecipients(accessFile);
      notification.success("Access revoked");
    } catch (e: any) {
      setAccessError(e.message);
    } finally {
      setRevokeBusyId(null);
    }
  }

  const getFileIcon = (mime: string | null) => {
    if (mime?.startsWith("image/")) return <PhotoIcon className="w-8 h-8 text-secondary" />;
    return <DocumentIcon className="w-8 h-8 text-primary" />;
  };

  const formatSize = (bytes: number | null) => {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <LockClosedIcon className="w-16 h-16 text-base-content/30" />
        <h1 className="text-2xl font-bold">Encrypted Storage</h1>
        <p className="opacity-60 text-center max-w-md">Please connect your wallet.</p>
      </div>
    );
  }

  if (error && error.includes("Session invalid")) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <LockClosedIcon className="w-16 h-16 text-error mb-4" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="opacity-70 mt-2 max-w-md">You switched wallets. Please re-login.</p>
        <Link href="/" className="btn btn-primary mt-6">
          Go to Overview
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex justify-between items-end border-b border-base-300 pb-4">
        <div>
          <h1 className="text-3xl font-bold">My Vault</h1>
          <p className="text-sm opacity-60 mt-1">Manage, secure, and share your uploaded files.</p>
        </div>
        <Link href="/upload" className="btn btn-primary btn-sm gap-2">
          Upload New
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="text-center py-16 bg-base-100 rounded-3xl border-2 border-dashed border-base-200">
          <DocumentIcon className="w-16 h-16 mx-auto text-base-content/20 mb-4" />
          <h3 className="text-lg font-bold">Your vault is empty</h3>
          <p className="text-sm opacity-50 mb-4">Upload your first secure file to get started.</p>
          <Link href="/upload" className="btn btn-outline btn-sm">
            Go to Upload
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {files.map(file => (
          <div
            key={file.id}
            className="collapse collapse-arrow bg-base-100 border border-base-200 shadow-sm rounded-xl overflow-hidden"
          >
            <input type="checkbox" />

            <div className="collapse-title flex items-center gap-4 p-4 pr-12">
              <div className="p-3 bg-base-200 rounded-xl">{getFileIcon(file.mime_type)}</div>
              <div className="flex-grow min-w-0">
                <h3 className="font-bold text-lg truncate pr-4">{file.filename || "Untitled File"}</h3>
                <div className="flex gap-2 text-xs opacity-60 mt-1">
                  <span className="badge badge-ghost badge-sm font-mono">{formatSize(file.size_bytes)}</span>
                  <span>{new Date(file.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 z-10" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => handleDecrypt(file)}
                  className="btn btn-sm btn-ghost gap-2 hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Decrypt
                </button>
                <button
                  onClick={() => openManageAccess(file)}
                  className="btn btn-sm btn-ghost gap-2 hover:bg-secondary/10 hover:text-secondary transition-colors"
                >
                  <UserGroupIcon className="w-4 h-4" /> Access
                </button>
                <button
                  onClick={() => openTransferModal(file)}
                  className="btn btn-sm btn-ghost gap-2 hover:bg-accent/10 hover:text-accent transition-colors"
                >
                  <ArrowRightIcon className="w-4 h-4" /> Transfer
                </button>
                <button
                  onClick={() => {
                    setSelectedFileHash(file.file_hash);
                    setSelectedFilename(file.filename || "Untitled");
                    setAuditModalOpen(true);
                  }}
                  className="btn btn-ghost btn-sm gap-2"
                >
                  <ClockIcon className="w-4 h-4" />
                  View History
                </button>
              </div>
            </div>

            <div className="collapse-content border-t border-base-200 bg-base-50/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 pt-4 px-2">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase opacity-50 tracking-wider">File Metadata</h4>
                  <CopyableValue label="CID" value={file.cid} />
                  <CopyableValue
                    label="File Hash"
                    value={
                      file.file_hash
                        ? file.file_hash.startsWith("\\x")
                          ? "0x" + file.file_hash.slice(2)
                          : file.file_hash
                        : null
                    }
                  />
                  {file.tx_hash && <CopyableValue label="Tx Hash" value={file.tx_hash} isLink />}

                  <div className="flex items-center gap-2 text-sm mt-2">
                    <span className="font-semibold text-base-content/70 w-24">IPFS Link:</span>
                    <a
                      href={`${ipfsGatewayBase}/${file.cid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link link-primary text-xs truncate"
                    >
                      View Raw Encrypted Data
                    </a>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2 justify-between">
                  {/* Mobile Actions */}
                  <div className="sm:hidden flex flex-col gap-2">
                    <button onClick={() => handleDecrypt(file)} className="btn btn-primary btn-sm w-full">
                      Decrypt & Download
                    </button>
                    <button onClick={() => openManageAccess(file)} className="btn btn-outline btn-sm w-full">
                      Manage Access
                    </button>
                    <button onClick={() => openTransferModal(file)} className="btn btn-outline btn-sm w-full">
                      <ArrowRightIcon className="w-4 h-4" /> Transfer Ownership
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFileHash(file.file_hash);
                        setSelectedFilename(file.filename || "Untitled");
                        setAuditModalOpen(true);
                      }}
                      className="btn btn-ghost btn-sm w-full gap-2 border border-base-300"
                    >
                      <ClockIcon className="w-4 h-4" /> View History
                    </button>
                  </div>

                  {/* DELETE BUTTON  */}
                  <div className="flex justify-end mt-4">
                    <button
                      onClick={() => handleDelete(file)}
                      disabled={isDeleting === file.id}
                      className="btn btn-sm btn-ghost text-error gap-2 hover:bg-error/10"
                    >
                      {isDeleting === file.id ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <TrashIcon className="w-4 h-4" />
                      )}
                      Delete File
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Access Modal  */}
      {accessFile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-base-200 flex justify-between items-center bg-base-200/50 rounded-t-2xl">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <KeyIcon className="w-5 h-5 text-secondary" /> Manage Access
                </h2>
                <p className="text-xs opacity-60 font-mono mt-1 truncate max-w-[250px]">{accessFile.filename}</p>
              </div>
              <button onClick={() => setAccessFile(null)} className="btn btn-sm btn-circle btn-ghost">
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {accessLoading && (
                <div className="flex justify-center">
                  <span className="loading loading-spinner" />
                </div>
              )}
              {accessError && (
                <div className="alert alert-error text-sm py-2 rounded-lg">
                  <span>{accessError}</span>
                </div>
              )}

              <div className="bg-base-200/50 p-4 rounded-xl border border-base-200">
                <label className="label text-xs font-bold uppercase opacity-60 pt-0">Grant New Access</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="0x... (Recipient Address)"
                    className="input input-bordered input-sm flex-grow font-mono"
                    value={addrToGrant}
                    onChange={e => setAddrToGrant(e.target.value)}
                  />
                  <button onClick={handleGrant} disabled={grantBusy || !addrToGrant} className="btn btn-primary btn-sm">
                    {grantBusy ? <span className="loading loading-spinner loading-xs" /> : "Grant"}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                  Users with access <span className="badge badge-sm">{accessRecipients.length}</span>
                </h3>
                {accessRecipients.length === 0 ? (
                  <div className="text-center py-8 opacity-50 border-2 border-dashed border-base-200 rounded-xl">
                    <UserGroupIcon className="w-8 h-8 mx-auto mb-1" />
                    <span className="text-xs">Only you can access this file</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accessRecipients.map(r => (
                      <div
                        key={r.recipientDid}
                        className="flex justify-between items-center p-3 bg-base-100 border border-base-200 rounded-lg"
                      >
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-bold">
                            {r.walletAddr.slice(0, 6)}...{r.walletAddr.slice(-4)}
                          </span>
                          <span className="text-[10px] opacity-50">
                            Granted: {new Date(r.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRevoke(r)}
                          disabled={revokeBusyId === r.recipientDid}
                          className="btn btn-xs btn-outline btn-error hover:!text-white"
                        >
                          {revokeBusyId === r.recipientDid ? "Revoking..." : "Revoke"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Modal */}
      <AuditLogModal
        isOpen={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        fileHashHex={selectedFileHash}
        filename={selectedFilename}
      />

      {/* Transfer Ownership Modal */}
      {fileToTransfer && (
        <TransferOwnershipModal
          isOpen={transferModalOpen}
          onClose={() => {
            setTransferModalOpen(false);
            setFileToTransfer(null);
          }}
          fileHashHex={fileToTransfer.fileHashHex}
          filename={fileToTransfer.filename}
          currentOwner={fileToTransfer.currentOwner}
          onSuccess={() => {
            setTransferModalOpen(false);
            setFileToTransfer(null);
            fetchFiles(); // Refresh file list to remove transferred file
          }}
        />
      )}
    </div>
  );
}
