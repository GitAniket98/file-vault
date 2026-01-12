// packages/nextjs/app/register/page.tsx
"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { ArrowDownTrayIcon, ArrowRightIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import {
  type DeviceEncKeyRecord,
  ensureDeviceEncKeyPair,
  exportDeviceEncKeyRecord,
  importDeviceEncKeyRecord,
} from "~~/lib/deviceEncKeys";
import { notification } from "~~/utils/scaffold-eth";

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// packages/nextjs/app/register/page.tsx

// UI States for the registration flow
type Step = "idle" | "authenticating" | "generating_keys" | "registering" | "success" | "error";
type KeyStep = "idle" | "exporting" | "importing";

export default function RegisterPage() {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<Step>("idle");
  const [message, setMessage] = useState<string>("");

  const [keyStatus, setKeyStatus] = useState<KeyStep>("idle");
  const [keyMessage, setKeyMessage] = useState<string>("");
  const [hasBackedUp, setHasBackedUp] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveChainId = chainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");

  // Core Registration Logic: SIWE -> KeyGen -> Backend Register
  async function handleRegister() {
    try {
      if (!address) {
        setMessage("Please connect your wallet first.");
        setStatus("error");
        return;
      }

      setStatus("authenticating");
      setMessage("Please sign the login message to authenticate...");
      setKeyMessage("");

      // 1. Authenticate (SIWE Flow)
      // Get nonce -> Sign message -> Verify with backend -> Set Session Cookie
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ walletAddr: address }),
      });
      const { nonce } = await nonceRes.json();
      if (!nonce) throw new Error("Failed to fetch login nonce");

      const loginMsg = `FileVault login:\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message: loginMsg });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddr: address, signature }),
      });

      if (!verifyRes.ok) throw new Error("Login failed. Signature rejected.");

      // 2. Generate Local Keys
      setStatus("generating_keys");
      setMessage("Generating secure device keys...");

      // Generate ECDH P-256 keypair in IndexedDB
      // Pass 'address' to namespace this key to the current wallet
      const { pubJwk } = await ensureDeviceEncKeyPair(address);
      const encAlg = "ECDH-ES+A256GCM";
      const encPubkeyJson = JSON.stringify(pubJwk);

      // 3. Register User (DID)
      setStatus("registering");
      setMessage("Saving public key to account...");

      const res = await fetch("/api/users/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encAlg,
          encPubkeyHex: encPubkeyJson,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `Register failed with status ${res.status}`);
      }

      setStatus("success");
      setMessage("Account created successfully!");
      notification.success("Account Initialized");
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setMessage(e?.message || "Something went wrong during registration");
    }
  }

  // --- Key Management  ---

  async function handleExportKeys() {
    if (!address) return;
    try {
      setKeyStatus("exporting");

      const record = await exportDeviceEncKeyRecord(address);
      if (!record) {
        setKeyStatus("idle");
        notification.error("No keys found.");
        return;
      }

      // Generate Standard V3 Backup JSON

      const payload = {
        type: "filevault-full-backup",
        version: 3,
        createdAt: new Date().toISOString(),
        walletAddr: address.toLowerCase(),
        note: "FileVault Identity Backup. KEEP PRIVATE.",
        data: {
          identity: record,
          fileKeys: {}, // Empty because this is a fresh account
        },
      };

      // Trigger Download
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fv-backup-${address.slice(0, 6)}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setKeyStatus("idle");
      setHasBackedUp(true); // Enable "Continue" button
      notification.success("Backup downloaded");
    } catch (e: any) {
      console.error(e);
      setKeyStatus("idle");
      notification.error("Export failed");
    }
  }

  function handleImportClick() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!address) return;
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      setKeyStatus("importing");
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON");
      }

      // Handle V2 (Full Backup) vs Legacy formats
      const isV2 = parsed.type === "filevault-full-backup";
      const record = isV2 ? parsed.data.identity : parsed.data;

      if (!record || !record.pubJwk) throw new Error("Invalid backup format");

      // Import key into current wallet namespace
      await importDeviceEncKeyRecord(address, record as DeviceEncKeyRecord);

      setKeyStatus("idle");
      setKeyMessage("Keys restored successfully.");
      notification.success("Keys restored");
    } catch (e: any) {
      console.error(e);
      setKeyStatus("idle");
      setKeyMessage(e?.message || "Import failed");
    }
  }

  // --- RENDERING ---

  // 1. Success View: Forces user to download backup
  if (status === "success") {
    return (
      <div className="max-w-xl mx-auto p-6 mt-10">
        <div className="card bg-base-100 shadow-xl border border-success/20">
          <div className="card-body text-center items-center">
            <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircleIcon className="w-10 h-10 text-success" />
            </div>
            <h2 className="card-title text-2xl mb-2">You are ready!</h2>
            <p className="opacity-70 mb-6">
              Your secure identity has been generated.
              <br />
              <strong>You must save your key now</strong>. This file is the ONLY way to recover your data if you switch
              browsers.
            </p>

            <button
              onClick={handleExportKeys}
              className={`btn btn-primary w-full max-w-sm gap-2 ${hasBackedUp ? "btn-outline" : "shadow-lg animate-bounce"}`}
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
              Download Recovery Kit
            </button>

            {hasBackedUp && (
              <div className="mt-6 w-full max-w-sm animate-fade-in">
                <button onClick={() => router.push("/files")} className="btn btn-success w-full gap-2 text-white">
                  Continue to Vault
                  <ArrowRightIcon className="w-5 h-5" />
                </button>
              </div>
            )}

            {!hasBackedUp && <p className="text-xs text-error mt-4">Please download your key to continue.</p>}
          </div>
        </div>
      </div>
    );
  }

  // 2. Normal Registration Form
  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Register for FileVault</h1>

      {!address && (
        <div className="alert alert-warning">
          <span>Please connect your wallet first.</span>
        </div>
      )}

      {address && (
        <p className="text-sm opacity-80">
          Connected:{" "}
          <code className="bg-base-200 px-1 rounded">
            {address.slice(0, 6)}...{address.slice(-4)}
          </code>
        </p>
      )}

      {/* Main Action Card */}
      <div className="p-6 rounded-2xl border space-y-4 shadow-sm bg-base-100">
        <ul className="steps w-full text-xs opacity-80">
          <li className={`step ${status !== "idle" ? "step-primary" : ""}`}>Sign In</li>
          <li
            className={`step ${["generating_keys", "registering", "success"].includes(status) ? "step-primary" : ""}`}
          >
            Keys
          </li>
          <li className={`step ${["registering", "success"].includes(status) ? "step-primary" : ""}`}>Register</li>
        </ul>

        <button
          className="btn btn-primary w-full"
          onClick={handleRegister}
          disabled={!address || (status !== "idle" && status !== "error")}
        >
          {status === "idle" ? "Initialize Account" : "Processing..."}
        </button>

        {message && (
          <div
            className={`text-center text-sm p-2 rounded ${status === "error" ? "bg-error/10 text-error" : "opacity-60"}`}
          >
            {message}
          </div>
        )}
      </div>

      {/* Collapsible: Restore Existing Backup */}
      <div className="collapse collapse-arrow border rounded-xl">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-medium">Already have a backup file?</div>
        <div className="collapse-content">
          <button onClick={handleImportClick} className="btn btn-sm btn-outline w-full">
            Restore from Backup
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          {keyMessage && <p className="text-xs mt-2 opacity-70">{keyMessage}</p>}
        </div>
      </div>
    </div>
  );
}
