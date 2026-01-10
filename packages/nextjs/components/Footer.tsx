// packages/nextjs/components/Footer.tsx
import React from "react";
import Link from "next/link";
import { hardhat } from "viem/chains";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Site footer
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      {/* Floating Tools Layer (Theme Switcher + Dev Tools) */}
      <div className="fixed flex justify-between items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
        <div className="flex flex-col md:flex-row gap-2 pointer-events-auto">
          {/* Dev Tools: Only visible on Localhost */}
          {isLocalNetwork && (
            <>
              <Faucet />
              <Link href="/blockexplorer" passHref className="btn btn-primary btn-sm font-normal gap-1">
                <MagnifyingGlassIcon className="h-4 w-4" />
                <span>Explorer</span>
              </Link>
            </>
          )}
        </div>

        <SwitchTheme className={`pointer-events-auto ${isLocalNetwork ? "self-end md:self-auto" : ""}`} />
      </div>

      {/* Static Footer Content */}
      <div className="w-full">
        <div className="flex justify-center items-center gap-2 text-sm w-full opacity-50">
          <div className="text-center">
            <span className="font-bold">FileVault</span> &copy; {new Date().getFullYear()}
          </div>
          <span>·</span>
          <div className="text-center text-xs">End-to-End Encrypted Storage</div>
        </div>
      </div>
    </div>
  );
};
