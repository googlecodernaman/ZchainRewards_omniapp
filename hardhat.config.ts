import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-mocha";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
    },
    zetachainTestnet: {
      type: "http",
      url: "https://zetachain-athens-evm.blockpi.network/v1/rpc/public",
      chainId: 7001,
      accounts: process.env.PRIVATE_KEY_ADMIN ? [process.env.PRIVATE_KEY_ADMIN] : [],
    },
    polygonMumbai: {
      type: "http",
      url: "https://rpc-mumbai.maticvigil.com",
      chainId: 80001,
      accounts: process.env.PRIVATE_KEY_ADMIN ? [process.env.PRIVATE_KEY_ADMIN] : [],
    },
    baseSepolia: {
      type: "http",
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.PRIVATE_KEY_ADMIN ? [process.env.PRIVATE_KEY_ADMIN] : [],
    },
    ethSepolia: {
      type: "http",
      url: "https://sepolia.drpc.org",
      chainId: 11155111,
      accounts: process.env.PRIVATE_KEY_ADMIN ? [process.env.PRIVATE_KEY_ADMIN] : [],
    },
  },
  // etherscan and gasReporter configs will be added later if needed
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  // typechain configuration removed for compatibility
};

export default config;
