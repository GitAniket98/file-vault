/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { FileVault } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("FileVault v2 (Upgradeable) Tests", function () {
  let fileVault: FileVault;
  let uploader: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  const fileHash = "0x" + "a".repeat(64);
  const cid = "QmTestCid123456789";
  const newCid = "QmUpdatedCid987654321";

  beforeEach(async () => {
    [uploader, userA, userB, attacker] = await ethers.getSigners();
    const FileVaultFactory = await ethers.getContractFactory("FileVault");
    fileVault = (await upgrades.deployProxy(FileVaultFactory, [], {
      initializer: "initialize",
    })) as unknown as FileVault;
    await fileVault.waitForDeployment();
  });

  describe("1. Core Upload & Initialization", function () {
    it("Should upload file and AUTOMATICALLY authorize the uploader", async function () {
      await expect(fileVault.connect(uploader).storeFileHash(fileHash, cid, [])).to.emit(fileVault, "FileUploaded");

      expect(await fileVault.getUploader(fileHash)).to.equal(uploader.address);
      expect(await fileVault.isAuthorized(fileHash, uploader.address)).to.be.true;
      expect(await fileVault.connect(uploader).getCid(fileHash)).to.equal(cid);
    });

    it("Should authorize initial batch of users on upload", async function () {
      const initialUsers = [userA.address, userB.address];
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, initialUsers);

      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;
      expect(await fileVault.isAuthorized(fileHash, userB.address)).to.be.true;
    });

    it("Should fail if CID is empty", async function () {
      await expect(fileVault.storeFileHash(fileHash, "", [])).to.be.revertedWith("CID cannot be empty");
    });

    it("Should fail if file already exists", async function () {
      await fileVault.storeFileHash(fileHash, cid, []);
      await expect(fileVault.storeFileHash(fileHash, cid, [])).to.be.revertedWith("File already exists");
    });

    it("Should enforce MAX_ALLOWED_USERS limit on upload", async function () {
      const tooManyUsers = Array(101).fill(userA.address);
      await expect(fileVault.storeFileHash(fileHash, cid, tooManyUsers)).to.be.revertedWith("Too many users");
    });
  });

  describe("2. Access Control (Grant/Revoke)", function () {
    beforeEach(async () => {
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, []);
    });

    it("Should allow uploader to grant and revoke access", async function () {
      await expect(fileVault.connect(uploader).grantAccess(fileHash, userA.address))
        .to.emit(fileVault, "AccessGranted")
        .withArgs(fileHash, userA.address);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;

      await expect(fileVault.connect(uploader).revokeAccess(fileHash, userA.address))
        .to.emit(fileVault, "AccessRevoked")
        .withArgs(fileHash, userA.address);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.false;
    });

    it("Should allow uploader to Batch Grant access", async function () {
      const users = [userA.address, userB.address];
      await fileVault.connect(uploader).grantAccessBatch(fileHash, users);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;
      expect(await fileVault.isAuthorized(fileHash, userB.address)).to.be.true;
    });

    it("Should preventing non-uploaders from granting access", async function () {
      await expect(fileVault.connect(attacker).grantAccess(fileHash, attacker.address)).to.be.revertedWith(
        "Not uploader",
      );
    });

    it("Should prevent accessing CID if not authorized", async function () {
      await expect(fileVault.connect(attacker).getCid(fileHash)).to.be.revertedWith(
        "Not authorized to access this file",
      );
    });
  });

  describe("3. Ownership Transfer", function () {
    beforeEach(async () => {
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, []);
    });

    it("Should transfer ownership and auto-grant access to new owner", async function () {
      // UPDATED: Using the new function name
      await expect(fileVault.connect(uploader).transferFileOwnership(fileHash, userA.address))
        .to.emit(fileVault, "FileOwnershipTransferred")
        .withArgs(fileHash, uploader.address, userA.address);

      expect(await fileVault.getUploader(fileHash)).to.equal(userA.address);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;
    });

    it("Should allow NEW owner to grant access", async function () {
      // UPDATED: Using the new function name
      await fileVault.connect(uploader).transferFileOwnership(fileHash, userA.address);

      await expect(fileVault.connect(uploader).grantAccess(fileHash, userB.address)).to.be.revertedWith("Not uploader");

      await fileVault.connect(userA).grantAccess(fileHash, userB.address);
      expect(await fileVault.isAuthorized(fileHash, userB.address)).to.be.true;
    });
  });

  describe("4. File Updates and Deletion", function () {
    beforeEach(async () => {
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, [userA.address]);
    });

    it("Should allow uploader to update CID", async function () {
      await expect(fileVault.connect(uploader).updateCid(fileHash, newCid)).to.emit(fileVault, "FileUpdated");
      expect(await fileVault.connect(uploader).getCid(fileHash)).to.equal(newCid);
    });

    it("Should allow uploader to Delete file", async function () {
      await expect(fileVault.connect(uploader).deleteFile(fileHash)).to.emit(fileVault, "FileDeleted");
      expect(await fileVault.fileExists(fileHash)).to.be.false;
      await expect(fileVault.getCid(fileHash)).to.be.revertedWith("File does not exist");
    });
  });

  describe("5. Security Fixes & Edge Cases", function () {
    it("Should FIX the 'Ghost Access' bug (Access denied after re-upload)", async function () {
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, [userA.address]);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;

      await fileVault.connect(uploader).deleteFile(fileHash);

      await fileVault.connect(uploader).storeFileHash(fileHash, "QmNewCid", []);
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.false;
    });

    it("Should prevent operations on non-existent files", async function () {
      const fakeHash = "0x" + "f".repeat(64);
      await expect(fileVault.getCid(fakeHash)).to.be.revertedWith("File does not exist");
    });
  });

  describe("6. Emergency Stop (Pausable)", function () {
    it("Should allow Owner to Pause and Unpause", async function () {
      await fileVault.connect(uploader).pause();
      await expect(fileVault.connect(uploader).storeFileHash(fileHash, cid, [])).to.be.revertedWithCustomError(
        fileVault,
        "EnforcedPause",
      );

      await fileVault.connect(uploader).unpause();
      await expect(fileVault.connect(uploader).storeFileHash(fileHash, cid, [])).to.not.be.reverted;
    });

    it("Should prevent non-owners from pausing", async function () {
      await expect(fileVault.connect(attacker).pause()).to.be.revertedWithCustomError(
        fileVault,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("7. Upgradeability (Proxy Pattern)", function () {
    it("Should preserve state after upgrading to V2", async function () {
      // 1. Setup V1 Data
      await fileVault.connect(uploader).storeFileHash(fileHash, cid, [userA.address]);

      // Verify V1 state works
      expect(await fileVault.isAuthorized(fileHash, userA.address)).to.be.true;

      // 2. Perform Upgrade
      const FileVaultV2Factory = await ethers.getContractFactory("FileVaultV2");

      // This command upgrades the Proxy to point to the new V2 implementation
      const fileVaultV2 = await upgrades.upgradeProxy(await fileVault.getAddress(), FileVaultV2Factory);
      await fileVaultV2.waitForDeployment();

      // 3. Verify Address is Unchanged
      // The Proxy address users interact with should NEVER change
      expect(await fileVaultV2.getAddress()).to.equal(await fileVault.getAddress());

      // 4. Verify V1 Data Persisted (Crucial!)
      // The file hash, uploader, and authorized users should still be there
      expect(await fileVaultV2.getUploader(fileHash)).to.equal(uploader.address);
      expect(await fileVaultV2.isAuthorized(fileHash, userA.address)).to.be.true;
    });

    it("Should enable NEW V2 features after upgrade", async function () {
      const FileVaultV2Factory = await ethers.getContractFactory("FileVaultV2");
      const fileVaultV2 = await upgrades.upgradeProxy(await fileVault.getAddress(), FileVaultV2Factory);

      // 1. Check new "version" function
      // We cast to 'any' because Typescript doesn't know about V2 methods yet
      expect(await (fileVaultV2 as any).version()).to.equal("v2.0.0");

      // 2. Check new state variable
      await (fileVaultV2 as any).setFeatureName("Dark Mode Support");
      expect(await (fileVaultV2 as any).newFeatureName()).to.equal("Dark Mode Support");
    });
  });
});
