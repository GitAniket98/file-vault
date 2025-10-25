// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FileVault - On-chain access control for encrypted off-chain storage
/// @notice Stores encrypted file references (hash + CID) and manages access
contract FileVault {
    struct File {
        address uploader; // Who uploaded the file
        string cid; // IPFS CID of the encrypted file
        mapping(address => bool) authorized; // Access control (direct grant only)
    }

    // Mapping: fileHash (SHA-256 of encrypted file) => File struct
    mapping(bytes32 => File) private files;

    /// @dev Events for frontend/backends to track changes
    event FileUploaded(bytes32 indexed fileHash, string cid, address indexed uploader, address[] allowedUsers);

    event AccessGranted(bytes32 indexed fileHash, address indexed user);
    event AccessRevoked(bytes32 indexed fileHash, address indexed user);

    /// @notice Upload a new file reference (CID + hash) and set initial access list
    /// @param fileHash SHA-256 hash of the encrypted file
    /// @param cid IPFS CID of the encrypted file
    /// @param allowedUsers List of addresses initially granted access
    function storeFileHash(bytes32 fileHash, string calldata cid, address[] calldata allowedUsers) external {
        require(files[fileHash].uploader == address(0), "File already exists");

        File storage f = files[fileHash];
        f.uploader = msg.sender;
        f.cid = cid;

        for (uint256 i = 0; i < allowedUsers.length; i++) {
            f.authorized[allowedUsers[i]] = true;
        }

        emit FileUploaded(fileHash, cid, msg.sender, allowedUsers);
    }

    /// @notice Grant access to a user (only uploader can grant)
    function grantAccess(bytes32 fileHash, address user) external {
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        files[fileHash].authorized[user] = true;
        emit AccessGranted(fileHash, user);
    }

    /// @notice Revoke access from a user (only uploader can revoke)
    function revokeAccess(bytes32 fileHash, address user) external {
        require(files[fileHash].uploader == msg.sender, "Not uploader");
        files[fileHash].authorized[user] = false;
        emit AccessRevoked(fileHash, user);
    }

    /// @notice Check if a user is authorized to access a file
    function isAuthorized(bytes32 fileHash, address user) external view returns (bool) {
        return files[fileHash].authorized[user];
    }

    /// @notice Get the uploader of a file
    function getUploader(bytes32 fileHash) external view returns (address) {
        return files[fileHash].uploader;
    }

    /// @notice Get the CID of a file
    function getCid(bytes32 fileHash) external view returns (string memory) {
        return files[fileHash].cid;
    }
}
