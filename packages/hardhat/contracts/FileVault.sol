// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/// @title FileVault
/// @notice Stores encrypted file references (hash + CID) and manages access with security improvements
/// @dev Implements Access Control logic with Upgradeability, Pausability, and Versioning support
contract FileVault is Initializable, OwnableUpgradeable, PausableUpgradeable {
    struct File {
        address uploader; // Who uploaded the file
        string cid; // IPFS CID of the encrypted file
        // @dev Changed from bool to uint256 to support O(1) invalidation on re-upload
        mapping(address => uint256) authorizedVersion;
        uint256 version; // Increments on re-upload to invalidate old users
        uint256 userCount; // Tracks active users to strictly enforce limits
        bool exists; // Flag to check if file exists
    }

    // Constants for security limits
    uint256 public constant MAX_ALLOWED_USERS = 100;

    // Mapping: fileHash (SHA-256 of encrypted file) => File struct
    mapping(bytes32 => File) private files;

    /// @dev Events for frontend/backends to track changes
    event FileUploaded(bytes32 indexed fileHash, string cid, address indexed uploader, address[] allowedUsers);
    event FileUpdated(bytes32 indexed fileHash, string newCid, address indexed uploader);
    event FileDeleted(bytes32 indexed fileHash, address indexed uploader);
    event AccessGranted(bytes32 indexed fileHash, address indexed user);
    event AccessRevoked(bytes32 indexed fileHash, address indexed user);
    event FileOwnershipTransferred(bytes32 indexed fileHash, address indexed previousOwner, address indexed newOwner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents the implementation contract from being initialized directly
        _disableInitializers();
    }

    /// @notice Initializes the contract (replaces constructor for upgradeable pattern)
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
    }

    /// @notice Emergency stop for all write operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume contract operations
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Upload a new file reference (CID + hash) and set initial access list
    /// @dev If re-uploading a previously deleted file, it increments version to wipe old access.
    /// @param fileHash SHA-256 hash of the encrypted file
    /// @param cid IPFS CID of the encrypted file
    /// @param allowedUsers List of addresses initially granted access
    function storeFileHash(
        bytes32 fileHash,
        string calldata cid,
        address[] calldata allowedUsers
    ) external whenNotPaused {
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(allowedUsers.length <= MAX_ALLOWED_USERS, "Too many users");

        File storage f = files[fileHash];

        // If file exists and is active, we cannot overwrite it.
        require(!f.exists, "File already exists");

        f.uploader = msg.sender;
        f.cid = cid;
        f.exists = true;

        // Increments version (Fixes "Ghost Permission" bug).
        // If this file was deleted and re-uploaded, version goes 1 -> 2.
        // Old users still have 'authorizedVersion' 1, so they lose access automatically.
        f.version++;
        f.userCount = 0;

        // Automatically grant access to uploader
        _grantAccessInternal(f, fileHash, msg.sender);

        // Grant access to allowed users (with duplicate and zero address checks)
        for (uint256 i = 0; i < allowedUsers.length; i++) {
            _grantAccessInternal(f, fileHash, allowedUsers[i]);
        }

        emit FileUploaded(fileHash, cid, msg.sender, allowedUsers);
    }

    /// @notice Update the CID of an existing file (only uploader can update)
    /// @param fileHash SHA-256 hash of the file
    /// @param newCid New IPFS CID
    function updateCid(bytes32 fileHash, string calldata newCid) external whenNotPaused {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(bytes(newCid).length > 0, "CID cannot be empty");

        files[fileHash].cid = newCid;
        emit FileUpdated(fileHash, newCid, msg.sender);
    }

    /// @notice Delete a file reference and clear all access (only uploader can delete)
    /// @param fileHash SHA-256 hash of the file
    function deleteFile(bytes32 fileHash) external whenNotPaused {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");

        // Note: We soft delete. We do NOT reset 'version' here.
        // Next time it is uploaded, version increments, ensuring old users assume
        // a version gap and stay unauthorized.
        files[fileHash].exists = false;
        files[fileHash].uploader = address(0);
        files[fileHash].cid = "";
        files[fileHash].userCount = 0;

        emit FileDeleted(fileHash, msg.sender);
    }

    /// @notice Transfer ownership of a file to a new address (only uploader can transfer)
    /// @param fileHash SHA-256 hash of the file
    /// @param newOwner Address of the new owner
    function transferFileOwnership(bytes32 fileHash, address newOwner) external whenNotPaused {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(newOwner != address(0), "Invalid new owner address");
        require(newOwner != msg.sender, "Already the owner");

        File storage f = files[fileHash];
        address previousOwner = f.uploader;

        // Revoke previous owner's access before transferring
        if (f.authorizedVersion[previousOwner] == f.version) {
            f.authorizedVersion[previousOwner] = 0;
            // Use explicit error instead of silent check
            require(f.userCount > 0, "User count already zero");
            f.userCount--;
            emit AccessRevoked(fileHash, previousOwner);
        }

        // Transfer ownership
        f.uploader = newOwner;

        // Automatically grant access to new owner
        _grantAccessInternal(f, fileHash, newOwner);

        emit FileOwnershipTransferred(fileHash, previousOwner, newOwner);
    }

    /// @notice Grant access to a user (only uploader can grant)
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to grant access to
    function grantAccess(bytes32 fileHash, address user) external whenNotPaused {
        File storage f = files[fileHash];
        require(f.exists, "File does not exist");
        require(f.uploader == msg.sender, "Not uploader");

        _grantAccessInternal(f, fileHash, user);
    }

    /// @notice Grant access to multiple users (only uploader can grant)
    /// @param fileHash SHA-256 hash of the file
    /// @param users Array of addresses to grant access to
    function grantAccessBatch(bytes32 fileHash, address[] calldata users) external whenNotPaused {
        File storage f = files[fileHash];
        require(f.exists, "File does not exist");
        require(f.uploader == msg.sender, "Not uploader");

        // This was vulnerable because _grantAccessInternal could skip users that already
        // have access, allowing the limit to be bypassed. Now each call to
        // _grantAccessInternal enforces the limit individually.

        for (uint256 i = 0; i < users.length; i++) {
            _grantAccessInternal(f, fileHash, users[i]);
        }
    }

    /// @notice Revoke access from a user (only uploader can revoke)
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to revoke access from
    function revokeAccess(bytes32 fileHash, address user) external whenNotPaused {
        File storage f = files[fileHash];
        require(f.exists, "File does not exist");
        require(f.uploader == msg.sender, "Not uploader");
        require(user != address(0), "Invalid user address");
        require(user != msg.sender, "Cannot revoke own access"); // FIX #2

        // Only revoke if they actually have the CURRENT version
        if (f.authorizedVersion[user] == f.version) {
            f.authorizedVersion[user] = 0; // Revoke by setting to 0

            require(f.userCount > 0, "User count already zero");
            f.userCount--;

            emit AccessRevoked(fileHash, user);
        }
    }

    // --- Internal Helpers ---

    function _grantAccessInternal(File storage f, bytes32 fileHash, address user) internal {
        require(user != address(0), "Invalid user address");

        // Grant only if not already on the current version
        if (f.authorizedVersion[user] != f.version) {
            require(f.userCount < MAX_ALLOWED_USERS, "Too many users");

            f.authorizedVersion[user] = f.version;
            f.userCount++;
            emit AccessGranted(fileHash, user);
        }
    }

    // --- Views ---

    /// @notice Check if a user is authorized to access a file
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to check
    /// @return bool True if authorized, false otherwise
    function isAuthorized(bytes32 fileHash, address user) external view returns (bool) {
        if (!files[fileHash].exists) return false;
        // Logic change: Check versions match
        return files[fileHash].authorizedVersion[user] == files[fileHash].version;
    }

    /// @notice Check if caller is authorized to access a file
    /// @param fileHash SHA-256 hash of the file
    /// @return bool True if authorized, false otherwise
    function canAccess(bytes32 fileHash) external view returns (bool) {
        if (!files[fileHash].exists) return false;
        return files[fileHash].authorizedVersion[msg.sender] == files[fileHash].version;
    }

    /// @notice Get the uploader of a file
    /// @param fileHash SHA-256 hash of the file
    /// @return address Address of the uploader
    function getUploader(bytes32 fileHash) external view returns (address) {
        require(files[fileHash].exists, "File does not exist");
        return files[fileHash].uploader;
    }

    /// @notice Get the CID of a file (only authorized users can access)
    /// @param fileHash SHA-256 hash of the file
    /// @return string IPFS CID
    function getCid(bytes32 fileHash) external view returns (string memory) {
        require(files[fileHash].exists, "File does not exist");
        // Logic change: Check versions match
        require(
            files[fileHash].authorizedVersion[msg.sender] == files[fileHash].version,
            "Not authorized to access this file"
        );
        return files[fileHash].cid;
    }

    /// @notice Check if a file exists
    /// @param fileHash SHA-256 hash of the file
    /// @return bool True if file exists, false otherwise
    function fileExists(bytes32 fileHash) external view returns (bool) {
        return files[fileHash].exists;
    }

    /// @notice Get the current user count for a file (for testing/debugging)
    /// @param fileHash SHA-256 hash of the file
    /// @return uint256 Current number of authorized users
    function getUserCount(bytes32 fileHash) external view returns (uint256) {
        require(files[fileHash].exists, "File does not exist");
        return files[fileHash].userCount;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[45] private __gap;
}
