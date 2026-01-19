"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowUpTrayIcon,
  CloudArrowUpIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  KeyIcon,
  LockClosedIcon,
  ShareIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { type DeviceEncKeyRecord, hasKeyForUser, importDeviceEncKeyRecord } from "~~/lib/deviceEncKeys";
import { notification } from "~~/utils/scaffold-eth";

// Define the state machine for user authentication/connection status
type UserState =
  | "loading" // Checking session/keys
  | "guest" // Wallet not connected
  | "unregistered" // Wallet connected but not in DB
  | "registered_new_device" // In DB, but missing local browser keys (needs restore/login)
  | "active"; // Fully authenticated with keys ready

export default function Home() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();

  const [userState, setUserState] = useState<UserState>("loading");
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Effect: Validates session and determines UserState whenever wallet connection changes
  useEffect(() => {
    const checkStatus = async () => {
      if (!isConnected || !address) {
        setUserState("guest");
        return;
      }

      try {
        setUserState("loading");

        // 1. Check current backend session (prevent caching to ensure fresh auth state)
        const meRes = await fetch("/api/users/me", { cache: "no-store" });
        const meJson = await meRes.json();

        // Local state trackers to handle logic linearly without recursion
        let isSessionActive = meRes.ok && meJson.registered;
        let sessionWallet = meJson.user?.walletAddr?.toLowerCase();
        const currentWallet = address.toLowerCase();

        // LOGIC BRANCH 1: Wallet Mismatch (Auto-Logout)
        // Detects if user switched MetaMask accounts while a previous session cookie existed
        if (isSessionActive && sessionWallet && sessionWallet !== currentWallet) {
          console.log("Wallet switch detected. Logging out previous session...");

          // Kill the session on server-side
          await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });

          // Update local trackers to fall through to DB check
          isSessionActive = false;
          sessionWallet = null;
        }

        // LOGIC BRANCH 2: Session Valid & Matches Wallet
        if (isSessionActive && sessionWallet === currentWallet) {
          // Check if this specific browser has the encryption keys for this user
          const hasKeys = await hasKeyForUser(address);
          // If keys exist -> Active; If missing -> Prompt restore
          setUserState(hasKeys ? "active" : "registered_new_device");
          return;
        }

        // LOGIC BRANCH 3: No Active Session. Check DB Registration.
        const checkRes = await fetch(`/api/users/check?walletAddr=${address}`, { cache: "no-store" });
        const checkJson = await checkRes.json();

        if (checkJson.registered) {
          // User is registered in DB, needs to Login (SIWE) and/or Restore Keys
          setUserState("registered_new_device");
        } else {
          // User not found in DB -> Registration Flow
          setUserState("unregistered");
        }
      } catch (e) {
        console.error("Status check failed", e);
        setUserState("guest");
      }
    };

    checkStatus();
  }, [isConnected, address]);

  // Handle SIWE (Sign-In With Ethereum) Login
  const handleLogin = async () => {
    if (!address) return;
    try {
      const toastId = notification.loading("Authenticating...");

      // 1. Get Nonce
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ walletAddr: address }),
      });
      const { nonce } = await nonceRes.json();
      if (!nonce) throw new Error("Failed to fetch login nonce");

      // 2. Sign Message
      const msg = `FileVault login:\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ message: msg });

      // 3. Verify & Set Cookie
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddr: address, signature }),
      });

      if (!verifyRes.ok) throw new Error("Login failed");

      notification.remove(toastId);
      notification.success("Logged in successfully");

      // Re-evaluate state after login (usually moves to Active if keys are present)
      const hasKeys = await hasKeyForUser(address);
      setUserState(hasKeys ? "active" : "registered_new_device");
    } catch (e: any) {
      console.error(e);
      notification.error(e.message || "Login failed");
    }
  };

  // Handle Backup File Upload (.json) to restore encryption keys
  const handleRestoreKeys = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!address) {
      notification.error("Please connect wallet first");
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsRestoring(true);
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON");
      }

      // Support V2 (Full Backup) and V1 (Legacy) formats
      const isV2 = parsed.type === "filevault-full-backup";
      const record = isV2 ? parsed.data.identity : parsed.data;

      // Import key into IndexedDB namespaced by current wallet address
      await importDeviceEncKeyRecord(address, record as DeviceEncKeyRecord);

      notification.success("Keys restored!");
      // Auto-trigger login after successful restore to sync session
      await handleLogin();
    } catch (err: any) {
      console.error(err);
      notification.error("Failed to restore keys");
    } finally {
      setIsRestoring(false);
      e.target.value = "";
    }
  };

  // --- RENDERING ---

  // 1. Loading State
  if (userState === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <span className="text-sm opacity-50">Verifying identity...</span>
      </div>
    );
  }

  // 2. Returning User State (Registered but missing Session or Keys)
  if (userState === "registered_new_device") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
          <KeyIcon className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
        <p className="text-lg opacity-70 max-w-md mb-8">
          This wallet is registered, but we need to verify your session.
        </p>

        <div className="card bg-base-100 shadow-xl border border-base-200 w-full max-w-md">
          <div className="card-body gap-4">
            {/* Login Button (SIWE) */}
            <button onClick={handleLogin} className="btn btn-primary w-full shadow-lg">
              Login to Vault
            </button>

            <div className="divider text-xs opacity-50">OR</div>

            {/* Restore Keys Input */}
            <div className="form-control">
              <label className={`btn btn-outline w-full ${isRestoring ? "loading" : ""}`}>
                <ArrowUpTrayIcon className="w-5 h-5 mr-2" />
                {isRestoring ? "Restoring..." : "Restore Keys from Backup"}
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleRestoreKeys}
                  disabled={isRestoring}
                />
              </label>
              <p className="text-[10px] opacity-40 mt-2">
                Only needed if you are on a new device or cleared your browser data.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Active Dashboard State (Fully Authenticated)
  if (userState === "active") {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
              My Vault
            </h1>
            <p className="text-base opacity-60 mt-2">Secure, decentralized, encrypted storage.</p>
          </div>
          <div className="flex items-center gap-2 bg-base-200 rounded-full px-4 py-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
            <span className="opacity-70">Session Active</span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Upload Card */}
          <Link
            href="/upload"
            className="md:col-span-2 bg-base-100 border border-base-200 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all rounded-3xl p-8 group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <CloudArrowUpIcon className="w-48 h-48" />
            </div>
            <div className="relative z-10 h-full flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
                  <CloudArrowUpIcon className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-2xl font-bold">Secure Upload</h2>
                <p className="mt-2 opacity-60 max-w-md">Encrypt files locally and pin to IPFS.</p>
              </div>
              <div className="mt-8 flex items-center gap-2 text-primary font-semibold">
                Upload New <ArrowRightIcon className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </Link>

          {/* Files Card */}
          <Link
            href="/files"
            className="bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-secondary/30 transition-all rounded-3xl p-8 group flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center mb-4">
                <FolderIcon className="w-6 h-6 text-secondary" />
              </div>
              <h2 className="text-xl font-bold">My Files</h2>
              <p className="mt-2 text-sm opacity-60">Access your encrypted files.</p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm opacity-70 group-hover:opacity-100 transition-opacity">
              View Vault <ArrowRightIcon className="w-3 h-3" />
            </div>
          </Link>

          {/* Shared Card */}
          <Link
            href="/files/shared"
            className="bg-base-100 border border-base-200 shadow-sm hover:shadow-lg hover:border-accent/30 transition-all rounded-3xl p-8 group flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center mb-4">
                <ShareIcon className="w-6 h-6 text-accent" />
              </div>
              <h2 className="text-xl font-bold">Shared</h2>
              <p className="mt-2 text-sm opacity-60">Files shared with your DID.</p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm opacity-70 group-hover:opacity-100 transition-opacity">
              Inbox <ArrowRightIcon className="w-3 h-3" />
            </div>
          </Link>

          {/* Identity/Settings Card */}
          <div className="md:col-span-2 bg-base-200/50 rounded-3xl p-6 flex items-center justify-between border border-base-200">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-base-100 rounded-full">
                <ShieldCheckIcon className="w-6 h-6 text-success" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Identity Secured</h3>
                <p className="text-xs opacity-60">
                  Connected as {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
              </div>
            </div>
            <Link href="/settings/keys" className="btn btn-sm btn-ghost">
              Manage Keys
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 4. Unregistered State (New User)
  if (userState === "unregistered") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
        <div className="w-20 h-20 bg-warning/10 rounded-full flex items-center justify-center mb-6 animate-bounce">
          <UserPlusIcon className="w-10 h-10 text-warning" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mb-4">Initialize Account</h1>
        <p className="text-lg opacity-70 max-w-lg mb-8">
          You are connected, but you need to generate secure encryption keys to start using FileVault.
        </p>
        <Link href="/register" className="btn btn-primary px-8 shadow-lg">
          Setup Secure Account <ArrowRightIcon className="w-4 h-4 ml-2" />
        </Link>
        <div className="mt-8 pt-6 border-t border-base-200 w-full max-w-xs">
          <p className="text-xs opacity-50 mb-2">Already have an account?</p>
          <button
            onClick={() => setUserState("registered_new_device")}
            className="btn btn-xs btn-ghost gap-1 opacity-70 hover:opacity-100"
          >
            <ArrowPathIcon className="w-3 h-3" />I have a backup file
          </button>
        </div>
      </div>
    );
  }

  // 5. Guest View (Landing Page)
  return (
    <div className="flex flex-col items-center px-4 pt-16 pb-24">
      {/* Hero Section */}
      <section className="text-center max-w-3xl mx-auto space-y-6 mb-20 relative">
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-primary/20 rounded-full blur-3xl opacity-50 pointer-events-none"></div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-base-200 border border-base-300 text-xs font-medium opacity-80 mb-4">
          <span className="w-2 h-2 rounded-full bg-accent"></span>
          Decentralized Storage Protocol
        </div>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-tight">
          Your Data. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            Only Your Eyes.
          </span>
        </h1>
        <p className="text-xl opacity-70 leading-relaxed max-w-2xl mx-auto">
          End-to-end encryption meets blockchain access control.
        </p>
        <div className="flex justify-center pt-4">
          <button
            onClick={openConnectModal}
            className="btn btn-primary px-8 h-12 shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all"
          >
            Connect Wallet to Start
          </button>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto w-full">
        <div className="card bg-base-100 border border-base-200 shadow-sm p-6 hover:-translate-y-1 transition-transform">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
            <LockClosedIcon className="w-6 h-6 text-primary" />
          </div>
          <h3 className="font-bold text-lg mb-2">Client-Side Encryption</h3>
          <p className="text-sm opacity-70">
            Files are encrypted in your browser using AES-GCM before they ever touch the network.
          </p>
        </div>
        <div className="card bg-base-100 border border-base-200 shadow-sm p-6 hover:-translate-y-1 transition-transform">
          <div className="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center mb-4">
            <DocumentDuplicateIcon className="w-6 h-6 text-secondary" />
          </div>
          <h3 className="font-bold text-lg mb-2">IPFS Storage</h3>
          <p className="text-sm opacity-70">
            Encrypted data is pinned to IPFS, ensuring decentralized, resilient storage.
          </p>
        </div>
        <div className="card bg-base-100 border border-base-200 shadow-sm p-6 hover:-translate-y-1 transition-transform">
          <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
            <ShieldCheckIcon className="w-6 h-6 text-accent" />
          </div>
          <h3 className="font-bold text-lg mb-2">On-Chain Access</h3>
          <p className="text-sm opacity-70">Grant access to specific wallet addresses via smart contracts.</p>
        </div>
      </section>
    </div>
  );
}
