const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Mock Contracts Basic Tests", function () {
  describe("Contract Deployment", function () {
    it("Should deploy MockOracle successfully", async function () {
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const mockOracle = await MockOracle.deploy();
      await mockOracle.waitForDeployment();
      
      const address = await mockOracle.getAddress();
      expect(address).to.be.properAddress;
      
      const decimals = await mockOracle.DECIMALS();
      expect(decimals).to.equal(8);
    });

    it("Should deploy MockZetaEndpoint successfully", async function () {
      const MockZetaEndpoint = await ethers.getContractFactory("MockZetaEndpoint");
      const mockEndpoint = await MockZetaEndpoint.deploy();
      await mockEndpoint.waitForDeployment();
      
      const address = await mockEndpoint.getAddress();
      expect(address).to.be.properAddress;
      
      const callId = await mockEndpoint.nextCallId();
      expect(callId).to.equal(0);
    });
  });

  describe("MockOracle Basic Functionality", function () {
    let mockOracle;

    beforeEach(async function () {
      const MockOracle = await ethers.getContractFactory("MockOracle");
      mockOracle = await MockOracle.deploy();
      await mockOracle.waitForDeployment();
    });

    it("Should set and retrieve price", async function () {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const price = ethers.parseUnits("100", 8); // $100 with 8 decimals
      
      await mockOracle.setPrice(tokenAddress, price);
      const result = await mockOracle.getPrice(tokenAddress);
      
      expect(result[0]).to.equal(price); // price
      expect(result[1]).to.be.gt(0); // timestamp should be greater than 0
    });

    it("Should check if price is not stale initially", async function () {
      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const price = ethers.parseUnits("50", 8);
      
      await mockOracle.setPrice(tokenAddress, price);
      const isStale = await mockOracle.isStale(tokenAddress);
      
      expect(isStale).to.be.false;
    });
  });
});
