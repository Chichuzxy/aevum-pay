// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AevumPay} from "../src/AevumPay.sol";

contract Deploy is Script {
    function run() external returns (AevumPay pay) {
        uint256 pk = _privateKey();
        address token = vm.envAddress("TUSD8_ADDRESS");

        vm.startBroadcast(pk);
        pay = new AevumPay(token);
        vm.stopBroadcast();

        console2.log("AevumPay deployed at", address(pay));
        console2.log("token (tUSD8)", token);
    }

    /// @dev Accepts PRIVATE_KEY with or without the 0x prefix.
    function _privateKey() internal view returns (uint256) {
        string memory s = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(s);
        if (b.length == 66 && b[0] == "0" && b[1] == "x") return vm.parseUint(s);
        return vm.parseUint(string.concat("0x", s));
    }
}
