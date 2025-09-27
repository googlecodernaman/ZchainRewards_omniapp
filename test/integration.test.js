const hre = require("hardhat");
const { expect } = require("chai");

describe("OmniRewards Integration", function () {
  it("Should deploy and verify all contracts", async function () {
    console.log("\n=== PHASE 3: INTEGRATION TEST STARTING ===");
    
    const [owner, recipient] = await hre.ethers.getSigners();
    console.log(`✓ Test accounts ready. Owner: ${owner.address}`);

    // Deploy MockOracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    console.log(`✓ MockOracle deployed: ${await mockOracle.getAddress()}`);

    // Deploy MockZetaEndpoint
    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    const mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();
    console.log(`✓ MockZetaEndpoint deployed: ${await mockZetaEndpoint.getAddress()}`);

    // Deploy OmniRewards
    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    const omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();
    console.log(`✓ OmniRewards deployed: ${await omniRewards.getAddress()}`);

    // Deploy OmniReceiver
    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    const omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();
    console.log(`✓ OmniReceiver deployed: ${await omniReceiver.getAddress()}`);

    // Configure Oracle
    await mockOracle.setPrice("ETH", hre.ethers.parseUnits("2000", 18));
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    console.log("✓ Oracle configured with ETH=$2000, BNB=$300");

    // Fund Pool
    const fundAmount = hre.ethers.parseEther("10");
    await omniRewards.connect(owner).fundPool({ value: fundAmount });
    const poolBalance = await omniRewards.poolBalance();
    expect(poolBalance).to.equal(fundAmount);
    console.log(`✓ Pool funded: ${hre.ethers.formatEther(poolBalance)} ETH`);

    // Test Oracle Calculations
    const usdAmount = hre.ethers.parseUnits("300", 18); // $300
    const bnbAmount = await mockOracle.getTokenAmount("BNB", usdAmount);
    expect(bnbAmount).to.equal(hre.ethers.parseUnits("1", 18)); // $300 / $300 = 1 BNB
    console.log(`✓ Oracle calculation: $300 USD = ${hre.ethers.formatEther(bnbAmount)} BNB`);

    // Schedule Payout
    const payoutAmount = hre.ethers.parseUnits("150", 18); // $150
    const idempotencyKey = "integration-test-001";
    
    const tx = await omniRewards.connect(owner).schedulePayout(
      recipient.address,
      payoutAmount,
      97, // BSC Chain ID
      "BNB",
      idempotencyKey
    );
    await tx.wait();
    console.log("✓ Payout scheduled successfully");

    // Verify Payout Storage
    const payout = await omniRewards.payouts(idempotencyKey);
    expect(payout.recipient).to.equal(recipient.address);
    expect(payout.usdAmount).to.equal(payoutAmount);
    expect(payout.status).to.equal(0); // SCHEDULED
    console.log("✓ Payout data verified in storage");

    // Simulate Cross-chain Success
    const expectedTokenAmount = await mockOracle.getTokenAmount("BNB", payoutAmount);
    const callData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "string"],
      [recipient.address, expectedTokenAmount, idempotencyKey]
    );

    await omniRewards.onCall(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: await omniReceiver.getAddress(),
        gasLimit: 100000,
        message: callData
      },
      hre.ethers.ZeroAddress
    );

    // Verify Status Update
    const updatedPayout = await omniRewards.payouts(idempotencyKey);
    expect(updatedPayout.status).to.equal(1); // SENT
    console.log("✓ Cross-chain delivery simulation successful");
    console.log(`✓ Expected payout: ${hre.ethers.formatEther(expectedTokenAmount)} BNB to ${recipient.address}`);

    // Test Revert Scenario
    const revertKey = "revert-test";
    await omniRewards.connect(owner).schedulePayout(
      recipient.address,
      hre.ethers.parseUnits("50", 18),
      97,
      "BNB",
      revertKey
    );

    await omniRewards.onRevert(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: await omniReceiver.getAddress(),
        gasLimit: 100000,
        message: hre.ethers.AbiCoder.defaultAbiCoder().encode(["string"], [revertKey])
      },
      hre.ethers.toUtf8Bytes("Simulated failure")
    );

    const revertedPayout = await omniRewards.payouts(revertKey);
    expect(revertedPayout.status).to.equal(2); // REVERTED
    console.log("✓ Revert handling verified");

    console.log("\n=== INTEGRATION TEST SUMMARY ===");
    console.log("✅ Contract Deployment: SUCCESS");
    console.log("✅ Oracle Integration: SUCCESS");
    console.log("✅ Pool Management: SUCCESS");
    console.log("✅ Payout Scheduling: SUCCESS");
    console.log("✅ Cross-chain Messaging: SUCCESS");
    console.log("✅ Error Handling: SUCCESS");
    console.log("=== PHASE 3 COMPLETE: ALL TESTS PASSED ===\n");
  });
});
