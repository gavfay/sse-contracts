import { parseEther } from "ethers/lib/utils";
import { ethers, network } from "hardhat";

import { deployContract, deployUseCreate2, saveAny, wait1Tx } from "./hutils";

import type { BigNumberish } from "ethers";

const VRFConfig: {
  [k: string]: { coor: string; subId: BigNumberish; keyHash: string };
} = {
  sepolia: {
    coor: "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625",
    subId: 7066,
    keyHash: "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c",
  },
  arb_sepolia: {
    coor: "0x50d47e4142598E3411aA864e08a44284e471AC6f",
    subId: 36,
    keyHash: "0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae07570c45d6631414",
  },
  arbitrum_sepolia: {
    coor: "0x50d47e4142598E3411aA864e08a44284e471AC6f",
    subId: 36,
    keyHash: "0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae07570c45d6631414",
  },
  arb: {
    coor: "0x41034678D6C633D8a95c75e1138A360a28bA15d1",
    subId: 126,
    keyHash: "0x72d2b016bb5b62912afea355ebf33b91319f828738b111b723b78696b9847b63",
  },
};

const MemberConfig: { [k: string]: string } = {
  sepolia: "0x7ddBFF9D74D0A2F33Dfb13cEC538B334f2011462",
  arb_sepolia: "0x0da3C82d0785ad289Be2Cb6cE7382a879E72d18b",
  arbitrum_sepolia: "0x7ddBFF9D74D0A2F33Dfb13cEC538B334f2011462",
};

async function main() {
  const owner = (await ethers.getSigners())[0];
  if (!owner) throw "No signers";

  // Market
  const marketAddress = await deployUseCreate2("SseMarket", "0x0000000000000000000000000000000000000000d4b6fcc21169b803f25d5559");
  const market = await ethers.getContractAt("SseMarket", marketAddress);

  // VRFConsumer
  if (!VRFConfig[network.name]) throw "Network not support!";
  const config = VRFConfig[network.name];
  const vrfAddress = await deployUseCreate2("VRFConsumerV2", "0x0000000000000000000000000000000000000000d4b6fcc21169b803f25d3333", [
    "uint64",
    "address",
    "bytes32",
    config.subId,
    config.coor,
    config.keyHash,
  ]);
  const vrf = await ethers.getContractAt("VRFConsumerV2", vrfAddress);
  const roleMarket = await vrf.MARKET();
  if (!(await vrf.hasRole(roleMarket, marketAddress))) {
    await vrf.connect(owner).grantRole(roleMarket, marketAddress, { gasLimit: 2000000 }).then(wait1Tx);
  }

  // SseGasManager
  const smeGasManagerAddress = await deployContract("SseGasManager", [parseEther("0.0001").toString()]);

  // setMember;
  if (MemberConfig[network.name]) {
    await market.addMember(MemberConfig[network.name], { gasLimit: 2000000 }).then(wait1Tx);
    console.info("added members");
  }

  // updateVRF
  const oldVrf = await market.vrfOwner();
  if (oldVrf !== vrfAddress) await market.updateVRFAddress(vrfAddress).then(wait1Tx);
  console.info("updated vrf");
}
main();
