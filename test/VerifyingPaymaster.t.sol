// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerifyingPaymaster} from "../src/VerifyingPaymaster.sol";

contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }
}

contract VerifyingPaymasterTest is Test {
    VerifyingPaymaster paymaster;
    MockEntryPoint entryPoint;

    address sponsorSigner;
    uint256 signerKey;
    address owner = address(0xA11CE);

    function setUp() public {
        entryPoint = new MockEntryPoint();
        (sponsorSigner, signerKey) = makeAddrAndKey("sponsor");
        paymaster = new VerifyingPaymaster(address(entryPoint), sponsorSigner, owner);
        vm.deal(address(paymaster), 1 ether);
        vm.deal(address(this), 2 ether);
        vm.deal(owner, 2 ether);
        vm.warp(1_800_000_000);
    }

    function _op(bytes memory paymasterAndData, address sender)
        internal
        pure
        returns (VerifyingPaymaster.PackedUserOperation memory)
    {
        return VerifyingPaymaster.PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: paymasterAndData,
            signature: ""
        });
    }

    function _data(uint48 validUntil, uint48 validAfter, uint256 key, bytes32 userOpHash)
        internal
        view
        returns (bytes memory)
    {
        // mirror the contract: the digest excludes paymasterAndData (no circularity)
        bytes32 digest = keccak256(
            abi.encode(address(0xB0B), uint256(0), keccak256(""), bytes32(0), bytes32(0), validUntil, validAfter)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(
            address(paymaster),
            uint128(200_000),
            uint128(50_000),
            abi.encode(validUntil, validAfter, abi.encodePacked(r, s, v))
        );
    }

    function testSponsorsValidUserOp() public {
        bytes32 userOpHash = keccak256("op-1");
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        bytes memory data = _data(validUntil, 0, signerKey, userOpHash);

        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(_op(data, address(0xB0B)), userOpHash, 0);

        assertEq(context.length, 0);
        assertEq(validationData >> 160 & type(uint48).max, validUntil, "validUntil in validationData");
        assertEq(paymaster.sponsoredOps(), 1);
        assertEq(paymaster.sponsoredBySender(address(0xB0B)), 1);
    }

    function testRejectsWrongSigner() public {
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes32 userOpHash = keccak256("op-2");
        bytes memory data = _data(uint48(block.timestamp + 1 hours), 0, strangerKey, userOpHash);

        vm.prank(address(entryPoint));
        vm.expectRevert(VerifyingPaymaster.BadSignature.selector);
        paymaster.validatePaymasterUserOp(_op(data, address(0xB0B)), userOpHash, 0);
    }

    function testRejectsExpiredWindow() public {
        bytes32 userOpHash = keccak256("op-3");
        bytes memory data = _data(uint48(block.timestamp - 1), 0, signerKey, userOpHash);

        vm.prank(address(entryPoint));
        vm.expectRevert(VerifyingPaymaster.BadWindow.selector);
        paymaster.validatePaymasterUserOp(_op(data, address(0xB0B)), userOpHash, 0);
    }

    function testRejectsSignatureForOtherSender() public {
        bytes memory data = _data(uint48(block.timestamp + 1 hours), 0, signerKey, bytes32(0));

        vm.prank(address(entryPoint));
        vm.expectRevert(VerifyingPaymaster.BadSignature.selector);
        paymaster.validatePaymasterUserOp(_op(data, address(0xCAFE)), bytes32(0), 0);
    }

    function testOnlyEntryPointCanValidate() public {
        bytes memory data = _data(uint48(block.timestamp + 1 hours), 0, signerKey, keccak256("x"));
        vm.expectRevert(VerifyingPaymaster.NotEntryPoint.selector);
        paymaster.validatePaymasterUserOp(_op(data, address(0xB0B)), keccak256("x"), 0);
    }

    function testDepositAndWithdraw() public {
        vm.prank(owner);
        paymaster.deposit{value: 0.5 ether}();
        assertEq(entryPoint.balanceOf(address(paymaster)), 0.5 ether);
        assertEq(paymaster.getDeposit(), 0.5 ether);

        uint256 before = owner.balance;
        vm.prank(owner);
        paymaster.withdrawTo(payable(owner), 0.2 ether);
        assertEq(owner.balance, before + 0.2 ether);
        assertEq(paymaster.getDeposit(), 0.3 ether);
    }

    function testOnlyOwnerCanSetSigner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(VerifyingPaymaster.NotOwner.selector);
        paymaster.setSigner(address(0x1234));
    }

    function testPostOpOnlyEntryPoint() public {
        vm.expectRevert(VerifyingPaymaster.NotEntryPoint.selector);
        paymaster.postOp(VerifyingPaymaster.PostOpMode.opSucceeded, "", 0);
    }
}
