import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys the FileVault smart contract.
 * @notice This contract handles access control for encrypted file storage references.
 */
const deployFileVault: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  log("----------------------------------------------------");
  log("📦 Deploying FileVault contract...");

  const deployment = await deploy("FileVault", {
    from: deployer,
    log: true,
    autoMine: true, // speeds up localhost testing
  });

  log(`✅ FileVault deployed at: ${deployment.address}`);
};

export default deployFileVault;

// Optional tag for selective deployment
deployFileVault.tags = ["FileVault"];
