import { expect } from "chai";
import hre from "hardhat";

describe("MockOracle", function () {
  let mockOracle: MockOracle;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  // Test token addresses
  const USDC_ADDRESS = "0xa0b86a33e6f8fbF8b8B0B6D24E6f9f8e8e8b8b5";
  const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const MockOracleFactory = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracleFactory.deploy();
    await mockOracle.waitForDeployment();
  });

  describe("Price Setting", function () {
    it("Should set price correctly", async function () {
      const price = ethers.parseUnits("100", 8); // $100 with 8 decimals
      
      await expect(mockOracle.setPrice(USDC_ADDRESS, price))
        .to.emit(mockOracle, "PriceUpdated")
        .withArgs(USDC_ADDRESS, price, await mockOracle.runner!.provider!.getBlock("latest").then(b => b!.timestamp));

      const [retrievedPrice, timestamp] = await mockOracle.getPrice(USDC_ADDRESS);
      expect(retrievedPrice).to.equal(price);
      expect(timestamp).to.be.greaterThan(0);
    });

    it("Should reject zero price", async function () {
      await expect(mockOracle.setPrice(USDC_ADDRESS, 0))
        .to.be.revertedWithCustomError(mockOracle, "InvalidPrice");
    });

    it("Should set price with custom timestamp", async function () {
      const price = ethers.parseUnits("50", 8);
      const customTimestamp = Math.floor(Date.now() / 1000) - 1000; // 1000 seconds ago

      await mockOracle.setPriceWithTimestamp(USDC_ADDRESS, price, customTimestamp);

      const [retrievedPrice, timestamp] = await mockOracle.getPriceUnchecked(USDC_ADDRESS);
      expect(retrievedPrice).to.equal(price);
      expect(timestamp).to.equal(customTimestamp);
    });
  });

  describe("Staleness Checks", function () {
    it("Should return fresh price", async function () {
      const price = ethers.parseUnits("100", 8);
      await mockOracle.setPrice(USDC_ADDRESS, price);

      // Should not revert for fresh price
      const [retrievedPrice] = await mockOracle.getPrice(USDC_ADDRESS);
      expect(retrievedPrice).to.equal(price);
    });

    it("Should reject stale price", async function () {
      const price = ethers.parseUnits("100", 8);
      const staleTimestamp = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
      
      await mockOracle.setPriceWithTimestamp(USDC_ADDRESS, price, staleTimestamp);

      await expect(mockOracle.getPrice(USDC_ADDRESS))
        .to.be.revertedWithCustomError(mockOracle, "StalePriceFeed");
    });

    it("Should check staleness correctly", async function () {
      const price = ethers.parseUnits("100", 8);
      
      // Fresh price
      await mockOracle.setPrice(USDC_ADDRESS, price);
      expect(await mockOracle.isStale(USDC_ADDRESS)).to.be.false;

      // Stale price
      const staleTimestamp = Math.floor(Date.now() / 1000) - 7200;
      await mockOracle.setPriceWithTimestamp(USDC_ADDRESS, price, staleTimestamp);
      expect(await mockOracle.isStale(USDC_ADDRESS)).to.be.true;
    });

    it("Should update staleness threshold", async function () {
      const newThreshold = 7200; // 2 hours
      
      await expect(mockOracle.setStalenessThreshold(newThreshold))
        .to.emit(mockOracle, "StalenessThresholdUpdated")
        .withArgs(newThreshold);

      expect(await mockOracle.stalenessThreshold()).to.equal(newThreshold);
    });
  });

  describe("Price Feed Status", function () {
    it("Should deactivate price feed", async function () {
      const price = ethers.parseUnits("100", 8);
      await mockOracle.setPrice(USDC_ADDRESS, price);

      // Should work when active
      await mockOracle.getPrice(USDC_ADDRESS);

      // Deactivate
      await mockOracle.deactivateFeed(USDC_ADDRESS);

      // Should revert when inactive
      await expect(mockOracle.getPrice(USDC_ADDRESS))
        .to.be.revertedWithCustomError(mockOracle, "InactivePriceFeed");
    });
  });

  describe("USD Conversions", function () {
    beforeEach(async function () {
      // Set USDC price to $1.00 (with 8 decimals)
      await mockOracle.setPrice(USDC_ADDRESS, ethers.parseUnits("1", 8));
      
      // Set ETH price to $2000.00 (with 8 decimals)
      await mockOracle.setPrice(ETH_ADDRESS, ethers.parseUnits("2000", 8));
    });

    it("Should calculate USD value correctly", async function () {
      // 100 USDC (18 decimals) should be worth $100
      const usdcAmount = ethers.parseUnits("100", 18);
      const usdValue = await mockOracle.getUSDValue(USDC_ADDRESS, usdcAmount);
      expect(usdValue).to.equal(ethers.parseUnits("100", 18)); // $100

      // 1 ETH (18 decimals) should be worth $2000
      const ethAmount = ethers.parseUnits("1", 18);
      const ethUsdValue = await mockOracle.getUSDValue(ETH_ADDRESS, ethAmount);
      expect(ethUsdValue).to.equal(ethers.parseUnits("2000", 18)); // $2000
    });

    it("Should calculate token amount from USD correctly", async function () {
      // $100 should buy 100 USDC
      const usdAmount = ethers.parseUnits("100", 18);
      const usdcAmount = await mockOracle.getTokenAmount(USDC_ADDRESS, usdAmount);
      expect(usdcAmount).to.equal(ethers.parseUnits("100", 18));

      // $2000 should buy 1 ETH
      const ethAmount = await mockOracle.getTokenAmount(ETH_ADDRESS, usdAmount);
      expect(ethAmount).to.equal(ethers.parseUnits("0.05", 18)); // 0.05 ETH for $100
    });
  });

  describe("Price Age", function () {
    it("Should return correct price age", async function () {
      const price = ethers.parseUnits("100", 8);
      const pastTimestamp = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
      
      await mockOracle.setPriceWithTimestamp(USDC_ADDRESS, price, pastTimestamp);
      
      const age = await mockOracle.getPriceAge(USDC_ADDRESS);
      expect(age).to.be.greaterThanOrEqual(290); // Should be around 300 seconds
      expect(age).to.be.lessThanOrEqual(310);
    });
  });
});
