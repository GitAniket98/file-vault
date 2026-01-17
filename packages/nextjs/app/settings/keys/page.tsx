"use client";

import React, { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { DeviceEncKeyRecord, exportDeviceEncKeyRecord, importDeviceEncKeyRecord } from "~~/lib/deviceEncKeys";
import { getAllKeysForUser, importBulkKeys } from "~~/lib/deviceKeys";
import { notification } from "~~/utils/scaffold-eth";

type Step = "idle" | "exporting" | "importing";

export default function SettingsKeysPage() {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<Step>("idle");

  // Validate session on load: Ensures the user is logged in with the connected wallet
  useEffect(() => {
    const checkSession = async () => {
      if (!address) return;
      const res = await fetch("/api/users/me");
      const json = await res.json();
      if (json.registered && json.user?.walletAddr.toLowerCase() !== address.toLowerCase()) {
        notification.error("Wallet mismatch. Please re-login.");
      }
    };
    if (isConnected) checkSession();
  }, [address, isConnected]);

  // Handle Export: Creates a full backup of Identity Key + All File Keys
  async function handleExport() {
    if (!address) return;

    try {
      setStatus("exporting");

      // 1. Fetch Identity Key (ECDH) for CURRENT USER
      const identityRecord = await exportDeviceEncKeyRecord(address);
      if (!identityRecord) {
        throw new Error("No device identity key found. You must Register first.");
      }

      // 2. Fetch ALL File Keys (AES) for CURRENT USER
      // These keys are namespaced by '0xAddress_hash' in IndexedDB
      const fileKeys = await getAllKeysForUser(address);
      const fileKeyCount = Object.keys(fileKeys).length;

      // 3. Create Full Backup Payload (V3 Format)
      const payload = {
        type: "filevault-full-backup",
        version: 3, // Bumped version for wallet-aware backup
        createdAt: new Date().toISOString(),
        walletAddr: address.toLowerCase(), // Identity Check Metadata
        note: "FileVault Full Backup. KEEP PRIVATE.",
        data: {
          identity: identityRecord,
          fileKeys: fileKeys,
        },
      };

      // 4. Trigger Download
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Standardized Filename: fv-backup-0x1234-DATE.json
      a.download = `fv-backup-${address.slice(0, 6)}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      notification.success(`Backup created: Identity + ${fileKeyCount} File Keys`);
    } catch (e: any) {
      console.error(e);
      notification.error(e.message || "Failed to export keys");
    } finally {
      setStatus("idle");
    }
  }

  // Handle Import: Restores keys from JSON file into IndexedDB
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    if (!address) return;

    try {
      const file = e.target.files?.[0];
      if (!file) return;

      setStatus("importing");
      const text = await file.text();

      // 1. Parse & Validate JSON
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON file");
      }

      // Detect Format: V3 (Full) or Legacy (Identity Only)
      const isV2 = parsed.type === "filevault-full-backup";
      const isLegacyIdentity = !isV2 && parsed.data && parsed.data.pubJwk;

      if (!isV2 && !isLegacyIdentity) {
        throw new Error("Unknown backup format. Missing 'data.pubJwk' or 'filevault-full-backup' type.");
      }

      // 2. Identity Safety Check
      // Warns user if they try to import keys belonging to a different wallet
      if (parsed.walletAddr && parsed.walletAddr.toLowerCase() !== address.toLowerCase()) {
        const confirm = window.confirm(
          ` WALLET MISMATCH \n\n` +
            `Backup Owner: ${parsed.walletAddr}\n` +
            `Current User: ${address}\n\n` +
            `Restoring this might overwrite your keys. Continue?`,
        );
        if (!confirm) throw new Error("Restore cancelled.");
      }

      // 3. Restore Identity Key (Namespaced)
      const identityData = isV2 ? parsed.data.identity : parsed.data;
      if (!identityData?.pubJwk) throw new Error("Invalid identity key data");

      await importDeviceEncKeyRecord(address, identityData as DeviceEncKeyRecord);

      // 4. Restore File Keys (Namespaced via keys themselves)
      let restoredCount = 0;
      if (isV2 && parsed.data.fileKeys) {
        // Bulk import handles the '0xAddress_hash' prefix logic
        await importBulkKeys(parsed.data.fileKeys);
        restoredCount = Object.keys(parsed.data.fileKeys).length;
      }

      notification.success(
        isV2 ? `Restored Identity + ${restoredCount} File Keys` : "Restored Identity Key (Legacy Backup)",
      );

      e.target.value = "";
    } catch (err: any) {
      console.error(err);
      notification.error(err.message || "Failed to import keys");
      e.target.value = "";
    } finally {
      setStatus("idle");
    }
  }

  // --- Render: Wallet Not Connected ---
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <KeyIcon className="w-16 h-16 text-base-content/30" />
        <h1 className="text-2xl font-bold">Security Settings</h1>
        <p className="max-w-md opacity-70">Connect your wallet to manage your encryption keys.</p>
      </div>
    );
  }

  // --- Render: Main Settings Page ---
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-base-300 pb-6">
        <div className="p-3 bg-primary/10 rounded-full">
          <ShieldCheckIcon className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Key Management</h1>
          <p className="text-sm opacity-60">Manage your device keys and file access.</p>
        </div>
      </div>

      {/* Info Alert */}
      <div className="alert alert-info shadow-sm">
        <ExclamationTriangleIcon className="w-6 h-6" />
        <div>
          <h3 className="font-bold">Full Vault Backup</h3>
          <div className="text-xs">
            This backup includes your <strong>Identity Key</strong> AND all <strong>File Encryption Keys</strong> for
            this wallet. Restoring this file will recover access to all your uploads.
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* EXPORT CARD */}
        <div className="card bg-base-100 shadow-lg border border-base-200">
          <div className="card-body">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <ArrowDownTrayIcon className="w-6 h-6 text-primary" />
              </div>
              <h2 className="card-title">Backup Everything</h2>
            </div>

            <p className="text-sm opacity-70 flex-grow">
              Download a secure JSON file containing all keys needed to decrypt your files.
              <strong>Keep this safe.</strong>
            </p>

            <div className="card-actions justify-end mt-4">
              <button onClick={handleExport} disabled={status !== "idle"} className="btn btn-primary w-full">
                {status === "exporting" ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  "Download Full Backup"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* IMPORT CARD */}
        <div className="card bg-base-100 shadow-lg border border-base-200">
          <div className="card-body">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-base-200 rounded-lg">
                <ArrowUpTrayIcon className="w-6 h-6 text-base-content/70" />
              </div>
              <h2 className="card-title">Restore Vault</h2>
            </div>

            <p className="text-sm opacity-70 flex-grow">
              Restore your access by importing a backup file. Only restore backups created for this specific wallet.
            </p>

            <div className="card-actions justify-end mt-4">
              <label className={`btn btn-outline w-full ${status !== "idle" ? "btn-disabled" : ""}`}>
                {status === "importing" ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  "Select Backup File"
                )}
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImport}
                  disabled={status !== "idle"}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs opacity-40 mt-8">
        Connected Wallet: <span className="font-mono">{address}</span>
      </div>
    </div>
  );
}
