// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionKeyAccount} from "../src/SessionKeyAccount.sol";

contract Target {
    uint256 public value;
    event Poked(uint256 amount);

    function poke(uint256 amount) external {
        value = amount;
        emit Poked(amount);
    }

    function other(uint256 amount) external {
        value = amount;
    }
}

contract SessionKeyAccountTest is Test {
    SessionKeyAccount account;
    Target target;

    address entryPoint = address(0xE17);
    address owner;
    uint256 ownerKey;
    address session;
    uint256 sessionKey;

    bytes4 constant POKE = bytes4(keccak256("poke(uint256)"));

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");
        (session, sessionKey) = makeAddrAndKey("session");
        vm.warp(1_800_000_000);
        account = new SessionKeyAccount(entryPoint, owner);
        target = new Target();
        vm.deal(address(account), 1 ether);

        vm.prank(owner);
        account.setSessionKey(session, address(target), POKE, uint64(block.timestamp + 1 hours));
    }

    function _op(bytes memory callData, bytes memory signature)
        internal
        pure
        returns (SessionKeyAccount.PackedUserOperation memory)
    {
        return SessionKeyAccount.PackedUserOperation({
            sender: address(0),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    function _executeCall(address dest, uint256 value, bytes memory data) internal view returns (bytes memory) {
        return abi.encodeWithSelector(account.execute.selector, dest, value, data);
    }

    function _sign(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function testOwnerCanDoAnything() public {
        bytes32 hash = keccak256("op-1");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(Target.other.selector, 7));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(ownerKey, hash)), hash, 0), 0);
    }

    function testSessionKeyCanCallAllowedSelector() public {
        bytes32 hash = keccak256("op-2");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(POKE, 42));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 0);
    }

    function testSessionKeyCannotCallOtherSelector() public {
        bytes32 hash = keccak256("op-3");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(Target.other.selector, 1));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 1);
    }

    function testSessionKeyCannotCallOtherTarget() public {
        bytes32 hash = keccak256("op-4");
        Target other = new Target();
        bytes memory callData = _executeCall(address(other), 0, abi.encodeWithSelector(POKE, 1));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 1);
    }

    function testSessionKeyCannotSendValue() public {
        bytes32 hash = keccak256("op-5");
        bytes memory callData = _executeCall(address(target), 1, abi.encodeWithSelector(POKE, 1));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 1);
    }

    function testExpiredSessionKeyFails() public {
        bytes32 hash = keccak256("op-6");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(POKE, 1));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 1);
    }

    function testStrangerSignatureFails() public {
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes32 hash = keccak256("op-7");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(POKE, 1));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(strangerKey, hash)), hash, 0), 1);
    }

    function testPrefundsEntryPoint() public {
        bytes32 hash = keccak256("op-8");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(POKE, 1));
        uint256 before = entryPoint.balance;
        vm.prank(entryPoint);
        account.validateUserOp(_op(callData, _sign(ownerKey, hash)), hash, 0.1 ether);
        assertEq(entryPoint.balance - before, 0.1 ether);
    }

    function testOwnerExecutesAndStrangerCannot() public {
        vm.prank(owner);
        account.execute(address(target), 0, abi.encodeWithSelector(POKE, 5));
        assertEq(target.value(), 5);

        vm.prank(address(0xBEEF));
        vm.expectRevert(SessionKeyAccount.NotOwner.selector);
        account.execute(address(target), 0, abi.encodeWithSelector(POKE, 6));
    }

    function testClearedSessionKeyIsRejected() public {
        vm.prank(owner);
        account.clearSessionKey();
        bytes32 hash = keccak256("op-9");
        bytes memory callData = _executeCall(address(target), 0, abi.encodeWithSelector(POKE, 1));
        vm.prank(entryPoint);
        assertEq(account.validateUserOp(_op(callData, _sign(sessionKey, hash)), hash, 0), 1);
    }
}
