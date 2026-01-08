// packages/nextjs/app/register/page.tsx
"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
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

type Step = "idle" | "authenticating" | "generating_keys" | "registering" | "done" | "error";
type KeyStep = "idle" | "exporting" | "importing";

export default function RegisterPage() {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<Step>("idle");
  const [message, setMessage] = useState<string>("");

  const [keyStatus, setKeyStatus] = useState<KeyStep>("idle");
  const [keyMessage, setKeyMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveChainId = chainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID || "31337");

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

      // --- STEP 1: AUTHENTICATE (SIWE) ---
      // We must log in first to get the HttpOnly Session Cookie.
      // 1. Get Nonce
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ walletAddr: address }),
      });
      const { nonce } = await nonceRes.json();
      if (!nonce) throw new Error("Failed to fetch login nonce");

      // 2. Sign Message
      const loginMsg = `FileVault login:\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message: loginMsg });

      // 3. Verify & Set Cookie
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddr: address, signature }),
      });

      if (!verifyRes.ok) {
        throw new Error("Login failed. Signature rejected.");
      }

      // --- STEP 2: PREPARE KEYS ---
      setStatus("generating_keys");
      setMessage("Generating secure device keys...");

      // Ensure device has an ECDH P-256 keypair stored locally
      const { pubJwk } = await ensureDeviceEncKeyPair();
      const encAlg = "ECDH-ES+A256GCM"; // Standardized alg name
      const encPubkeyJson = JSON.stringify(pubJwk);

      // --- STEP 3: REGISTER ---
      setStatus("registering");
      setMessage("Saving public key to account...");

      // Call backend to persist registration
      // Note: We don't need to send the signature again.
      // The backend will trust us because of the Session Cookie from Step 1.
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

      setStatus("done");
      setMessage("Registration complete! Redirecting...");
      notification.success("Registration Successful");

      // Redirect to dashboard after short delay
      setTimeout(() => {
        router.push("/files");
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setStatus("error");
      setMessage(e?.message || "Something went wrong during registration");
    }
  }

  // --- Existing Key Management Logic (Unchanged) ---

  async function handleExportKeys() {
    try {
      setKeyStatus("exporting");
      setKeyMessage("");

      const record = await exportDeviceEncKeyRecord();
      if (!record) {
        setKeyStatus("idle");
        setKeyMessage("No device encryption key found yet. Run registration at least once.");
        return;
      }

      const payload = {
        version: 1,
        createdAt: new Date().toISOString(),
        note: "FileVault device encryption key backup. Keep this file secret.",
        data: record as DeviceEncKeyRecord,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "wallet";
      a.href = url;
      a.download = `filevault-device-key-${shortAddr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setKeyStatus("idle");
      setKeyMessage("Device key backup downloaded. Store it securely (e.g. password manager).");
    } catch (e: any) {
      console.error(e);
      setKeyStatus("idle");
      setKeyMessage(e?.message || "Failed to export device key");
    }
  }

  function handleImportClick() {
    setKeyMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      setKeyStatus("importing");
      setKeyMessage("");

      const text = await file.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Backup file is not valid JSON");
      }

      if (!payload || typeof payload !== "object" || !payload.data) {
        throw new Error("Backup JSON missing `data` field");
      }

      const record = payload.data as DeviceEncKeyRecord;
      await importDeviceEncKeyRecord(record);

      setKeyStatus("idle");
      setKeyMessage("Device encryption key restored from backup. You can now decrypt old shared files again.");
    } catch (e: any) {
      console.error(e);
      setKeyStatus("idle");
      setKeyMessage(e?.message || "Failed to import device key backup");
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Register for FileVault</h1>

      {!address && (
        <div className="alert alert-warning">
          <span>Please connect your wallet using the header connect button, then come back here.</span>
        </div>
      )}

      {address && (
        <p className="text-sm opacity-80">
          You are connected as <code className="break-all">{address}</code>
          <br />
          Chain ID: <code>{effectiveChainId}</code>
        </p>
      )}

      {/* Registration card */}
      <div className="p-4 rounded-2xl border space-y-3 shadow-sm bg-base-100">
        <p className="text-sm font-medium">Registration Steps:</p>
        <ul className="steps steps-vertical lg:steps-horizontal w-full text-xs opacity-90 my-2">
          <li className={`step ${status !== "idle" ? "step-primary" : ""}`}>Sign In</li>
          <li
            className={`step ${status === "generating_keys" || status === "registering" || status === "done" ? "step-primary" : ""}`}
          >
            Generate Keys
          </li>
          <li className={`step ${status === "registering" || status === "done" ? "step-primary" : ""}`}>
            Save Profile
          </li>
        </ul>

        <div className="divider my-0"></div>

        <button
          className="btn btn-primary w-full mt-2"
          onClick={handleRegister}
          disabled={!address || (status !== "idle" && status !== "error")}
        >
          {status === "idle" && "Initialize Account"}
          {status === "authenticating" && "Check Wallet for Signature..."}
          {status === "generating_keys" && "Generating Secure Keys..."}
          {status === "registering" && "Saving Profile..."}
          {status === "done" && "Success! Redirecting..."}
          {status === "error" && "Retry Registration"}
        </button>

        {message && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm text-center ${status === "error" ? "bg-error/10 text-error" : "bg-base-200"}`}
          >
            {message}
          </div>
        )}
      </div>

      {/* Backup / Restore card */}
      <div className="collapse collapse-arrow border rounded-2xl">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-semibold">Advanced: Backup & Restore Keys</div>
        <div className="collapse-content space-y-3">
          <p className="text-xs opacity-80">
            Your device encryption key is what lets you unwrap AES file keys. If you switch browsers, you must restore
            this key to view your files.
          </p>

          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <button
              className="btn btn-sm btn-outline flex-1"
              onClick={handleExportKeys}
              disabled={keyStatus === "exporting"}
            >
              {keyStatus === "exporting" ? "Exporting…" : "Download Backup"}
            </button>

            <button
              className="btn btn-sm btn-outline flex-1"
              onClick={handleImportClick}
              disabled={keyStatus === "importing"}
            >
              {keyStatus === "importing" ? "Importing…" : "Restore from Backup"}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />

          {keyMessage && <div className="mt-2 text-xs bg-base-200 p-2 rounded">{keyMessage}</div>}
        </div>
      </div>
    </div>
  );
}
