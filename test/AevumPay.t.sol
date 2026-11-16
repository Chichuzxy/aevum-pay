// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AevumPay} from "../src/AevumPay.sol";

contract MockERC20 {
    string public name = "Test USD8";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AevumPayTest is Test {
    AevumPay pay;
    MockERC20 token;

    address alice = address(0xA11CE); // payer
    address bob = address(0xB0B); // merchant
    address carol = address(0xCA401); // agent spender

    bytes32 constant RID = keccak256("api.infer.small");
    bytes32 constant RID_OTHER = keccak256("api.other");

    function setUp() public {
        token = new MockERC20();
        pay = new AevumPay(address(token));
        vm.warp(1_700_000_000);

        vm.prank(bob);
        pay.registerMerchant();
        vm.prank(bob);
        pay.listResource(RID, 10_000); // 0.01 tUSD8 per unit

        token.mint(alice, 1_000_000); // 1 tUSD8
        vm.prank(alice);
        token.approve(address(pay), type(uint256).max);
    }

    function _card(uint256 cap, uint64 expiry) internal returns (bytes32) {
        vm.prank(alice);
        return pay.createCard(carol, bob, cap, expiry, 1);
    }

    function testChargeMetersAndPaysMerchant() public {
        bytes32 id = _card(50_000, uint64(block.timestamp + 1 days));
        bytes32 rh = keccak256("receipt-1");

        vm.expectEmit(true, true, true, true);
        emit AevumPay.Charged(id, RID, alice, bob, 3, 30_000, rh, 1);

        vm.prank(carol);
        uint256 amount = pay.charge(id, RID, 3, rh);

        assertEq(amount, 30_000);
        assertEq(token.balanceOf(bob), 30_000);
        assertEq(pay.remaining(id), 20_000);
        assertEq(pay.receiptCount(), 1);
    }

    function testCapEnforced() public {
        bytes32 id = _card(40_000, uint64(block.timestamp + 1 days));
        vm.prank(carol);
        pay.charge(id, RID, 4, bytes32("r1")); // exactly cap

        vm.prank(carol);
        vm.expectRevert(AevumPay.CapExceeded.selector);
        pay.charge(id, RID, 1, bytes32("r2"));
    }

    function testExpiryEnforced() public {
        bytes32 id = _card(50_000, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(carol);
        vm.expectRevert(AevumPay.CardExpired.selector);
        pay.charge(id, RID, 1, bytes32("r1"));
    }

    function testOnlySpenderCanCharge() public {
        bytes32 id = _card(50_000, uint64(block.timestamp + 1 days));
        vm.prank(bob);
        vm.expectRevert(AevumPay.SpenderMismatch.selector);
        pay.charge(id, RID, 1, bytes32("r1"));
    }

    function testRevokedCardCannotCharge() public {
        bytes32 id = _card(50_000, uint64(block.timestamp + 1 days));
        vm.prank(alice);
        pay.revokeCard(id);

        vm.prank(carol);
        vm.expectRevert(AevumPay.CardRevokedErr.selector);
        pay.charge(id, RID, 1, bytes32("r1"));
    }

    function testCardBoundToMerchant() public {
        address mallory = address(0xBAD);
        vm.prank(mallory);
        pay.registerMerchant();
        vm.prank(mallory);
        pay.listResource(RID_OTHER, 1);

        bytes32 id = _card(50_000, uint64(block.timestamp + 1 days));
        vm.prank(carol);
        vm.expectRevert(AevumPay.MerchantMismatch.selector);
        pay.charge(id, RID_OTHER, 1, bytes32("r1"));
    }
}
