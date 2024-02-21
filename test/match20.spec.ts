import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { type Wallet } from "ethers";
import { ethers, network } from "hardhat";

import { randomHex, toBN } from "./utilsv2/encoding";
import { faucet } from "./utilsv2/faucet";
import { marketFixture } from "./utilsv2/fixtures";
import { VERSION } from "./utilsv2/helpers";

import type { SseMarket, TestERC20 } from "../typechain-types";
import type { MarketFixtures } from "./utilsv2/fixtures";
import type { BigNumber } from "ethers";

const { parseEther } = ethers.utils;

describe(`Mathch tests (SseMarket v${VERSION}) ERC20 <-> ERC20`, function () {
  const { provider } = ethers;
  const owner = new ethers.Wallet(randomHex(32), provider);

  let marketplaceContract: SseMarket;
  let testERC20: TestERC20;
  let testERC20_2: TestERC20;

  let createOrder: MarketFixtures["createOrder"];
  let mintAndApproveERC20: MarketFixtures["mintAndApproveERC20"];
  let mintAndApproveERC20_2: MarketFixtures["mintAndApproveERC20_2"];
  let getTestItem20: MarketFixtures["getTestItem20"];

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  before(async () => {
    await faucet(owner.address, provider);

    ({ createOrder, marketplaceContract, mintAndApproveERC20, mintAndApproveERC20_2, testERC20, testERC20_2, getTestItem20 } =
      await marketFixture(owner));
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
      await mintAndApproveERC20_2(testERC20, wallet, marketplaceContract.address, parseEther("100"));
      await mintAndApproveERC20_2(testERC20_2, wallet, marketplaceContract.address, parseEther("100"));
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

  it("Full order match List", async () => {
    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("8"), undefined, testERC20_2.address)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address, testERC20.address)],
      0
    );
    // taker
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"), undefined, testERC20.address)],
      [getTestItem20(parseEther("8"), parseEther("8"), taker.address, testERC20_2.address)],
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
      .to.changeTokenBalances(testERC20_2, [maker.address, taker.address], [parseEther("0"), parseEther("8")])
      .changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("9"), parseEther("1")]);
  });

  it("Full order match List (self)", async () => {
    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("8"), undefined, testERC20_2.address)],
      [getTestItem20(parseEther("8"), parseEther("10"), maker.address, testERC20.address)],
      0
    );
    // taker
    const takerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"), undefined, testERC20.address)],
      [getTestItem20(parseEther("8"), parseEther("8"), maker.address, testERC20_2.address)],
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
      .to.changeTokenBalances(testERC20_2, [maker.address], [parseEther("8")])
      .changeTokenBalances(testERC20, [maker.address], [parseEther("10")]);
  });

  it("Full order match Bid", async () => {
    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"), undefined, testERC20.address)],
      [getTestItem20(parseEther("8"), parseEther("8"), maker.address, testERC20_2.address)],
      0
    );
    // taker
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("8"), undefined, testERC20_2.address)],
      [getTestItem20(parseEther("8"), parseEther("10"), taker.address, testERC20.address)],
      0
    );
    const reqIdOrNumWords = 1;
    // backend
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
    await expect(
      marketplaceContract
        .connect(member)
        .matchOrdersWithRandom([makerOrder.order, takerOrder.order], fufillments, reqIdOrNumWords, [
          { orderHash: takerOrder.orderHash, numerator: 1, denominator: 2 },
        ])
    )
      .to.changeTokenBalances(testERC20_2, [maker.address, taker.address], [parseEther("8"), parseEther("0")])
      .changeTokenBalances(testERC20, [maker.address, taker.address], [parseEther("1"), parseEther("9")]);
  });

  it("Full order match bid no lucky", async () => {
    // taker

    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20("8", "10")],
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
      0
    );

    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
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
    )
      .to.changeTokenBalances(testERC20, [maker.address, taker.address], ["8", "2"])
      .changeTokenBalances(testERC20_2, [maker.address, taker.address], [0, 1]);
  });

  it("Partial order match listing", async () => {
    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(4, 4, undefined, testERC20_2.address)],
      [getTestItem20(parseEther("32"), parseEther("40"), maker.address)],
      1 // Partial open
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("24"), parseEther("30"))],
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
      0
    );

    // backend
    makerOrder.order.numerator = 3; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords = 2;
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder.order], [], [], reqIdOrNumWords);
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

    // taker2
    await mintAndApproveERC20(taker2, marketplaceContract.address, parseEther("100"));
    const takerOrder2 = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem20(1, 1, taker2.address, testERC20_2.address)],
      0
    );

    // backend
    makerOrder.order.numerator = 1; // partial 分子
    makerOrder.order.denominator = 4; // partial 分母
    const reqIdOrNumWords2 = 2;
    await marketplaceContract.connect(member).prepare([makerOrder.order, takerOrder2.order], [], [], reqIdOrNumWords);

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
  });
  it("Partial order match bid", async () => {
    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("32"), parseEther("40"))],
      [getTestItem20(4, 4, maker.address, testERC20_2.address)],
      1 // Partial open
    );
    // taker

    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(3, 3, undefined, testERC20_2.address)],
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
  });

  it("Zero assets match fot List", async () => {
    // maker
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
      [getTestItem20(Zero, parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(Zero, parseEther("9.5"))],
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
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
  });
  it("Multi zero assets match for bid", async () => {
    // maker
    const Zero = toBN("0");
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(Zero, parseEther("20"))],
      [getTestItem20(2, 2, maker.address, testERC20_2.address)],
      0
    );
    // taker
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
      [getTestItem20(Zero, parseEther("10"), taker.address)],
      0
    );
    // taker2
    const taker2Order = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
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
  });

  it("Primenum match", async () => {
    // maker

    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
      [getTestItem20(parseEther("9"), parseEther("10"), maker.address)],
      0
    );

    // taker
    await mintAndApproveERC20(taker, marketplaceContract.address, parseEther("100"));
    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("9.2"))],
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
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
  });

  it("Transition fee work for List", async () => {
    // maker

    const fee = 5;
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
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
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
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
    // maker
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));

    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("8"), parseEther("10"))],
      [getTestItem20(1, 1, maker.address, testERC20_2.address)],
      0
    );
    // taker

    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
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
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));

    // maker
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(3, 3, undefined, testERC20_2.address)],
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
      [getTestItem20(1, 1, taker.address, testERC20_2.address)],
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
      [getTestItem20(2, 2, taker2.address, testERC20_2.address)],
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
    const fee = 5; // 5/1000
    const culFee = (p: BigNumber) => p.mul(fee).div(1000);
    const subFee = (p: BigNumber) => p.sub(culFee(p));

    // maker
    await mintAndApproveERC20(maker, marketplaceContract.address, parseEther("100"));
    const makerOrder = await createOrder(
      maker,
      ethers.constants.AddressZero,
      [getTestItem20(parseEther("24"), parseEther("30"))],
      [getTestItem20(3, 3, maker.address, testERC20_2.address)],
      1
    );
    // taker1

    const takerOrder = await createOrder(
      taker,
      ethers.constants.AddressZero,
      [getTestItem20(1, 1, undefined, testERC20_2.address)],
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

    const taker2Order = await createOrder(
      taker2,
      ethers.constants.AddressZero,
      [getTestItem20(2, 2, undefined, testERC20_2.address)],
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
