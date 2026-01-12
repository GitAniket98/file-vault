// Sources flattened with hardhat v2.28.1 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/fileVault.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/// @title FileVault - On-chain access control for encrypted off-chain storage
/// @notice Stores encrypted file references (hash + CID) and manages access with security improvements
contract FileVault {
    struct File {
        address uploader; // Who uploaded the file
        string cid; // IPFS CID of the encrypted file
        mapping(address => bool) authorized; // Access control
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
    event OwnershipTransferred(bytes32 indexed fileHash, address indexed previousOwner, address indexed newOwner);

    /// @notice Upload a new file reference (CID + hash) and set initial access list
    /// @param fileHash SHA-256 hash of the encrypted file
    /// @param cid IPFS CID of the encrypted file
    /// @param allowedUsers List of addresses initially granted access
    function storeFileHash(bytes32 fileHash, string calldata cid, address[] calldata allowedUsers) external {
        require(!files[fileHash].exists, "File already exists");
        require(bytes(cid).length > 0, "CID cannot be empty");
        require(allowedUsers.length <= MAX_ALLOWED_USERS, "Too many users");

        File storage f = files[fileHash];
        f.uploader = msg.sender;
        f.cid = cid;
        f.exists = true;

        // Automatically grant access to uploader
        f.authorized[msg.sender] = true;

        // Grant access to allowed users (with duplicate and zero address checks)
        for (uint256 i = 0; i < allowedUsers.length; i++) {
            address user = allowedUsers[i];
            require(user != address(0), "Invalid address in allowedUsers");

            // Only set if not already authorized (prevents wasted gas on duplicates)
            if (!f.authorized[user]) {
                f.authorized[user] = true;
            }
        }

        emit FileUploaded(fileHash, cid, msg.sender, allowedUsers);
    }

    /// @notice Update the CID of an existing file (only uploader can update)
    /// @param fileHash SHA-256 hash of the file
    /// @param newCid New IPFS CID
    function updateCid(bytes32 fileHash, string calldata newCid) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(bytes(newCid).length > 0, "CID cannot be empty");

        files[fileHash].cid = newCid;
        emit FileUpdated(fileHash, newCid, msg.sender);
    }

    /// @notice Delete a file reference and clear all access (only uploader can delete)
    /// @param fileHash SHA-256 hash of the file
    function deleteFile(bytes32 fileHash) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");

        // Note: Due to Solidity limitations, we cannot iterate and delete all authorized users
        // The mapping will remain in storage but the file is marked as deleted
        files[fileHash].exists = false;
        files[fileHash].uploader = address(0);
        files[fileHash].cid = "";

        emit FileDeleted(fileHash, msg.sender);
    }

    /// @notice Transfer ownership of a file to a new address (only uploader can transfer)
    /// @param fileHash SHA-256 hash of the file
    /// @param newOwner Address of the new owner
    function transferOwnership(bytes32 fileHash, address newOwner) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(newOwner != address(0), "Invalid new owner address");
        require(newOwner != msg.sender, "Already the owner");

        address previousOwner = files[fileHash].uploader;
        files[fileHash].uploader = newOwner;

        // Automatically grant access to new owner
        files[fileHash].authorized[newOwner] = true;

        emit OwnershipTransferred(fileHash, previousOwner, newOwner);
    }

    /// @notice Grant access to a user (only uploader can grant)
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to grant access to
    function grantAccess(bytes32 fileHash, address user) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(user != address(0), "Invalid user address");

        files[fileHash].authorized[user] = true;
        emit AccessGranted(fileHash, user);
    }

    /// @notice Grant access to multiple users (only uploader can grant)
    /// @param fileHash SHA-256 hash of the file
    /// @param users Array of addresses to grant access to
    function grantAccessBatch(bytes32 fileHash, address[] calldata users) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(users.length <= MAX_ALLOWED_USERS, "Too many users");

        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            require(user != address(0), "Invalid user address");

            if (!files[fileHash].authorized[user]) {
                files[fileHash].authorized[user] = true;
                emit AccessGranted(fileHash, user);
            }
        }
    }

    /// @notice Revoke access from a user (only uploader can revoke)
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to revoke access from
    function revokeAccess(bytes32 fileHash, address user) external {
        require(files[fileHash].exists, "File does not exist");
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        require(user != address(0), "Invalid user address");

        files[fileHash].authorized[user] = false;
        emit AccessRevoked(fileHash, user);
    }

    /// @notice Check if a user is authorized to access a file
    /// @param fileHash SHA-256 hash of the file
    /// @param user Address to check
    /// @return bool True if authorized, false otherwise
    function isAuthorized(bytes32 fileHash, address user) external view returns (bool) {
        require(files[fileHash].exists, "File does not exist");
        return files[fileHash].authorized[user];
    }

    /// @notice Check if caller is authorized to access a file
    /// @param fileHash SHA-256 hash of the file
    /// @return bool True if authorized, false otherwise
    function canAccess(bytes32 fileHash) external view returns (bool) {
        require(files[fileHash].exists, "File does not exist");
        return files[fileHash].authorized[msg.sender];
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
        require(files[fileHash].authorized[msg.sender], "Not authorized to access this file");
        return files[fileHash].cid;
    }

    /// @notice Check if a file exists
    /// @param fileHash SHA-256 hash of the file
    /// @return bool True if file exists, false otherwise
    function fileExists(bytes32 fileHash) external view returns (bool) {
        return files[fileHash].exists;
    }
}
