// Sources flattened with hardhat v2.28.1 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts/proxy/utils/Initializable.sol@v5.5.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (proxy/utils/Initializable.sol)

pragma solidity ^0.8.20;

/**
 * @dev This is a base contract to aid in writing upgradeable contracts, or any kind of contract that will be deployed
 * behind a proxy. Since proxied contracts do not make use of a constructor, it's common to move constructor logic to an
 * external initializer function, usually called `initialize`. It then becomes necessary to protect this initializer
 * function so it can only be called once. The {initializer} modifier provided by this contract will have this effect.
 *
 * The initialization functions use a version number. Once a version number is used, it is consumed and cannot be
 * reused. This mechanism prevents re-execution of each "step" but allows the creation of new initialization steps in
 * case an upgrade adds a module that needs to be initialized.
 *
 * For example:
 *
 * [.hljs-theme-light.nopadding]
 * ```solidity
 * contract MyToken is ERC20Upgradeable {
 *     function initialize() initializer public {
 *         __ERC20_init("MyToken", "MTK");
 *     }
 * }
 *
 * contract MyTokenV2 is MyToken, ERC20PermitUpgradeable {
 *     function initializeV2() reinitializer(2) public {
 *         __ERC20Permit_init("MyToken");
 *     }
 * }
 * ```
 *
 * TIP: To avoid leaving the proxy in an uninitialized state, the initializer function should be called as early as
 * possible by providing the encoded function call as the `_data` argument to {ERC1967Proxy-constructor}.
 *
 * CAUTION: When used with inheritance, manual care must be taken to not invoke a parent initializer twice, or to ensure
 * that all initializers are idempotent. This is not verified automatically as constructors are by Solidity.
 *
 * [CAUTION]
 * ====
 * Avoid leaving a contract uninitialized.
 *
 * An uninitialized contract can be taken over by an attacker. This applies to both a proxy and its implementation
 * contract, which may impact the proxy. To prevent the implementation contract from being used, you should invoke
 * the {_disableInitializers} function in the constructor to automatically lock it when it is deployed:
 *
 * [.hljs-theme-light.nopadding]
 * ```
 * /// @custom:oz-upgrades-unsafe-allow constructor
 * constructor() {
 *     _disableInitializers();
 * }
 * ```
 * ====
 */
abstract contract Initializable {
    /**
     * @dev Storage of the initializable contract.
     *
     * It's implemented on a custom ERC-7201 namespace to reduce the risk of storage collisions
     * when using with upgradeable contracts.
     *
     * @custom:storage-location erc7201:openzeppelin.storage.Initializable
     */
    struct InitializableStorage {
        /**
         * @dev Indicates that the contract has been initialized.
         */
        uint64 _initialized;
        /**
         * @dev Indicates that the contract is in the process of being initialized.
         */
        bool _initializing;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant INITIALIZABLE_STORAGE = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    /**
     * @dev The contract is already initialized.
     */
    error InvalidInitialization();

    /**
     * @dev The contract is not initializing.
     */
    error NotInitializing();

    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint64 version);

    /**
     * @dev A modifier that defines a protected initializer function that can be invoked at most once. In its scope,
     * `onlyInitializing` functions can be used to initialize parent contracts.
     *
     * Similar to `reinitializer(1)`, except that in the context of a constructor an `initializer` may be invoked any
     * number of times. This behavior in the constructor can be useful during testing and is not expected to be used in
     * production.
     *
     * Emits an {Initialized} event.
     */
    modifier initializer() {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        // Cache values to avoid duplicated sloads
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;

        // Allowed calls:
        // - initialSetup: the contract is not in the initializing state and no previous version was
        //                 initialized
        // - construction: the contract is initialized at version 1 (no reinitialization) and the
        //                 current contract is just being deployed
        bool initialSetup = initialized == 0 && isTopLevelCall;
        bool construction = initialized == 1 && address(this).code.length == 0;

        if (!initialSetup && !construction) {
            revert InvalidInitialization();
        }
        $._initialized = 1;
        if (isTopLevelCall) {
            $._initializing = true;
        }
        _;
        if (isTopLevelCall) {
            $._initializing = false;
            emit Initialized(1);
        }
    }

    /**
     * @dev A modifier that defines a protected reinitializer function that can be invoked at most once, and only if the
     * contract hasn't been initialized to a greater version before. In its scope, `onlyInitializing` functions can be
     * used to initialize parent contracts.
     *
     * A reinitializer may be used after the original initialization step. This is essential to configure modules that
     * are added through upgrades and that require initialization.
     *
     * When `version` is 1, this modifier is similar to `initializer`, except that functions marked with `reinitializer`
     * cannot be nested. If one is invoked in the context of another, execution will revert.
     *
     * Note that versions can jump in increments greater than 1; this implies that if multiple reinitializers coexist in
     * a contract, executing them in the right order is up to the developer or operator.
     *
     * WARNING: Setting the version to 2**64 - 1 will prevent any future reinitialization.
     *
     * Emits an {Initialized} event.
     */
    modifier reinitializer(uint64 version) {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing || $._initialized >= version) {
            revert InvalidInitialization();
        }
        $._initialized = version;
        $._initializing = true;
        _;
        $._initializing = false;
        emit Initialized(version);
    }

    /**
     * @dev Modifier to protect an initialization function so that it can only be invoked by functions with the
     * {initializer} and {reinitializer} modifiers, directly or indirectly.
     */
    modifier onlyInitializing() {
        _checkInitializing();
        _;
    }

    /**
     * @dev Reverts if the contract is not in an initializing state. See {onlyInitializing}.
     */
    function _checkInitializing() internal view virtual {
        if (!_isInitializing()) {
            revert NotInitializing();
        }
    }

    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version. It is recommended to use this to lock implementation contracts that are designed to be called
     * through proxies.
     *
     * Emits an {Initialized} event the first time it is successfully executed.
     */
    function _disableInitializers() internal virtual {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing) {
            revert InvalidInitialization();
        }
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    /**
     * @dev Returns the highest version that has been initialized. See {reinitializer}.
     */
    function _getInitializedVersion() internal view returns (uint64) {
        return _getInitializableStorage()._initialized;
    }

    /**
     * @dev Returns `true` if the contract is currently initializing. See {onlyInitializing}.
     */
    function _isInitializing() internal view returns (bool) {
        return _getInitializableStorage()._initializing;
    }

    /**
     * @dev Pointer to storage slot. Allows integrators to override it with a custom storage location.
     *
     * NOTE: Consider following the ERC-7201 formula to derive storage locations.
     */
    function _initializableStorageSlot() internal pure virtual returns (bytes32) {
        return INITIALIZABLE_STORAGE;
    }

    /**
     * @dev Returns a pointer to the storage namespace.
     */
    // solhint-disable-next-line var-name-mixedcase
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        bytes32 slot = _initializableStorageSlot();
        assembly {
            $.slot := slot
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol@v5.5.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract ContextUpgradeable is Initializable {
    function __Context_init() internal onlyInitializing {
    }

    function __Context_init_unchained() internal onlyInitializing {
    }
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol@v5.5.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract OwnableUpgradeable is Initializable, ContextUpgradeable {
    /// @custom:storage-location erc7201:openzeppelin.storage.Ownable
    struct OwnableStorage {
        address _owner;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Ownable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OwnableStorageLocation = 0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300;

    function _getOwnableStorage() private pure returns (OwnableStorage storage $) {
        assembly {
            $.slot := OwnableStorageLocation
        }
    }

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    function __Ownable_init(address initialOwner) internal onlyInitializing {
        __Ownable_init_unchained(initialOwner);
    }

    function __Ownable_init_unchained(address initialOwner) internal onlyInitializing {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        OwnableStorage storage $ = _getOwnableStorage();
        return $._owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        OwnableStorage storage $ = _getOwnableStorage();
        address oldOwner = $._owner;
        $._owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol@v5.5.0

// Original license: SPDX_License_Identifier: MIT

pragma solidity ^0.8.20;


// File @openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol@v5.5.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (utils/Pausable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract PausableUpgradeable is Initializable, ContextUpgradeable {
    /// @custom:storage-location erc7201:openzeppelin.storage.Pausable
    struct PausableStorage {
        bool _paused;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Pausable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PausableStorageLocation = 0xcd5ed15c6e187e77e9aee88184c21f4f2182ab5827cb3b7e07fbedcd63f03300;

    function _getPausableStorage() private pure returns (PausableStorage storage $) {
        assembly {
            $.slot := PausableStorageLocation
        }
    }

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    function __Pausable_init() internal onlyInitializing {
    }

    function __Pausable_init_unchained() internal onlyInitializing {
    }
    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        PausableStorage storage $ = _getPausableStorage();
        return $._paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        PausableStorage storage $ = _getPausableStorage();
        $._paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        PausableStorage storage $ = _getPausableStorage();
        $._paused = false;
        emit Unpaused(_msgSender());
    }
}


// File contracts/FileVault.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;



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
