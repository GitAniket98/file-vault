// packages/nextjs/lib/verifyOnChainAccess.ts

/**
 * SIMPLIFIED BLOCKCHAIN VERIFICATION
 *
 * This module provides simple functions to verify access control
 * against the FileVault smart contract.
 *
 * Usage:
 *   const canAccess = await verifyAccess(fileHash, userAddress);
 *   if (!canAccess) return 403;
 */
import { Address, createPublicClient, http } from "viem";
import { optimismSepolia } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const CHAIN_ID = 11155420; // Optimism Sepolia
const CONTRACT_ADDRESS = deployedContracts[CHAIN_ID].FileVault.address;
const CONTRACT_ABI = deployedContracts[CHAIN_ID].FileVault.abi;

// Create public client for blockchain reads
const publicClient = createPublicClient({
  chain: optimismSepolia,
  transport: http(),
});

/**
 * Convert hex string to bytes32 format
 */
function toBytes32(hex: string): `0x${string}` {
  const normalized = hex.startsWith("0x") ? hex : `0x${hex}`;
  if (normalized.length !== 66) {
    throw new Error("Invalid bytes32 hex string");
  }
  return normalized as `0x${string}`;
}

/**
 * MAIN FUNCTION: Verify if user has access to a file
 *
 * @param fileHashHex - File hash (0x + 64 chars)
 * @param userAddress - User's wallet address
 * @returns true if authorized on blockchain, false otherwise
 */
export async function verifyAccess(fileHashHex: string, userAddress: string): Promise<boolean> {
  try {
    if (!fileHashHex || !userAddress) return false;

    const fileHash = toBytes32(fileHashHex);
    const user = userAddress.toLowerCase() as Address;

    const isAuthorized = await publicClient.readContract({
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: "isAuthorized",
      args: [fileHash, user],
    });

    return isAuthorized as boolean;
  } catch (error) {
    console.error("[blockchainVerify] Error:", error);
    return false; // Fail closed
  }
}

/**
 * Verify if user owns a file
 *
 * @param fileHashHex - File hash
 * @param ownerAddress - Expected owner address
 * @returns true if owner matches on blockchain
 */
export async function verifyOwner(fileHashHex: string, ownerAddress: string): Promise<boolean> {
  try {
    if (!fileHashHex || !ownerAddress) return false;

    const fileHash = toBytes32(fileHashHex);

    const onChainOwner = await publicClient.readContract({
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: "getUploader",
      args: [fileHash],
    });

    return (onChainOwner as string).toLowerCase() === ownerAddress.toLowerCase();
  } catch (error) {
    console.error("[blockchainVerify] Error:", error);
    return false; // Fail closed
  }
}

/**
 * Check if file exists on blockchain
 *
 * @param fileHashHex - File hash
 * @returns true if file exists on-chain
 */
export async function verifyFileExists(fileHashHex: string): Promise<boolean> {
  try {
    if (!fileHashHex) return false;

    const fileHash = toBytes32(fileHashHex);

    const exists = await publicClient.readContract({
      address: CONTRACT_ADDRESS as Address,
      abi: CONTRACT_ABI,
      functionName: "fileExists",
      args: [fileHash],
    });

    return exists as boolean;
  } catch (error) {
    console.error("[blockchainVerify] Error:", error);
    return false;
  }
}

/**
 * Batch verify access for multiple users (performance optimization)
 *
 * @param fileHashHex - File hash
 * @param userAddresses - Array of user addresses
 * @returns Map of address -> authorized status
 */
export async function batchVerifyAccess(fileHashHex: string, userAddresses: string[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  await Promise.all(
    userAddresses.map(async addr => {
      const authorized = await verifyAccess(fileHashHex, addr);
      results.set(addr.toLowerCase(), authorized);
    }),
  );

  return results;
}
