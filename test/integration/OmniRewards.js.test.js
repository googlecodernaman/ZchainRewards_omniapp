// SPDX-License-Identifier: MIT
const hre = require("hardhat");
const { expect } = require("chai");

describe("OmniRewards Integration Tests", function () {
  it("Should compile and deploy all contracts successfully", async function () {
    console.log("\n=== INTEGRATION TEST: CONTRACT DEPLOYMENT ===");

    const [owner, user1, recipient] = await hre.ethers.getSigners();
    console.log(`Owner address: ${owner.address}`);

    // Deploy MockOracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    console.log(`✓ MockOracle deployed at: ${await mockOracle.getAddress()}`);

    // Deploy MockZetaEndpoint  
    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    const mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();
    console.log(`✓ MockZetaEndpoint deployed at: ${await mockZetaEndpoint.getAddress()}`);

    // Deploy OmniRewards
    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    const omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();
    console.log(`✓ OmniRewards deployed at: ${await omniRewards.getAddress()}`);

    // Deploy OmniReceiver
    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    const omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();
    console.log(`✓ OmniReceiver deployed at: ${await omniReceiver.getAddress()}`);

    // Basic verification
    expect(await omniRewards.owner()).to.equal(owner.address);
    expect(await omniRewards.oracle()).to.equal(await mockOracle.getAddress());
    console.log("✓ Contract ownership and oracle configuration verified");

    console.log("=== ALL CONTRACTS DEPLOYED SUCCESSFULLY ===\n");
  });

  it("Should verify oracle functionality", async function () {
    console.log("\n=== INTEGRATION TEST: ORACLE FUNCTIONALITY ===");

    const [owner] = await hre.ethers.getSigners();

    // Deploy MockOracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();

    // Set prices
    await mockOracle.setPrice("ETH", hre.ethers.parseUnits("2000", 18));
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    console.log("✓ Oracle prices set (ETH: $2000, BNB: $300)");

    // Test token amount calculations
    const usdAmount = hre.ethers.parseUnits("600", 18); // $600
    const ethAmount = await mockOracle.getTokenAmount("ETH", usdAmount);
    const bnbAmount = await mockOracle.getTokenAmount("BNB", usdAmount);

    console.log(`✓ $600 USD converts to:`);
    console.log(`  - ${hre.ethers.formatUnits(ethAmount, 18)} ETH`);
    console.log(`  - ${hre.ethers.formatUnits(bnbAmount, 18)} BNB`);

    // Verify calculations are correct
    expect(ethAmount).to.equal(hre.ethers.parseUnits("0.3", 18)); // $600 / $2000 = 0.3 ETH
    expect(bnbAmount).to.equal(hre.ethers.parseUnits("2", 18));   // $600 / $300 = 2 BNB

    console.log("=== ORACLE FUNCTIONALITY VERIFIED ===\n");
  });

  it("Should verify complete payout workflow", async function () {
    console.log("\n=== INTEGRATION TEST: COMPLETE PAYOUT WORKFLOW ===");

    const [owner, recipient] = await hre.ethers.getSigners();

    // Deploy all contracts
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();

    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    const mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();

    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    const omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();

    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    const omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();

    // Setup
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    console.log("✓ Oracle configured");

    // Fund the pool
    const fundAmount = hre.ethers.parseEther("5");
    await omniRewards.connect(owner).fundPool({ value: fundAmount });
    const poolBalance = await omniRewards.poolBalance();
    expect(poolBalance).to.equal(fundAmount);
    console.log(`✓ Pool funded with ${hre.ethers.formatEther(fundAmount)} ETH`);

    // Schedule a payout
    const payoutAmount = hre.ethers.parseUnits("150", 18); // $150 USD
    const recipientAddress = recipient.address;
    const idempotencyKey = "integration-test-complete";

    const tx = await omniRewards.connect(owner).schedulePayout(
      recipientAddress,
      payoutAmount,
      97, // BSC Chain ID
      "BNB",
      idempotencyKey
    );
    await tx.wait();
    console.log("✓ Payout scheduled successfully");

    // Verify payout is stored correctly
    const payout = await omniRewards.payouts(idempotencyKey);
    expect(payout.recipient).to.equal(recipientAddress);
    expect(payout.usdAmount).to.equal(payoutAmount);
    expect(payout.destinationChainId).to.equal(97);
    expect(payout.tokenSymbol).to.equal("BNB");
    expect(payout.status).to.equal(0); // SCHEDULED
    console.log("✓ Payout data verification complete");

    // Simulate successful cross-chain delivery
    const expectedTokenAmount = await mockOracle.getTokenAmount("BNB", payoutAmount);
    console.log(`✓ Expected token amount: ${hre.ethers.formatEther(expectedTokenAmount)} BNB`);

    const callData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "string"],
      [recipientAddress, expectedTokenAmount, idempotencyKey]
    );

    const onCallTx = await omniRewards.onCall(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: await omniReceiver.getAddress(),
        gasLimit: 100000,
        message: callData
      },
      hre.ethers.ZeroAddress
    );
    await onCallTx.wait();
    console.log("✓ Cross-chain delivery simulation completed");

    // Verify payout status updated to SENT
    const updatedPayout = await omniRewards.payouts(idempotencyKey);
    expect(updatedPayout.status).to.equal(1); // SENT
    console.log("✓ Payout status updated to SENT");

    // Test revert handling
    const revertKey = "revert-test";
    await omniRewards.connect(owner).schedulePayout(
      recipientAddress,
      hre.ethers.parseUnits("100", 18),
      97,
      "BNB",
      revertKey
    );

    const revertMessage = hre.ethers.toUtf8Bytes("Test revert message");
    await omniRewards.onRevert(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: await omniReceiver.getAddress(),
        gasLimit: 100000,
        message: hre.ethers.AbiCoder.defaultAbiCoder().encode(["string"], [revertKey])
      },
      revertMessage
    );

    const revertedPayout = await omniRewards.payouts(revertKey);
    expect(revertedPayout.status).to.equal(2); // REVERTED
    console.log("✓ Revert handling verified");

    console.log("=== COMPLETE PAYOUT WORKFLOW VERIFIED ===\n");
  });

  it("Should verify gas usage and performance", async function () {
    console.log("\n=== INTEGRATION TEST: GAS USAGE ANALYSIS ===");

    const [owner, recipient] = await hre.ethers.getSigners();

    // Deploy contracts
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();

    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    const mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();

    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    const omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();

    // Setup
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("10") });

    // Test gas usage for key operations
    console.log("Gas Usage Analysis:");

    // 1. Fund Pool
    const fundTx = await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("1") });
    const fundReceipt = await fundTx.wait();
    console.log(`  - fundPool: ${fundReceipt.gasUsed.toString()} gas`);

    // 2. Schedule Payout
    const scheduleTx = await omniRewards.connect(owner).schedulePayout(
      recipient.address,
      hre.ethers.parseUnits("100", 18),
      97,
      "BNB",
      "gas-test"
    );
    const scheduleReceipt = await scheduleTx.wait();
    console.log(`  - schedulePayout: ${scheduleReceipt.gasUsed.toString()} gas`);

    // 3. onCall (cross-chain delivery)
    const expectedTokenAmount = await mockOracle.getTokenAmount("BNB", hre.ethers.parseUnits("100", 18));
    const callData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "string"],
      [recipient.address, expectedTokenAmount, "gas-test"]
    );

    const onCallTx = await omniRewards.onCall(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: recipient.address,
        gasLimit: 100000,
        message: callData
      },
      hre.ethers.ZeroAddress
    );
    const onCallReceipt = await onCallTx.wait();
    console.log(`  - onCall: ${onCallReceipt.gasUsed.toString()} gas`);

    console.log("=== GAS USAGE ANALYSIS COMPLETE ===\n");
  });
});
