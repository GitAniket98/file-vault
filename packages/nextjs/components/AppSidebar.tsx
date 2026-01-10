// packages/nextjs/components/AppSidebar.tsx
"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import {
  ArrowRightStartOnRectangleIcon,
  CloudArrowUpIcon,
  FolderIcon,
  HomeIcon,
  KeyIcon,
  ShareIcon,
  WalletIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// packages/nextjs/components/AppSidebar.tsx

// --- Configuration ---

const mainLinks = [
  { label: "Overview", href: "/", icon: <HomeIcon className="w-5 h-5" /> },
  { label: "Secure Upload", href: "/upload", icon: <CloudArrowUpIcon className="w-5 h-5" /> },
  { label: "My Vault", href: "/files", icon: <FolderIcon className="w-5 h-5" /> },
  { label: "Shared with Me", href: "/files/shared", icon: <ShareIcon className="w-5 h-5" /> },
];

const systemLinks = [{ label: "Key Management", href: "/settings/keys", icon: <KeyIcon className="w-5 h-5" /> }];

// --- Components ---

function NavItem({
  label,
  href,
  icon,
  onClick,
}: {
  label: string;
  href: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
          isActive
            ? "bg-primary text-primary-content shadow-md shadow-primary/20 font-medium"
            : "text-base-content/70 hover:bg-base-200 hover:text-base-content"
        }`}
      >
        <span className={isActive ? "" : "opacity-70 group-hover:opacity-100"}>{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  useOutsideClick(panelRef, () => {
    if (open) onClose();
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* Slide-over Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 left-0 bottom-0 w-72 bg-base-100 z-50 shadow-2xl transform transition-transform duration-300 ease-in-out border-r border-base-200 flex flex-col ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between border-b border-base-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Image src="/logo.svg" alt="FileVault" width={24} height={24} />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-none">FileVault</h2>
              <p className="text-xs opacity-50 mt-1">Secure Workspace</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Area (With Blur Guard) */}
        <div className="flex-1 relative overflow-hidden">
          {/* 1. The Actual Content (Blurred if locked) */}
          <div
            className={`h-full overflow-y-auto py-6 px-3 space-y-8 transition-all duration-300 ${!isConnected ? "blur-sm opacity-50 pointer-events-none select-none" : ""}`}
          >
            {/* Main Group */}
            <div>
              <div className="px-4 mb-2 text-xs font-bold uppercase tracking-wider opacity-40">Storage</div>
              <ul className="space-y-1">
                {mainLinks.map(link => (
                  <NavItem key={link.href} {...link} onClick={onClose} />
                ))}
              </ul>
            </div>

            {/* System Group */}
            <div>
              <div className="px-4 mb-2 text-xs font-bold uppercase tracking-wider opacity-40">System</div>
              <ul className="space-y-1">
                {systemLinks.map(link => (
                  <NavItem key={link.href} {...link} onClick={onClose} />
                ))}
              </ul>
            </div>
          </div>

          {/* 2. The Lock Overlay (Only visible if disconnected) */}
          {!isConnected && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mb-4 shadow-inner">
                <WalletIcon className="w-8 h-8 text-base-content/40" />
              </div>
              <h3 className="font-bold text-lg mb-2">Wallet Locked</h3>
              <p className="text-xs opacity-60 mb-6">Connect your wallet to access the secure file system.</p>
              <button onClick={openConnectModal} className="btn btn-primary w-full shadow-lg">
                Connect Wallet
              </button>
            </div>
          )}
        </div>

        {/* Footer / User Profile */}
        <div className="p-4 border-t border-base-200 bg-base-50 shrink-0">
          {address ? (
            <div className="flex items-center gap-3 p-3 bg-base-100 rounded-xl border border-base-200 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold text-xs">
                {address.slice(2, 4)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">Connected</p>
                <p className="text-xs opacity-50 truncate font-mono">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </p>
              </div>
              <button
                onClick={() => disconnect()}
                className="btn btn-ghost btn-xs btn-square text-error"
                title="Disconnect"
              >
                <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="text-center p-4">
              <p className="text-xs opacity-50">Guest Mode</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
