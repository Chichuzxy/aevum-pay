// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VerifyingPaymaster
/// @notice ERC-4337 (EntryPoint v0.7) paymaster that sponsors a userOp when our signer
///         has approved it off-chain. The agent then pays no gas at all: the entry point
///         charges this contract's deposit instead.
/// @dev `paymasterAndData` = paymaster(20) | verificationGasLimit(16) | postOpGasLimit(16) | data
///      where data = abi.encode(uint48 validUntil, uint48 validAfter, bytes signature).
///      The signature covers fields that exclude paymasterAndData (otherwise the hash would be
///      circular, because the signature is inside that field):
///      keccak256(abi.encode(sender, nonce, keccak256(callData), accountGasLimits, gasFees,
///                           validUntil, validAfter)).
contract VerifyingPaymaster {
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

    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    address public immutable entryPoint;
    address public owner;
    address public signer;

    uint256 public sponsoredOps;
    mapping(address => uint256) public sponsoredBySender; // userOps sponsored per account

    event SignerSet(address indexed signer);
    event Sponsored(address indexed sender, uint256 validUntil);
    event Deposited(address indexed from, uint256 amount);

    error NotEntryPoint();
    error NotOwner();
    error BadSignature();
    error BadWindow();
    error BadData();
    error TransferFailed();

    constructor(address entryPoint_, address signer_, address owner_) {
        entryPoint = entryPoint_;
        signer = signer_;
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    receive() external payable {
        deposit();
    }

    /// @notice Put tQDAY into the EntryPoint's balance for this paymaster.
    function deposit() public payable {
        (bool ok,) = entryPoint.call{value: msg.value}(abi.encodeWithSignature("depositTo(address)", address(this)));
        if (!ok) revert TransferFailed();
        emit Deposited(msg.sender, msg.value);
    }

    function getDeposit() external view returns (uint256) {
        (bool ok, bytes memory data) =
            entryPoint.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok) return 0;
        return abi.decode(data, (uint256));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = entryPoint.call(abi.encodeWithSignature("withdrawTo(address,uint256)", to, amount));
        if (!ok) revert TransferFailed();
    }

    function setSigner(address signer_) external onlyOwner {
        signer = signer_;
        emit SignerSet(signer_);
    }

    /// @notice EntryPoint hook: approve this userOp only with a valid, in-window signature.
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256)
        external
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        bytes calldata data = userOp.paymasterAndData[52:];
        if (data.length < 64) revert BadData();
        (uint48 validUntil, uint48 validAfter, bytes memory signature) = abi.decode(data, (uint48, uint48, bytes));

        if (block.timestamp < validAfter || block.timestamp > validUntil) revert BadWindow();

        userOpHash; // the EntryPoint hash includes this signature, so it cannot be what we sign
        bytes32 digest = keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.gasFees,
                validUntil,
                validAfter
            )
        );
        address recovered = _recover(digest, signature);
        if (recovered != signer) revert BadSignature();

        sponsoredOps += 1;
        sponsoredBySender[userOp.sender] += 1;
        emit Sponsored(userOp.sender, validUntil);

        // The EntryPoint masks these; 0 aggregator, validUntil, validAfter.
        validationData = (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
        return ("", validationData);
    }

    function postOp(PostOpMode, bytes calldata, uint256) external {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        // Nothing to settle: the deposit was already charged by the EntryPoint.
    }

    function _recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
