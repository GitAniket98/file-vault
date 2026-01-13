import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";

/**
 * Deploys the FileVault smart contract using the OpenZeppelin Proxy Pattern.
 * Protocol: ERC-1967 Transparent Proxy
 */
const deployFileVault: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { save, log } = hre.deployments; // Import 'save' to manually update frontend info

  log("----------------------------------------------------");
  log("📦 Deploying FileVault (Proxy + Implementation)...");

  // 1. Get the Contract Factory
  const FileVaultFactory = await ethers.getContractFactory("FileVault");

  // 2. Deploy using OpenZeppelin Upgrades plugin
  // 'initializer: "initialize"' tells the proxy to call this function immediately
  const proxy = await upgrades.deployProxy(FileVaultFactory, [], {
    initializer: "initialize",
  });

  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  log(`✅ FileVault Proxy deployed at: ${proxyAddress}`);

  // 3. CRITICAL: Save artifact for hardhat-deploy / Frontend
  // This ensures your Next.js app knows the Proxy Address but uses the Implementation ABI
  const artifact = await hre.artifacts.readArtifact("FileVault");

  await save("FileVault", {
    address: proxyAddress,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  });

  log("💾 Artifact saved for Frontend integration");
  log("----------------------------------------------------");
};

export default deployFileVault;

// Tag for selective deployment
deployFileVault.tags = ["FileVault"];
