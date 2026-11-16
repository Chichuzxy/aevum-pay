// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AevumPay} from "../src/AevumPay.sol";

contract Deploy is Script {
    function run() external returns (AevumPay pay) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("TUSD8_ADDRESS");

        vm.startBroadcast(pk);
        pay = new AevumPay(token);
        vm.stopBroadcast();

        console2.log("AevumPay deployed at", address(pay));
        console2.log("token (tUSD8)", token);
    }
}
