// packages/nextjs/components/Header.tsx
"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
// 1. Import usePathname
import { useAccount } from "wagmi";
import { Bars3Icon, ExclamationTriangleIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { AppSidebar } from "~~/components/AppSidebar";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

// packages/nextjs/components/Header.tsx

/* ---------------- Registration Badge Component ---------------- */

type RegStatus = "unknown" | "loading" | "registered" | "not-registered";

const RegistrationBadge = () => {
  const { address } = useAccount();
  const pathname = usePathname(); // 2. Get current path
  const [status, setStatus] = useState<RegStatus>("unknown");

  useEffect(() => {
    const check = async () => {
      if (!address) return setStatus("unknown");

      try {
        // Only show loading if we aren't already validated (prevents flickering on every click)
        if (status === "unknown") setStatus("loading");

        // 1. Check Session
        // adding timestamp to prevent browser caching of the API call
        const res = await fetch(`/api/users/me?t=${Date.now()}`);
        const json = await res.json();

        const isSessionValid =
          res.ok && json.registered && json.user?.walletAddr.toLowerCase() === address.toLowerCase();

        if (isSessionValid) {
          setStatus("registered");
        } else {
          // 2. Fallback: Check if address exists in DB
          const checkRes = await fetch(`/api/users/check?walletAddr=${address}&t=${Date.now()}`);
          const checkJson = await checkRes.json();

          setStatus(checkJson.registered ? "not-registered" : "not-registered");
        }
      } catch (error) {
        console.error("Badge check failed:", error);
        setStatus("unknown");
      }
    };

    check();
    // 3. Add pathname to dependency array so it runs on page switch
  }, [address, pathname]);

  if (!address || status === "unknown") return null;

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 bg-base-200 px-3 py-1.5 rounded-full animate-pulse">
        <div className="w-2 h-2 bg-base-content/30 rounded-full" />
        <span className="text-xs font-medium opacity-50">Verifying...</span>
      </div>
    );
  }

  if (status === "not-registered") {
    return (
      <Link
        href="/"
        className="flex items-center gap-2 bg-warning/10 border border-warning/20 px-3 py-1.5 rounded-full hover:bg-warning/20 transition-colors group cursor-pointer"
      >
        <ExclamationTriangleIcon className="w-4 h-4 text-warning" />
        <span className="text-xs font-bold text-warning">Login Required</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-success/10 border border-success/20 px-3 py-1.5 rounded-full">
      <ShieldCheckIcon className="w-4 h-4 text-success" />
      <span className="text-xs font-bold text-success">Secured</span>
    </div>
  );
};

/* ---------------- Main Header ---------------- */

export const Header = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Optional: close sidebar automatically when route changes
  const pathname = usePathname();

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  return (
    <>
      <AppSidebar open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="sticky top-0 z-30 navbar bg-base-100/80 backdrop-blur-md border-b border-base-200 h-16 min-h-[4rem]">
        {/* Left: Sidebar Toggle + Brand */}
        <div className="navbar-start gap-3">
          <button className="btn btn-ghost btn-square" onClick={() => setIsSidebarOpen(true)} aria-label="Open sidebar">
            <Bars3Icon className="w-6 h-6" />
          </button>

          <Link href="/" className="flex items-center gap-2 group">
            {/* Logo Image */}
            <div className="relative w-9 h-9">
              <Image src="/logo.svg" alt="FileVault Logo" fill className="object-contain" priority />
            </div>
            <span className="font-bold text-lg tracking-tight hidden sm:block">FileVault</span>
          </Link>
        </div>

        {/* Center: Empty (Cleaner Look) */}
        <div className="navbar-center hidden md:flex"></div>

        {/* Right: Status + Wallet */}
        <div className="navbar-end gap-3">
          <RegistrationBadge />
          <RainbowKitCustomConnectButton />
          <div className="hidden sm:block">
            <FaucetButton />
          </div>
        </div>
      </div>
    </>
  );
};
