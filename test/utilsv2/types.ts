import type { BigNumber } from "ethers";

export type AdditionalRecipient = {
  amount: BigNumber;
  recipient: string;
};

export type FulfillmentComponent = {
  orderIndex: number;
  itemIndex: number;
};

export type Fulfillment = {
  offerComponents: FulfillmentComponent[];
  considerationComponents: FulfillmentComponent[];
};

export type CriteriaResolver = {
  orderIndex: number;
  side: 0 | 1;
  index: number;
  identifier: BigNumber;
  criteriaProof: string[];
};

export type OfferItem = {
  itemType: number;
  token: string;
  identifierOrCriteria: BigNumber;
  startAmount: BigNumber;
  endAmount: BigNumber;
};
export type ConsiderationItem = {
  itemType: number;
  token: string;
  identifierOrCriteria: BigNumber;
  startAmount: BigNumber;
  endAmount: BigNumber;
  recipient: string;
};

export type OrderParameters = {
  offerer: string;
  zone: string;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
  orderType: number;
  startTime: string | BigNumber | number;
  endTime: string | BigNumber | number;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  totalOriginalConsiderationItems: string | BigNumber | number;
};

export type OrderComponents = Omit<
  OrderParameters,
  "totalOriginalConsiderationItems"
> & {
  counter: BigNumber;
};

export type Order = {
  parameters: OrderParameters;
  signature: string;
};

export type AdvancedOrder = {
  parameters: OrderParameters;
  numerator: string | BigNumber | number;
  denominator: string | BigNumber | number;
  signature: string;
  extraData: string;
};

export type BulkOrder = {
  tree: Array<Array<Array<Array<Array<Array<Array<OrderComponents>>>>>>>;
};
