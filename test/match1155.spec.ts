import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { randomHex, toBN } from "./utilsv2/encoding";
import { faucet } from "./utilsv2/faucet";
import { marketFixture } from "./utilsv2/fixtures";
import { VERSION } from "./utilsv2/helpers";

import { BigNumber, type Wallet } from "ethers";
import type { SseMarket, TestERC1155, TestERC20, TestERC721 } from "../typechain-types";
import type { MarketFixtures } from "./utilsv2/fixtures";

const { parseEther, formatUnits } = ethers.utils;

describe(`Mathch tests (SseMarket v${VERSION}) ERC20 <-> ERC1155`, function () {
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
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20("8", "10", maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20("8", "10")],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
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
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address], ["9", "1"]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(1).toString());
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });
  it("Full order match list slef", async () => {
    // maker
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("7"), parseEther("9.5"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, maker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    const makerErc20Balance = await testERC20.balanceOf(maker.address);
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);

    await marketplaceContract
      .connect(member)
      .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
        { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
      ]);

    expect(await testERC20.balanceOf(maker.address).then((b) => b.toString())).to.be.eq(makerErc20Balance.toString());
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.toString());
  });
  it("Full order match bid", async () => {
    const { nftId, amount } = await mint1155(maker);
    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("7"), parseEther("9.5"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
      0
    );

    // maker
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address)],
      0
    );

    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([takerOrder.order, makerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([takerOrder.order, makerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("9"), parseEther("0.5")]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(1).toString());
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });
  it("Full order match bid no lucky", async () => {
    const { nftId, amount } = await mint1155(maker);
    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20("8", "10")],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
      0
    );

    // maker
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20("8", "10", maker.address)],
      0
    );

    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([takerOrder.order, makerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([takerOrder.order, makerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address], ["8", "2"]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(1).toString());
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });

  it("Partial order match listing", async () => {
    // maker
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 4, 4)],
      [getTestItem20(parseEther("32"), parseEther("40"), maker.address)],
      1 // Partial open
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("24"), parseEther("30"))],
      [getTestItem1155(nftId, 3, 3, testERC1155.address, taker.address)],
      0
    );

    // backend
    makerOrder.order.numerator = 3; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords = 2;

    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(3).toString());
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(marketplaceContract, "MatchSuccessOrNot")
      .withArgs(reqIdOrNumWords, true)
      .changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("27"), parseEther("3")]);
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("3");

    // taker2
    await mintAndApproveERC20(taker2, marketplaceContract.address, parseEther("100"));
    const takerOrder2 = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker2.address)],
      0
    );

    // backend
    makerOrder.order.numerator = 1; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords2 = 2;
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder2.order], [], [], reqIdOrNumWords);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(4).toString());

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder2.order], fufillments, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(marketplaceContract, "MatchSuccessOrNot")
      .withArgs(reqIdOrNumWords2, true)
      .changeTokenBalances(testERC20, [maker.address, taker2.address], [parseEther("9"), parseEther("1")]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(4).toString());
    expect(await testERC1155.balanceOf(taker2.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });
  it("Partial order match bid", async () => {
    const { nftId, amount } = await mint1155(taker);
    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("32"), parseEther("40"))],
      [getTestItem1155(nftId, 4, 4, testERC1155.address, maker.address)],
      1 // Partial open
    );
    // taker
    await set1155ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 3, 3, testERC1155.address)],
      [getTestItem20(parseEther("24"), parseEther("30"), taker.address)],
      0
    );
    // backend
    makerOrder.order.numerator = 3; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords = 2;
    await expect(
      marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords)
    ).to.changeTokenBalance(testERC20, marketplaceContract.address, parseEther("30"));

    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.emit(marketplaceContract, "MatchSuccessOrNot")
      .withArgs(reqIdOrNumWords, true)
      .changeTokenBalances(testERC20, [taker.address, maker.address], [parseEther("27"), parseEther("3")]);
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(3).toString());
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq("3");
  });

  it("Zero assets match fot List", async () => {
    // maker
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20(Zero, parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(Zero, parseEther("9.5"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
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
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address], [Zero, parseEther("9.5")]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(1).toString());
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });
  it("Multi zero assets match for bid", async () => {
    const nftId = 1,
      amount = 10;
    await mint1155(taker, 1, testERC1155, nftId, amount);
    await mint1155(taker2, 1, testERC1155, nftId, amount);
    await set1155ApprovalForAll(taker, marketplaceContract.address);
    await set1155ApprovalForAll(taker2, marketplaceContract.address);
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("1000"));
    // maker
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(Zero, parseEther("20"))],
      [getTestItem1155(nftId, 2, 2, testERC1155.address, maker.address)],
      0
    );
    // taker
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1, testERC1155.address)],
      [getTestItem20(Zero, parseEther("10"), taker.address)],
      0
    );
    // taker2
    const taker2Order = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1, testERC1155.address)],
      [getTestItem20(Zero, parseEther("10"), taker2.address)],
      0
    );
    const reqIdOrNumWords = 2;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order, taker2Order.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract.connect(member).matchOrdersWithRandom(
        [makerOrder.order, takerOrder.order, taker2Order.order],
        [
          { offerComponents: [{ orderIndex: 0, itemIndex: 0 }], considerationComponents: [{ orderIndex: 1, itemIndex: 0 }] },
          { offerComponents: [{ orderIndex: 1, itemIndex: 0 }], considerationComponents: [{ orderIndex: 0, itemIndex: 0 }] },
          { offerComponents: [{ orderIndex: 0, itemIndex: 0 }], considerationComponents: [{ orderIndex: 2, itemIndex: 0 }] },
          { offerComponents: [{ orderIndex: 2, itemIndex: 0 }], considerationComponents: [{ orderIndex: 0, itemIndex: 0 }] },
        ],
        reqIdOrNumWords,
        [
          { orderHash: takerOrder.orderHash, numerator: 0, denominator: 2 },
          { orderHash: taker2Order.orderHash, numerator: 1, denominator: 2 },
        ]
      )
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address, taker2.address], [parseEther("15"), Zero, parseEther("5")]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq("2");
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq(amount - 1 + "");
    expect(await testERC1155.balanceOf(taker2.address, nftId).then((b) => b.toString())).to.be.eq(amount - 1 + "");
  });

  it("Primenum match", async () => {
    // maker
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
      [getTestItem20(parseEther("9"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("9.2"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
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
    ).to.changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("9"), parseEther("0.2")]);
    expect(await testERC1155.balanceOf(maker.address, nftId).then((b) => b.toString())).to.be.eq(amount.sub(1).toString());
    expect(await testERC1155.balanceOf(taker.address, nftId).then((b) => b.toString())).to.be.eq("1");
  });

  it("Transition fee work for List", async () => {
    // maker
    const { nftId, amount } = await mint1155(maker);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    const fee = 5;
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1)],
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
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
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
    ).to.changeTokenBalances(
      testERC20,
      [maker.address, taker.address, feeReciver.address],
      [subFee(parseEther("9")), parseEther("1"), culFee(parseEther("9"))]
    );
  });

  it("Transition fee work for Bid", async () => {
    const { nftId, amount } = await mint1155(taker);
    // maker
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, maker.address)],
      0
    );
    // taker
    await set1155ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1, testERC1155.address)],
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
    ).to.changeTokenBalances(
      testERC20,
      [maker.address, taker.address, feeReciver.address],
      [parseEther("1"), subFee(parseEther("9")), culFee(parseEther("9"))]
    );
  });

  it("Transition fee work for Partial List", async () => {
    const nftId = 1;
    await mint1155(maker, 1, testERC1155, nftId);
    await set1155ApprovalForAll(maker, marketplaceContract.address);
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    await mintAndApproveERC20(taker2, marketplaceContract.address, parseEther("100"));
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));

    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 3, 3, testERC1155.address)],
      [
        getTestItem20(subFee(parseEther("24")), subFee(parseEther("30")), maker.address),
        getTestItem20(culFee(parseEther("24")), culFee(parseEther("30")), feeReciver.address),
      ],
      1
    );
    // taker1
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem1155(nftId, 1, 1, testERC1155.address, taker.address)],
      0
    );
    const reqIdOrNumWords = 1;
    makerOrder.order.numerator = 1;
    makerOrder.order.denominator = 3;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillmentsFeeList, reqIdOrNumWords, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(
      testERC20,
      [taker.address, maker.address, feeReciver.address],
      [parseEther("1"), subFee(parseEther("9")), culFee(parseEther("9"))]
    );

    // taker2
    const taker2Order = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("16"), parseEther("20"))],
      [getTestItem1155(nftId, 2, 2, testERC1155.address, taker.address)],
      0
    );
    const reqIdOrNumWords2 = 2;
    // backend
    makerOrder.order.numerator = 2;
    makerOrder.order.denominator = 3;
    await marketplaceContract.connect(member).prepare([makerOrder.order, taker2Order.order], [], [], reqIdOrNumWords2);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, taker2Order.order], fufillmentsFeeList, reqIdOrNumWords2, [
          { orderHash: makerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(
      testERC20,
      [taker2.address, maker.address, feeReciver.address],
      [parseEther("2"), subFee(parseEther("18")), culFee(parseEther("18"))]
    );
  });

  it("Transition fee work for Partial Bid", async () => {
    const nftId = 1;
    await mint1155(taker, 1, testERC1155, nftId);
    await mint1155(taker2, 1, testERC1155, nftId);
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));

    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("24"), parseEther("30"))],
      [getTestItem1155(nftId, 3, 3, testERC1155.address, maker.address)],
      1
    );
    // taker1
    await set1155ApprovalForAll(taker, marketplaceContract.address);
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 1, 1, testERC1155.address)],
      [
        getTestItem20(subFee(parseEther("8")), subFee(parseEther("10")), taker.address),
        getTestItem20(culFee(parseEther("8")), culFee(parseEther("10")), feeReciver.address),
      ],
      0
    );
    const reqIdOrNumWords = 1;
    makerOrder.order.numerator = 1;
    makerOrder.order.denominator = 3;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillmentsFeeBid, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(
      testERC20,
      [maker.address, taker.address, feeReciver.address],
      [parseEther("1"), subFee(parseEther("9")), culFee(parseEther("9"))]
    );

    // taker2
    await set1155ApprovalForAll(taker2, marketplaceContract.address);
    const taker2Order = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem1155(nftId, 2, 2, testERC1155.address)],
      [
        getTestItem20(subFee(parseEther("16")), subFee(parseEther("20")), taker2.address),
        getTestItem20(culFee(parseEther("16")), culFee(parseEther("20")), feeReciver.address),
      ],
      0
    );
    const reqIdOrNumWords2 = 2;
    // backend
    makerOrder.order.numerator = 2;
    makerOrder.order.denominator = 3;
    await marketplaceContract.connect(member).prepare([makerOrder.order, taker2Order.order], [], [], reqIdOrNumWords2);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, taker2Order.order], fufillmentsFeeBid, reqIdOrNumWords2, [
          { orderHash: taker2Order.orderHash, numerator: 1, denominator: 2 },
        ])
    ).to.changeTokenBalances(
      testERC20,
      [maker.address, taker2.address, feeReciver.address],
      [parseEther("2"), subFee(parseEther("18")), culFee(parseEther("18"))]
    );
  });
});
