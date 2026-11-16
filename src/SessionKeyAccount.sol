// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SessionKeyAccount
/// @notice Minimal ERC-4337 (EntryPoint v0.7) account with a *scoped* session key.
///         The owner can do anything; the session key can do exactly one thing:
///         call one allowed selector on one allowed target, until it expires.
///         That is the on-chain half of "the agent may pay this merchant, and nothing else".
/// @dev Depends only on the EntryPoint interface, so it can be deployed on any EVM chain.
contract SessionKeyAccount {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }

    address public immutable entryPoint;
    address public owner;

    address public sessionKey;
    address public sessionTarget;
    bytes4 public sessionSelector;
    uint64 public sessionValidUntil;

    event SessionKeySet(address indexed key, address indexed target, bytes4 selector, uint64 validUntil);
    event SessionKeyCleared();
    event Executed(address indexed dest, uint256 value, bytes4 selector);

    error NotEntryPoint();
    error NotOwner();
    error CallFailed(bytes returnData);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address entryPoint_, address owner_) {
        entryPoint = entryPoint_;
        owner = owner_;
    }

    receive() external payable {}

    /// @notice Owner grants a session key a single (target, selector) capability until `validUntil`.
    function setSessionKey(address key, address target, bytes4 selector, uint64 validUntil) external onlyOwner {
        sessionKey = key;
        sessionTarget = target;
        sessionSelector = selector;
        sessionValidUntil = validUntil;
        emit SessionKeySet(key, target, selector, validUntil);
    }

    function clearSessionKey() external onlyOwner {
        sessionKey = address(0);
        sessionTarget = address(0);
        sessionSelector = bytes4(0);
        sessionValidUntil = 0;
        emit SessionKeyCleared();
    }

    /// @notice Execute a call. Callable by the owner directly or by the EntryPoint on behalf of a signed userOp.
    function execute(address dest, uint256 value, bytes calldata data) external {
        if (msg.sender != owner && msg.sender != entryPoint) revert NotOwner();
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        emit Executed(dest, value, _selector(data));
    }

    /// @notice ERC-4337 validation. Returns 0 (valid) or 1 (invalid) as validationData.
    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256 validationData)
    {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        if (missingAccountFunds > 0) {
            // Prefund the EntryPoint; failures are the EntryPoint's problem, not a validation failure.
            (bool sent,) = msg.sender.call{value: missingAccountFunds}("");
            sent;
        }

        address signer = _recover(userOpHash, op.signature);
        if (signer == owner) return 0;

        if (sessionKey != address(0) && signer == sessionKey && block.timestamp <= sessionValidUntil) {
            if (_isAllowedCall(op.callData)) return 0;
        }
        return 1;
    }

    /// @dev Only `execute(allowedTarget, 0, <allowedSelector> ...)` passes.
    function _isAllowedCall(bytes calldata callData) internal view returns (bool) {
        if (callData.length < 4) return false;
        bytes4 outer;
        assembly {
            outer := calldataload(callData.offset)
        }
        if (outer != this.execute.selector) return false;

        (address dest, uint256 value, bytes memory data) = abi.decode(callData[4:], (address, uint256, bytes));
        if (dest != sessionTarget || value != 0) return false;
        if (data.length < 4) return false;
        return _selector(data) == sessionSelector;
    }

    function _selector(bytes memory data) internal pure returns (bytes4 selector) {
        assembly {
            selector := mload(add(data, 32))
        }
    }

    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
