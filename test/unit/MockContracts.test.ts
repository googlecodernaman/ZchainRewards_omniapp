import { expect } from "chai";
import hre from "hardhat";

describe("Mock Contracts", function () {
  describe("Deployment", function () {
    it("Should deploy MockOracle contract", async function () {
      const MockOracle = await hre.ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracle.deploy();
      await mockOracle.waitForDeployment();
      
      expect(await mockOracle.getAddress()).to.be.properAddress;
      expect(await mockOracle.DECIMALS()).to.equal(8);
    });

    it("Should deploy MockZetaEndpoint contract", async function () {
      const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
      const mockEndpoint = await MockZetaEndpoint.deploy();
      await mockEndpoint.waitForDeployment();
      
      expect(await mockEndpoint.getAddress()).to.be.properAddress;
      expect(await mockEndpoint.nextCallId()).to.equal(0);
    });

    it("Should deploy MockReceiver contract", async function () {
      const MockReceiver = await hre.ethers.getContractFactory("MockReceiver");
      const mockReceiver = await MockReceiver.deploy();
      await mockReceiver.waitForDeployment();
      
      expect(await mockReceiver.getAddress()).to.be.properAddress;
      expect(await mockReceiver.payoutCount()).to.equal(0);
    });
  });

  describe("Basic Oracle Functionality", function () {
    let mockOracle: any;
    const USDC_ADDRESS = "0x1234567890123456789012345678901234567890";

    beforeEach(async function () {
      const MockOracle = await hre.ethers.getContractFactory("MockOracle");
      mockOracle = await MockOracle.deploy();
      await mockOracle.waitForDeployment();
    });

    it("Should set and get price", async function () {
      const price = hre.ethers.parseUnits("100", 8); // $100 with 8 decimals
      
      await mockOracle.setPrice(USDC_ADDRESS, price);
      const [retrievedPrice] = await mockOracle.getPrice(USDC_ADDRESS);
      
      expect(retrievedPrice).to.equal(price);
    });

    it("Should reject zero price", async function () {
      await expect(mockOracle.setPrice(USDC_ADDRESS, 0))
        .to.be.revertedWithCustomError(mockOracle, "InvalidPrice");
    });
  });
});
