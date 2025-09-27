import { expect } from "chai";
import hre from "hardhat";

describe("OmniRewards Integration Tests", function () {
  let omniRewards: any;
  let omniReceiver: any;
  let mockOracle: any;
  let mockZetaEndpoint: any;
  let owner: any;
  let user1: any;
  let recipient: any;

  const BSC_CHAIN_ID = 97;
  const ETH_CHAIN_ID = 5;

  beforeEach(async function () {
    console.log("\n=== DEPLOYING CONTRACTS FOR INTEGRATION TEST ===");

    [owner, user1, recipient] = await hre.ethers.getSigners();

    // Deploy MockOracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    console.log(`✓ MockOracle deployed`);

    // Deploy MockZetaEndpoint
    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();
    console.log(`✓ MockZetaEndpoint deployed`);

    // Deploy OmniRewards
    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();
    console.log(`✓ OmniRewards deployed`);

    // Deploy OmniReceiver
    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();
    console.log(`✓ OmniReceiver deployed`);

    // Set up oracle prices
    await mockOracle.setPrice("ETH", hre.ethers.parseUnits("2000", 18));
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    console.log(`✓ Oracle prices set`);

    console.log("=== SETUP COMPLETE ===\n");
  });

  describe("Contract Deployment & Setup", function () {
    it("Should deploy all contracts successfully", async function () {
      expect(await omniRewards.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await omniReceiver.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await mockOracle.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await mockZetaEndpoint.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      
      console.log("✓ All contracts deployed with valid addresses");
    });

    it("Should set correct owner", async function () {
      const contractOwner = await omniRewards.owner();
      expect(contractOwner).to.equal(await owner.getAddress());
      console.log("✓ Contract owner set correctly");
    });

    it("Should have oracle configured", async function () {
      const oracleAddress = await omniRewards.oracle();
      expect(oracleAddress).to.equal(await mockOracle.getAddress());
      console.log("✓ Oracle configured correctly");
    });
  });

  describe("Pool Management", function () {
    it("Should allow funding the pool", async function () {
      const fundAmount = hre.ethers.parseEther("5");
      
      await expect(omniRewards.connect(owner).fundPool({ value: fundAmount }))
        .to.emit(omniRewards, "PoolFunded")
        .withArgs(await owner.getAddress(), fundAmount);

      const poolBalance = await omniRewards.poolBalance();
      expect(poolBalance).to.equal(fundAmount);
      
      console.log(`✓ Pool funded with ${hre.ethers.formatEther(fundAmount)} ETH`);
    });

    it("Should allow only owner to fund pool", async function () {
      await expect(
        omniRewards.connect(user1).fundPool({ value: hre.ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(omniRewards, "OwnableUnauthorizedAccount");
      
      console.log("✓ Non-owner funding correctly rejected");
    });
  });

  describe("Oracle Integration", function () {
    it("Should calculate correct token amounts", async function () {
      const usdAmount = hre.ethers.parseUnits("600", 18); // $600 USD
      
      // ETH at $2000 should give 0.3 ETH
      const ethAmount = await mockOracle.getTokenAmount("ETH", usdAmount);
      expect(ethAmount).to.equal(hre.ethers.parseUnits("0.3", 18));
      
      // BNB at $300 should give 2 BNB
      const bnbAmount = await mockOracle.getTokenAmount("BNB", usdAmount);
      expect(bnbAmount).to.equal(hre.ethers.parseUnits("2", 18));
      
      console.log(`✓ $600 USD = ${hre.ethers.formatEther(ethAmount)} ETH`);
      console.log(`✓ $600 USD = ${hre.ethers.formatEther(bnbAmount)} BNB`);
    });

    it("Should reject stale oracle data", async function () {
      await mockOracle.setStale("ETH", true);
      
      await expect(
        mockOracle.getTokenAmount("ETH", hre.ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Oracle data is stale");
      
      console.log("✓ Stale oracle data correctly rejected");
    });
  });

  describe("Payout Scheduling", function () {
    beforeEach(async function () {
      // Fund the pool before testing payouts
      await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("10") });
    });

    it("Should schedule a payout successfully", async function () {
      const payoutAmount = hre.ethers.parseUnits("100", 18); // $100 USD
      const recipientAddress = await recipient.getAddress();
      const idempotencyKey = "test-payout-001";

      await expect(
        omniRewards.connect(owner).schedulePayout(
          recipientAddress,
          payoutAmount,
          BSC_CHAIN_ID,
          "BNB",
          idempotencyKey
        )
      ).to.emit(omniRewards, "PayoutScheduled")
       .withArgs(idempotencyKey, recipientAddress, payoutAmount, BSC_CHAIN_ID, "BNB");

      const payout = await omniRewards.payouts(idempotencyKey);
      expect(payout.recipient).to.equal(recipientAddress);
      expect(payout.usdAmount).to.equal(payoutAmount);
      expect(payout.destinationChainId).to.equal(BSC_CHAIN_ID);
      expect(payout.tokenSymbol).to.equal("BNB");
      expect(payout.status).to.equal(0); // SCHEDULED

      console.log("✓ Payout scheduled successfully");
    });

    it("Should prevent duplicate payouts", async function () {
      const payoutAmount = hre.ethers.parseUnits("100", 18);
      const recipientAddress = await recipient.getAddress();
      const idempotencyKey = "duplicate-test";

      // First payout should succeed
      await omniRewards.connect(owner).schedulePayout(
        recipientAddress,
        payoutAmount,
        BSC_CHAIN_ID,
        "BNB",
        idempotencyKey
      );

      // Second payout with same key should revert
      await expect(
        omniRewards.connect(owner).schedulePayout(
          recipientAddress,
          payoutAmount,
          BSC_CHAIN_ID,
          "BNB",
          idempotencyKey
        )
      ).to.be.revertedWith("Payout already exists");

      console.log("✓ Duplicate prevention working correctly");
    });

    it("Should reject unauthorized payout scheduling", async function () {
      await expect(
        omniRewards.connect(user1).schedulePayout(
          await recipient.getAddress(),
          hre.ethers.parseUnits("100", 18),
          BSC_CHAIN_ID,
          "BNB",
          "unauthorized-test"
        )
      ).to.be.revertedWithCustomError(omniRewards, "OwnableUnauthorizedAccount");

      console.log("✓ Unauthorized scheduling correctly rejected");
    });
  });

  describe("Cross-chain Message Handling", function () {
    beforeEach(async function () {
      await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("10") });
    });

    it("Should handle onCall for successful delivery", async function () {
      const idempotencyKey = "oncall-test";
      const recipientAddress = await recipient.getAddress();
      
      // Schedule payout first
      await omniRewards.connect(owner).schedulePayout(
        recipientAddress,
        hre.ethers.parseUnits("100", 18),
        BSC_CHAIN_ID,
        "BNB",
        idempotencyKey
      );

      // Prepare call data
      const expectedTokenAmount = await mockOracle.getTokenAmount(
        "BNB", 
        hre.ethers.parseUnits("100", 18)
      );
      
      const callData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "string"],
        [recipientAddress, expectedTokenAmount, idempotencyKey]
      );

      // Simulate onCall
      await expect(
        omniRewards.onCall(
          {
            sender: hre.ethers.ZeroAddress,
            sourceChainId: 7000,
            destinationAddress: await omniReceiver.getAddress(),
            gasLimit: 100000,
            message: callData
          },
          hre.ethers.ZeroAddress
        )
      ).to.emit(omniRewards, "PayoutSent")
       .withArgs(idempotencyKey, recipientAddress, expectedTokenAmount, BSC_CHAIN_ID);

      // Verify payout status updated
      const payout = await omniRewards.payouts(idempotencyKey);
      expect(payout.status).to.equal(1); // SENT

      console.log("✓ onCall handled successfully, payout marked as SENT");
    });

    it("Should handle onRevert for failed delivery", async function () {
      const idempotencyKey = "onrevert-test";
      const recipientAddress = await recipient.getAddress();
      
      // Schedule payout first
      await omniRewards.connect(owner).schedulePayout(
        recipientAddress,
        hre.ethers.parseUnits("100", 18),
        BSC_CHAIN_ID,
        "BNB",
        idempotencyKey
      );

      // Simulate onRevert
      const revertMessage = hre.ethers.toUtf8Bytes("Cross-chain delivery failed");
      
      await expect(
        omniRewards.onRevert(
          {
            sender: hre.ethers.ZeroAddress,
            sourceChainId: 7000,
            destinationAddress: await omniReceiver.getAddress(),
            gasLimit: 100000,
            message: hre.ethers.AbiCoder.defaultAbiCoder().encode(
              ["string"],
              [idempotencyKey]
            )
          },
          revertMessage
        )
      ).to.emit(omniRewards, "PayoutReverted")
       .withArgs(idempotencyKey, "Cross-chain delivery failed");

      // Verify payout status updated
      const payout = await omniRewards.payouts(idempotencyKey);
      expect(payout.status).to.equal(2); // REVERTED

      console.log("✓ onRevert handled successfully, payout marked as REVERTED");
    });
  });

  describe("Emergency Functions", function () {
    beforeEach(async function () {
      await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("5") });
    });

    it("Should allow owner to pause and unpause", async function () {
      await omniRewards.connect(owner).pause();
      
      // Should not be able to schedule when paused
      await expect(
        omniRewards.connect(owner).schedulePayout(
          await recipient.getAddress(),
          hre.ethers.parseUnits("100", 18),
          BSC_CHAIN_ID,
          "BNB",
          "paused-test"
        )
      ).to.be.revertedWithCustomError(omniRewards, "EnforcedPause");

      // Unpause and try again
      await omniRewards.connect(owner).unpause();
      
      await expect(
        omniRewards.connect(owner).schedulePayout(
          await recipient.getAddress(),
          hre.ethers.parseUnits("100", 18),
          BSC_CHAIN_ID,
          "BNB",
          "unpaused-test"
        )
      ).to.emit(omniRewards, "PayoutScheduled");

      console.log("✓ Pause/unpause functionality working correctly");
    });

    it("Should allow owner to withdraw from pool", async function () {
      const withdrawAmount = hre.ethers.parseEther("2");
      const initialBalance = await omniRewards.poolBalance();
      
      await expect(
        omniRewards.connect(owner).withdrawFromPool(withdrawAmount)
      ).to.emit(omniRewards, "PoolWithdrawn")
       .withArgs(await owner.getAddress(), withdrawAmount);

      const finalBalance = await omniRewards.poolBalance();
      expect(finalBalance).to.equal(initialBalance - withdrawAmount);

      console.log(`✓ Successfully withdrew ${hre.ethers.formatEther(withdrawAmount)} ETH from pool`);
    });
  });

  describe("Gas Usage Analysis", function () {
    beforeEach(async function () {
      await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("5") });
    });

    it("Should report gas usage for key operations", async function () {
      console.log("\n=== GAS USAGE ANALYSIS ===");

      // Test schedulePayout gas usage
      const scheduleTx = await omniRewards.connect(owner).schedulePayout(
        await recipient.getAddress(),
        hre.ethers.parseUnits("100", 18),
        BSC_CHAIN_ID,
        "BNB",
        "gas-test"
      );
      const scheduleReceipt = await scheduleTx.wait();
      console.log(`schedulePayout gas used: ${scheduleReceipt?.gasUsed}`);

      // Test fundPool gas usage
      const fundTx = await omniRewards.connect(owner).fundPool({ 
        value: hre.ethers.parseEther("1") 
      });
      const fundReceipt = await fundTx.wait();
      console.log(`fundPool gas used: ${fundReceipt?.gasUsed}`);

      console.log("=== GAS ANALYSIS COMPLETE ===\n");
    });
  });
});
