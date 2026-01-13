// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import the original contract to inherit its storage layout
import "../FileVault.sol";

/// @notice A mock V2 contract to test upgradeability
contract FileVaultV2 is FileVault {
    // 1. New State Variable (Must be appended!)
    string public newFeatureName;

    // 2. New Functionality
    function setFeatureName(string memory _name) external {
        newFeatureName = _name;
    }

    // 3. New View Function to prove code changed
    function version() external pure returns (string memory) {
        return "v2.0.0";
    }
}
