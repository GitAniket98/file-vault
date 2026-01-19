// packages/nextjs/lib/verifyOnChainAccess.ts

/**
 * SIMPLIFIED BLOCKCHAIN VERIFICATION
 * Updated for Optimism Mainnet
 */
import { Address, createPublicClient, http } from "viem";
import { optimism } from "viem/chains";
// 1. CHANGE: Import 'optimism' (Mainnet)
import deployedContracts from "~~/contracts/deployedContracts";

//
const CHAIN_ID = 10;

const CONTRACT_ADDRESS = deployedContracts[CHAIN_ID]?.FileVault?.address;
const CONTRACT_ABI = deployedContracts[CHAIN_ID]?.FileVault?.abi;

if (!CONTRACT_ADDRESS || !CONTRACT_ABI) {
  throw new Error(`Contract not found for chain ID ${CHAIN_ID}. Check deployedContracts.ts`);
}

//
const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const rpcUrl = alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://mainnet.optimism.io";

const publicClient = createPublicClient({
  chain: optimism, // 4. CHANGE: Use Mainnet chain object
  transport: http(rpcUrl),
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
