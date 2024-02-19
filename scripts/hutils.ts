import { TransactionResponse } from "@ethersproject/providers";
import { readFileSync, writeFileSync } from "fs";
import { ethers, network, run } from "hardhat";

//----------------------------------- for hardhat config ---------------------------------
import { CustomChain } from "@nomiclabs/hardhat-etherscan/dist/src/types";
import { HardhatUserConfig, NetworksUserConfig } from "hardhat/types";

export type Chain = {
  name: string;
  id: number;
  rpc: string;
  scan?: string;
  scan_api?: string;
  scan_api_key?: string;
  // default [`${process.env.PRIVATE_KEY}`]
  accounts?: string[];
};

export function getApikey(supportChains: Chain[]) {
  return supportChains.reduce<Record<string, string>>((record, chain) => {
    record[chain.name] = chain.scan_api_key || "";
    return record;
  }, {});
}

export function getCustomChains(supportChains: Chain[]) {
  return supportChains.map<CustomChain>((chain) => {
    return { network: chain.name, chainId: chain.id, urls: { apiURL: chain.scan_api || "", browserURL: chain.scan || "" } };
  });
}

export function getEtherscan(supportChains: Chain[]) {
  return { apiKey: getApikey(supportChains), customChains: getCustomChains(supportChains) };
}

export function getNetworks(supportChains: Chain[]): NetworksUserConfig {
  return supportChains.reduce<NetworksUserConfig>((nets, chain) => {
    nets[chain.name] = {
      url: chain.rpc,
      accounts: chain.accounts || [`${process.env.PRIVATE_KEY}`],
    };
    return nets;
  }, {});
}

export function configChains(config: HardhatUserConfig, supportChains: Chain[]) {
  config.networks = {
    hardhat: {
      blockGasLimit: 30_000_000,
      throwOnCallFailures: false,
      // Temporarily remove contract size limit for local test
      allowUnlimitedContractSize: false,
    },
    ...getNetworks(supportChains),
    ...(config.networks || {}),
  };
  config.etherscan = {
    apiKey: getApikey(supportChains),
    customChains: getCustomChains(supportChains),
  };
  return config;
}

//------------------------------------ for deploy and verify ------------------------------

export type DeployedVerifyJson = { [k: string]: any };
export function getJson(): DeployedVerifyJson {
  const json = readFileSync("./json/" + network.name + ".json", "utf-8");
  const dto = JSON.parse(json || "{}") as any;
  return dto;
}

export function writeJson(dto: DeployedVerifyJson) {
  writeFileSync("./json/" + network.name + ".json", JSON.stringify(dto, undefined, 2));
}

export function saveAny(dto: DeployedVerifyJson) {
  const old = getJson() || {};
  const nDto = { ...old, ...dto };
  writeJson(nDto);
}

export async function deployContract(name: string, args: any[]) {
  const old = getJson()[name];
  const Factory = await ethers.getContractFactory(name);
  if (!old?.address) {
    const Contract = await Factory.deploy(...args);
    await Contract.deployed();
    saveAny({ [name]: { address: Contract.address, args } });
    console.info("deployed:", name, Contract.address);
    return Contract.address;
  } else {
    console.info("allredy deployed:", name, old.address);
    return old.address as string;
  }
}

export async function deployUseCreate2(name: string, salt: string, typeargs: any[] = []) {
  const AddCreate2 = "0x0000000000FFe8B47B3e2130213B802212439497";
  const immutableCreate2 = await ethers.getContractAt("ImmutableCreate2FactoryInterface", AddCreate2);
  let initCode = "";
  const factory = await ethers.getContractFactory(name);
  if (typeargs.length) {
    const encodeArgs = ethers.utils.defaultAbiCoder.encode(typeargs.slice(0, typeargs.length / 2), typeargs.slice(typeargs.length / 2));
    initCode = ethers.utils.solidityPack(["bytes", "bytes"], [factory.bytecode, encodeArgs]);
  } else {
    initCode = factory.bytecode;
  }
  if (!initCode) throw "Error";
  const address = ethers.utils.getCreate2Address(AddCreate2, salt, ethers.utils.keccak256(ethers.utils.hexlify(initCode)));
  const deployed = await immutableCreate2.hasBeenDeployed(address);
  if (deployed) {
    console.info("already-deployd:", name, address);
  } else {
    const tx = await immutableCreate2.safeCreate2(salt, initCode);
    await tx.wait(1);
    console.info("deplyed:", name, address);
  }
  saveAny({ [name]: { address, salt, args: typeargs.slice(typeargs.length / 2) } });
  return address;
}
export async function verfiy(key: string) {
  const json = getJson() || {};
  const item = json[key];
  if (item.args && item.address) {
    await run("verify:verify", {
      address: item.address,
      constructorArguments: item.args,
    }).catch((error) => {
      console.error(error);
    });
  }
}

export async function verifyAll() {
  const json = getJson() || {};
  for (const key in json) {
    console.info('start do verify:',key)
    await verfiy(key);
  }
}

export function wait1Tx<T extends TransactionResponse>(tx: T) {
  return tx.wait(1);
}

export function runAsync<T>(fn: () => Promise<T>, name: string = "Main") {
  fn()
    .catch(console.error)
    .then(() => console.info(name + " Finall"));
}
