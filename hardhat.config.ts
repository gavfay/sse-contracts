import { task } from "hardhat/config";
import { arbitrum, arbitrumSepolia, sepolia } from "viem/chains";
import { compareLastTwoReports } from "./scripts/compare_reports";
import { printLastReport } from "./scripts/print_report";
import { getReportPathForCommit } from "./scripts/utils";
import { writeReports } from "./scripts/write_reports";
import "dotenv/config";

import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-gas-reporter";

import type { HardhatUserConfig } from "hardhat/config";
import { NetworksUserConfig } from "hardhat/types";
import { CustomChain } from "@nomiclabs/hardhat-etherscan/dist/src/types";

//----------------------------------- for hardhat config ---------------------------------
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

const schains: Chain[] = [
  {
    name: "arbitrum",
    id: arbitrum.id,
    rpc: "https://arbitrum-one.public.blastapi.io",
    scan: "https://arbiscan.io/",
    scan_api: '"https://api.arbiscan.io/api',
    scan_api_key: process.env.ARBSCAN_KEY,
  },
  {
    name: "arbitrum_sepolia",
    id: arbitrumSepolia.id,
    rpc: "https://arbitrum-sepolia.public.blastapi.io",
    scan: "https://sepolia.arbiscan.io/",
    scan_api: "https://api-sepolia.arbiscan.io/api",
    scan_api_key: process.env.ARBSCAN_KEY,
  },
  {
    name: "sepolia",
    id: sepolia.id,
    rpc: "https://eth-sepolia.public.blastapi.io",
    scan: "https://sepolia.etherscan.io",
    scan_api: "https://api-sepolia.etherscan.io/api",
    scan_api_key: process.env.ETHERSCAN_KEY,
  },
];

task("write-reports", "Write pending gas reports").setAction(async (taskArgs, hre) => {
  writeReports(hre);
});

task("compare-reports", "Compare last two gas reports").setAction(async (taskArgs, hre) => {
  compareLastTwoReports(hre);
});

task("print-report", "Print the last gas report").setAction(async (taskArgs, hre) => {
  printLastReport(hre);
});

const optimizerSettingsNoSpecializer = {
  enabled: true,
  // runs: 4_294_967_295,
  runs: 20000,
  details: {
    peephole: true,
    inliner: true,
    jumpdestRemover: true,
    orderLiterals: true,
    deduplicate: true,
    cse: true,
    constantOptimizer: true,
    yulDetails: {
      stackAllocation: true,
      optimizerSteps:
        "dhfoDgvulfnTUtnIf[xa[r]EscLMcCTUtTOntnfDIulLculVcul [j]Tpeulxa[rul]xa[r]cLgvifCTUca[r]LSsTOtfDnca[r]Iulc]jmul[jul] VcTOcul jmul",
    },
  },
};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          viaIR: true,
          optimizer: {
            ...(process.env.NO_SPECIALIZER
              ? optimizerSettingsNoSpecializer
              : {
                  enabled: true,
                  // runs: 4_294_967_295 ,
                  runs: 20000,
                }),
          },
          metadata: {
            bytecodeHash: "none",
          },
          outputSelection: {
            "*": {
              "*": ["evm.assembly", "irOptimized", "devdoc"],
            },
          },
        },
      },
    ],
    overrides: {},
  },
  networks: {
    hardhat: {
      blockGasLimit: 30_000_000,
      throwOnCallFailures: false,
      // Temporarily remove contract size limit for local test
      allowUnlimitedContractSize: false,
    },
    verificationNetwork: {
      url: process.env.NETWORK_RPC ?? "",
    },
    ...getNetworks(schains),
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    outputFile: getReportPathForCommit(),
    noColors: true,
  },
  // specify separate cache for hardhat, since it could possibly conflict with foundry's
  paths: { cache: "hh-cache" },
  etherscan: getEtherscan(schains),
};

export default config;
