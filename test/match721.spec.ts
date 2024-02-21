import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { type Wallet, utils } from "ethers";
import { ethers, network } from "hardhat";

import { buildResolver, randomHex, toBN } from "./utilsv2/encoding";
import { faucet } from "./utilsv2/faucet";
import { marketFixture } from "./utilsv2/fixtures";
import { VERSION } from "./utilsv2/helpers";

import type { SseMarket, TestERC1155, TestERC20, TestERC721 } from "../typechain-types";
import type { MarketFixtures } from "./utilsv2/fixtures";
import type { BigNumber } from "ethers";

const { parseEther } = ethers.utils;

describe(`Mathch tests (SseMarket v${VERSION}) ERC20 <-> ERC721`, function () {
  const { provider } = ethers;
  const owner = new ethers.Wallet(randomHex(32), provider);

  let marketplaceContract: SseMarket;
  let testERC1155: TestERC1155;
  let testERC1155Two: TestERC1155;
  let testERC20: TestERC20;
  let testERC721: TestERC721;

  let createOrder: MarketFixtures["createOrder"];
  let createTransferWithApproval: MarketFixtures["createTransferWithApproval"];
  let getTestItem1155: MarketFixtures["getTestItem1155"];
  let mint1155: MarketFixtures["mint1155"];
  let mint721: MarketFixtures["mint721"];
  let getTestItem721: MarketFixtures["getTestItem721"];
  let getTestItem721WithCriteria: MarketFixtures["getTestItem721WithCriteria"];
  let mintAndApproveERC20: MarketFixtures["mintAndApproveERC20"];
  let set1155ApprovalForAll: MarketFixtures["set1155ApprovalForAll"];
  let set721ApprovalForAll: MarketFixtures["set721ApprovalForAll"];
  let getTestItem20: MarketFixtures["getTestItem20"];

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  before(async () => {
    await faucet(owner.address, provider);

    ({
      createOrder,
      createTransferWithApproval,
      getTestItem1155,
      marketplaceContract,
      mint1155,
      mint721,
      getTestItem721,
      getTestItem721WithCriteria,
      mintAndApproveERC20,
      set1155ApprovalForAll,
      set721ApprovalForAll,
      testERC1155,
      testERC1155Two,
      testERC20,
      testERC721,
      getTestItem20,
    } = await marketFixture(owner));
  });

  let maker: Wallet;
  let maker2: Wallet;
  let taker: Wallet;
  let taker2: Wallet;
  let member: Wallet;
  let feeReciver: Wallet;

  async function setupFixture() {
    // Setup basic taker/maker wallets with ETH
    const maker = new ethers.Wallet(randomHex(32), provider);
    const maker2 = new ethers.Wallet(randomHex(32), provider);
    const taker = new ethers.Wallet(randomHex(32), provider);
    const taker2 = new ethers.Wallet(randomHex(32), provider);
    const member = new ethers.Wallet(randomHex(32), provider);
    const feeReciver = new ethers.Wallet(randomHex(32), provider);
    await marketplaceContract.connect(owner).addMember(member.address);
    for (const wallet of [maker, maker2, taker, taker2, member]) {
      await faucet(wallet.address, provider);
    }

    return { maker, maker2, taker, taker2, member, feeReciver };
  }
  const fufillments = [
    { offerComponents: [{ orderIndex: 0, itemIndex: 0 }], considerationComponents: [{ orderIndex: 1, itemIndex: 0 }] },
    { offerComponents: [{ orderIndex: 1, itemIndex: 0 }], considerationComponents: [{ orderIndex: 0, itemIndex: 0 }] },
  ];
  const fufillmentsFeeList = [
    ...fufillments,
    { offerComponents: [{ orderIndex: 1, itemIndex: 0 }], considerationComponents: [{ orderIndex: 0, itemIndex: 1 }] },
  ];
  const fufillmentsFeeBid = [
    ...fufillments,
    { offerComponents: [{ orderIndex: 0, itemIndex: 0 }], considerationComponents: [{ orderIndex: 1, itemIndex: 1 }] },
  ];
  beforeEach(async () => {
    ({ maker, maker2, taker, taker2, member, feeReciver } = await loadFixture(setupFixture));
  });

  it("Full order match list", async () => {
    // maker
    const nftId = await mint721(maker);
    await set721ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721(nftId, 1, 1, taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("9"), parseEther("1")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId);
  });

  it("Full order match list slef", async () => {
    // maker
    const nftId = await mint721(maker);
    await set721ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721(nftId, 1, 1, maker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, maker.address, nftId);
  });
  it("Full order match Bid", async () => {
    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721WithCriteria(ethers.constants.AddressZero, 1, 1, maker.address)],
      0
    );
    // taker
    const nftId = await mint721(taker);
    await set721ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [getTestItem20(parseEther("8"), parseEther("10"), taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // makerOrder.order.numerator = 1;
    // makerOrder.order.denominator = 10;
    // backend
    await expect(marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords))
      .to.changeTokenBalances(testERC20, [marketplaceContract.address], [parseEther("10")])
      .emit(testERC721, "Transfer")
      .withArgs(taker.address, marketplaceContract.address, nftId);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("1"), parseEther("9")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, maker.address, nftId);
  });

  it("Full order match bid no lucky", async () => {
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721WithCriteria(ethers.constants.AddressZero, 1, 1, maker.address)],
      0
    );
    // taker
    const nftId = await mint721(taker);
    await set721ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [getTestItem20(parseEther("8"), parseEther("10"), taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await expect(marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords))
      .to.changeTokenBalances(testERC20, [marketplaceContract.address], [parseEther("10")])
      .emit(testERC721, "Transfer")
      .withArgs(taker.address, marketplaceContract.address, nftId);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("2"), parseEther("8")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, maker.address, nftId);
  });

  it("Zero assets match fot List", async () => {
    // maker
    const nftId = await mint721(maker);
    await set721ApprovalForAll(maker, marketplaceContract.address);
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [getTestItem20(Zero, parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(Zero, parseEther("9.5"))],
      [getTestItem721(nftId, 1, 1, taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 0, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], [Zero, parseEther("9.5")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId);
  });

  it("Primenum match", async () => {
    // maker
    const nftId = await mint721(maker);
    await set721ApprovalForAll(maker, marketplaceContract.address);
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [getTestItem20(parseEther("9"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("9.2"))],
      [getTestItem721(nftId, 1, 1, taker.address)],
      0
    );
    // preminum
    const preminumOrder = await createOrder(taker, ethers.constants.AddressZero, [getTestItem20(parseEther("1"), parseEther("1"))], [], 0);

    const reqIdOrNumWords = 1;
    // backend
    await expect(
      marketplaceContract
        .connect(member)
        .prepare([makerOrder.order, takerOrder.order, preminumOrder.order], [2], [maker.address], reqIdOrNumWords)
    ).to.changeTokenBalances(testERC20, [maker.address, marketplaceContract.address], [parseEther("1"), parseEther("9.2")]);

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 0, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("9"), parseEther("0.2")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId);
  });

  it("Transition fee work for List", async () => {
    // maker
    const nftId = await mint721(maker);
    await set721ApprovalForAll(maker, marketplaceContract.address);
    const fee = 5;
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [
        getTestItem20(subFee(parseEther("8")), subFee(parseEther("10")), maker.address),
        getTestItem20(culFee(parseEther("8")), culFee(parseEther("10")), feeReciver.address),
      ],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721(nftId, 1, 1, taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillmentsFeeList, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(
        testERC20,
        [maker.address, taker.address, feeReciver.address],
        [subFee(parseEther("9")), parseEther("1"), culFee(parseEther("9"))]
      )
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId);
  });

  it("Transition fee work for Bid", async () => {
    const nftId = await mint721(taker);
    // maker
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem721(nftId, 1, 1, maker.address)],
      0
    );
    // taker
    await set721ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [
        getTestItem20(subFee(parseEther("8")), subFee(parseEther("10")), taker.address),
        getTestItem20(culFee(parseEther("8")), culFee(parseEther("10")), feeReciver.address),
      ],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillmentsFeeBid, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(
        testERC20,
        [maker.address, taker.address, feeReciver.address],
        [parseEther("1"), subFee(parseEther("9")), culFee(parseEther("9"))]
      )
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, maker.address, nftId);
  });

  it("Partial order match bid (Only supports selling one ERC721 at a time)", async () => {
    const nftId = await mint721(taker);
    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("32"), parseEther("40"))],
      [getTestItem721WithCriteria(nftId, 4, 4, maker.address)],
      1 // Partial open
    );
    // taker
    await set721ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1)],
      [getTestItem20(parseEther("8"), parseEther("10"), taker.address)],
      0
    );
    // backend
    makerOrder.order.numerator = 1; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords = 1;
    await expect(
      marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords)
    ).to.changeTokenBalance(testERC20, marketplaceContract.address, parseEther("10"));

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(marketplaceContract, "MatchSuccessOrNot")
      .withArgs(reqIdOrNumWords, true)
      .changeTokenBalances(testERC20, [taker.address, maker.address], [parseEther("9"), parseEther("1")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, maker.address, nftId);
  });
  it("Partial order match bid (mulit 721 on once time should revert)", async () => {
    const nftId = await mint721(taker);
    const nftId2 = await mint721(taker);
    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("32"), parseEther("40"))],
      [getTestItem721WithCriteria(nftId, 4, 4, maker.address)],
      1 // Partial open
    );
    // taker
    await set721ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem721(nftId, 1, 1), getTestItem721(nftId2, 1, 1)],
      [getTestItem20(parseEther("16"), parseEther("20"), taker.address)],
      0
    );
    // backend
    makerOrder.order.numerator = 2; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords = 1;
    await expect(
      marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords)
    ).to.changeTokenBalance(testERC20, marketplaceContract.address, parseEther("20"));

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(marketplaceContract, "MatchSuccessOrNot")
      .withArgs(reqIdOrNumWords, false)
      .changeTokenBalances(testERC20, [taker.address, maker.address], [parseEther("0"), parseEther("20")])
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId)
      .emit(testERC721, "Transfer")
      .withArgs(marketplaceContract.address, taker.address, nftId2);
  });
});
