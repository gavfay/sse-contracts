import { expect } from "chai";
import { constants } from "ethers";
import { keccak256, recoverAddress } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";

import { deployContract } from "../contracts";
import { getBulkOrderTree } from "../eip712/bulk-orders";
import { calculateOrderHash, convertSignatureToEIP2098, randomHex, toBN } from "../encoding";
import { VERSION } from "../helpers";

import type { ImmutableCreate2FactoryInterface, SseMarket, TestVRF } from "../../../typechain-types";
import type { ConsiderationItem, CriteriaResolver, OfferItem, OrderComponents } from "../types";
import type { Contract, Wallet } from "ethers";

const deployConstants = require("../../../constants/constants");
// const { bulkOrderType } = require("../../../eip-712-types/bulkOrder");
const { orderType } = require("../../../eip-712-types/order");

export const marketplaceFixture = async (create2Factory: ImmutableCreate2FactoryInterface, chainId: number, owner: Wallet) => {
  // Deploy marketplace contract through efficient create2 factory
  const marketplaceContractFactory = await ethers.getContractFactory("SseMarket");

  const marketplaceContractAddress = await create2Factory.findCreate2Address(
    deployConstants.MARKETPLACE_CONTRACT_CREATION_SALT,
    marketplaceContractFactory.bytecode
  );

  let { gasLimit } = await ethers.provider.getBlock("latest");

  if ((hre as any).__SOLIDITY_COVERAGE_RUNNING) {
    gasLimit = ethers.BigNumber.from(300_000_000);
  }

  await create2Factory.safeCreate2(deployConstants.MARKETPLACE_CONTRACT_CREATION_SALT, marketplaceContractFactory.bytecode, {
    gasLimit,
  });

  const marketplaceContract = (await ethers.getContractAt("SseMarket", marketplaceContractAddress, owner)) as SseMarket;

  // setTestVRF

  const market = marketplaceContract;
  const testVRF = await deployContract<TestVRF>("TestVRF", owner);
  await market.connect(owner).updateVRFAddress(testVRF.address);

  // Required for EIP712 signing
  const domainData = {
    name: "SseMarket",
    version: VERSION,
    chainId,
    verifyingContract: marketplaceContract.address,
  };

  const getAndVerifyOrderHash = async (orderComponents: OrderComponents) => {
    const orderHash = await marketplaceContract.getOrderHash(orderComponents);
    const derivedOrderHash = calculateOrderHash(orderComponents);
    expect(orderHash).to.equal(derivedOrderHash);
    return orderHash;
  };

  // Returns signature
  const signOrder = async (orderComponents: OrderComponents, signer: Wallet | Contract, marketplace = marketplaceContract) => {
    const signature = await signer._signTypedData({ ...domainData, verifyingContract: marketplace.address }, orderType, orderComponents);

    const orderHash = await getAndVerifyOrderHash(orderComponents);

    const { domainSeparator } = await marketplace.information();
    const digest = keccak256(`0x1901${domainSeparator.slice(2)}${orderHash.slice(2)}`);
    const recoveredAddress = recoverAddress(digest, signature);

    expect(recoveredAddress).to.equal(signer.address);

    return signature;
  };

  const signBulkOrder = async (
    orderComponents: OrderComponents[],
    signer: Wallet | Contract,
    startIndex = 0,
    height?: number,
    extraCheap?: boolean
  ) => {
    const tree = getBulkOrderTree(orderComponents, startIndex, height);
    const bulkOrderType = tree.types;
    const chunks = tree.getDataToSign();
    let signature = await signer._signTypedData(domainData, bulkOrderType, {
      tree: chunks,
    });

    if (extraCheap) {
      signature = convertSignatureToEIP2098(signature);
    }

    const proofAndSignature = tree.getEncodedProofAndSignature(startIndex, signature);

    const orderHash = tree.getBulkOrderHash();

    const { domainSeparator } = await marketplaceContract.information();
    const digest = keccak256(`0x1901${domainSeparator.slice(2)}${orderHash.slice(2)}`);
    const recoveredAddress = recoverAddress(digest, signature);

    expect(recoveredAddress).to.equal(signer.address);

    // Verify each individual order
    for (const components of orderComponents) {
      const individualOrderHash = await getAndVerifyOrderHash(components);
      const digest = keccak256(`0x1901${domainSeparator.slice(2)}${individualOrderHash.slice(2)}`);
      const individualOrderSignature = await signer._signTypedData(domainData, orderType, components);
      const recoveredAddress = recoverAddress(digest, individualOrderSignature);
      expect(recoveredAddress).to.equal(signer.address);
    }

    return proofAndSignature;
  };

  const createOrder = async (
    offerer: Wallet | Contract,
    zone: undefined | string = undefined,
    offer: OfferItem[],
    consideration: ConsiderationItem[],
    orderType: number,
    criteriaResolvers?: CriteriaResolver[],
    timeFlag?: string | null,
    signer?: Wallet,
    extraCheap = false,
    useBulkSignature = false,
    bulkSignatureIndex?: number,
    bulkSignatureHeight?: number,
    marketplace = marketplaceContract
  ) => {
    const zoneHash = constants.HashZero;
    const conduitKey = constants.HashZero;
    const counter = await marketplace.getCounter(offerer.address);

    const salt = "0x8460862738";
    // const salt =  !extraCheap ? randomHex() : constants.HashZero;
    const startTime = timeFlag !== "NOT_STARTED" ? 0 : toBN("0xee00000000000000000000000000");
    const endTime = timeFlag !== "EXPIRED" ? toBN("0xff00000000000000000000000000") : 1;

    const orderParameters = {
      offerer: offerer.address,
      zone: constants.AddressZero,
      offer,
      consideration,
      totalOriginalConsiderationItems: consideration.length,
      orderType,
      zoneHash,
      salt,
      conduitKey,
      startTime,
      endTime,
    };

    const orderComponents = {
      ...orderParameters,
      counter,
    };

    const orderHash = await getAndVerifyOrderHash(orderComponents);

    const { isValidated, isCancelled, totalFilled, totalSize } = await marketplace.getOrderStatus(orderHash);

    expect(isCancelled).to.equal(false);

    const orderStatus = {
      isValidated,
      isCancelled,
      totalFilled,
      totalSize,
    };

    const flatSig = await signOrder(orderComponents, signer ?? offerer, marketplace);

    const order = {
      parameters: orderParameters,
      signature: !extraCheap ? flatSig : convertSignatureToEIP2098(flatSig),
      numerator: 1, // only used for advanced orders
      denominator: 1, // only used for advanced orders
      extraData: "0x", // only used for advanced orders
    };

    if (useBulkSignature) {
      order.signature = await signBulkOrder([orderComponents], signer ?? offerer, bulkSignatureIndex, bulkSignatureHeight, extraCheap);

      // Verify bulk signature length
      expect(order.signature.slice(2).length / 2, "bulk signature length should be valid (98 < length < 837)")
        .to.be.gt(98)
        .and.lt(837);
      expect((order.signature.slice(2).length / 2 - 67) % 32, "bulk signature length should be valid ((length - 67) % 32 < 2)").to.be.lt(2);
    }

    // How much ether (at most) needs to be supplied when fulfilling the order
    const value = offer
      .map((x) => (x.itemType === 0 ? (x.endAmount.gt(x.startAmount) ? x.endAmount : x.startAmount) : toBN(0)))
      .reduce((a, b) => a.add(b), toBN(0))
      .add(
        consideration
          .map((x) => (x.itemType === 0 ? (x.endAmount.gt(x.startAmount) ? x.endAmount : x.startAmount) : toBN(0)))
          .reduce((a, b) => a.add(b), toBN(0))
      );

    return {
      order,
      orderHash,
      value,
      orderStatus,
      orderComponents,
      startTime,
      endTime,
    };
  };

  return {
    marketplaceContract,
    domainData,
    signOrder,
    signBulkOrder,
    createOrder,
  };
};
