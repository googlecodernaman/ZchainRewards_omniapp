import { expect } from "chai";
import hre from "hardhat";

describe("OmniRewards Integration Tests", function () {
  let omniRewards: any;

  it("Should compile and deploy successfully", async function () {
    console.log("\n=== INTEGRATION TEST: CONTRACT DEPLOYMENT ===");

    const [owner] = await hre.ethers.getSigners();

    // Deploy MockOracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    console.log(`✓ MockOracle deployed successfully`);

    // Deploy MockZetaEndpoint
    const MockZetaEndpoint = await hre.ethers.getContractFactory("MockZetaEndpoint");
    const mockZetaEndpoint = await MockZetaEndpoint.deploy();
    await mockZetaEndpoint.waitForDeployment();
    console.log(`✓ MockZetaEndpoint deployed successfully`);

    // Deploy OmniRewards
    const OmniRewards = await hre.ethers.getContractFactory("OmniRewards");
    omniRewards = await OmniRewards.deploy(
      await mockZetaEndpoint.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();
    console.log(`✓ OmniRewards deployed successfully`);

    // Deploy OmniReceiver
    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    const omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();
    console.log(`✓ OmniReceiver deployed successfully`);

    // Verify contracts have valid addresses
    expect(await omniRewards.getAddress()).to.be.properAddress;
    expect(await omniReceiver.getAddress()).to.be.properAddress;
    expect(await mockOracle.getAddress()).to.be.properAddress;
    expect(await mockZetaEndpoint.getAddress()).to.be.properAddress;

    // Verify owner is set correctly
    const contractOwner = await omniRewards.owner();
    expect(contractOwner).to.equal(await owner.getAddress());

    console.log("=== ALL CONTRACTS DEPLOYED SUCCESSFULLY ===\n");
  });

  it("Should verify core functionality", async function () {
    console.log("\n=== INTEGRATION TEST: CORE FUNCTIONALITY ===");

    const [owner, user1, recipient] = await hre.ethers.getSigners();

    // Deploy all contracts again for this test
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

    // Set up oracle prices
    await mockOracle.setPrice("ETH", hre.ethers.parseUnits("2000", 18));
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    console.log("✓ Oracle prices configured");

    // Fund the pool
    const fundAmount = hre.ethers.parseEther("5");
    await omniRewards.connect(owner).fundPool({ value: fundAmount });
    
    const poolBalance = await omniRewards.poolBalance();
    expect(poolBalance).to.equal(fundAmount);
    console.log(`✓ Pool funded with ${hre.ethers.formatEther(fundAmount)} ETH`);

    // Test oracle calculations
    const usdAmount = hre.ethers.parseUnits("600", 18); // $600 USD
    const ethAmount = await mockOracle.getTokenAmount("ETH", usdAmount);
    const bnbAmount = await mockOracle.getTokenAmount("BNB", usdAmount);
    
    expect(ethAmount).to.equal(hre.ethers.parseUnits("0.3", 18)); // $600 / $2000 = 0.3 ETH
    expect(bnbAmount).to.equal(hre.ethers.parseUnits("2", 18));   // $600 / $300 = 2 BNB
    console.log(`✓ Oracle calculations correct: $600 = 0.3 ETH = 2 BNB`);

    // Test payout scheduling
    const payoutAmount = hre.ethers.parseUnits("100", 18); // $100 USD
    const recipientAddress = await recipient.getAddress();
    const idempotencyKey = "integration-test-001";

    const tx = await omniRewards.connect(owner).schedulePayout(
      recipientAddress,
      payoutAmount,
      97, // BSC Chain ID
      "BNB",
      idempotencyKey
    );
    await tx.wait();

    // Verify payout was stored
    const payout = await omniRewards.payouts(idempotencyKey);
    expect(payout.recipient).to.equal(recipientAddress);
    expect(payout.usdAmount).to.equal(payoutAmount);
    expect(payout.destinationChainId).to.equal(97);
    expect(payout.tokenSymbol).to.equal("BNB");
    expect(payout.status).to.equal(0); // SCHEDULED
    console.log("✓ Payout scheduling working correctly");

    // Test access control
    try {
      await omniRewards.connect(user1).schedulePayout(
        recipientAddress,
        payoutAmount,
        97,
        "BNB",
        "unauthorized-test"
      );
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("OwnableUnauthorizedAccount");
      console.log("✓ Access control working correctly");
    }

    console.log("=== CORE FUNCTIONALITY VERIFIED ===\n");
  });

  it("Should handle cross-chain messaging", async function () {
    console.log("\n=== INTEGRATION TEST: CROSS-CHAIN MESSAGING ===");

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

    const OmniReceiver = await hre.ethers.getContractFactory("OmniReceiver");
    const omniReceiver = await OmniReceiver.deploy(await omniRewards.getAddress());
    await omniReceiver.waitForDeployment();

    // Setup
    await mockOracle.setPrice("BNB", hre.ethers.parseUnits("300", 18));
    await omniRewards.connect(owner).fundPool({ value: hre.ethers.parseEther("10") });

    // Schedule payout
    const idempotencyKey = "messaging-test";
    const recipientAddress = await recipient.getAddress();
    
    await omniRewards.connect(owner).schedulePayout(
      recipientAddress,
      hre.ethers.parseUnits("100", 18), // $100
      97, // BSC
      "BNB",
      idempotencyKey
    );
    console.log("✓ Payout scheduled for cross-chain delivery");

    // Simulate successful onCall
    const expectedTokenAmount = await mockOracle.getTokenAmount(
      "BNB", 
      hre.ethers.parseUnits("100", 18)
    );
    
    const callData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "string"],
      [recipientAddress, expectedTokenAmount, idempotencyKey]
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

    // Verify payout status updated
    const payout = await omniRewards.payouts(idempotencyKey);
    expect(payout.status).to.equal(1); // SENT
    console.log("✓ Cross-chain delivery simulation successful");

    // Test onRevert
    const revertKey = "revert-test";
    await omniRewards.connect(owner).schedulePayout(
      recipientAddress,
      hre.ethers.parseUnits("50", 18),
      97,
      "BNB",
      revertKey
    );

    const revertMessage = hre.ethers.toUtf8Bytes("Delivery failed");
    await omniRewards.onRevert(
      {
        sender: hre.ethers.ZeroAddress,
        sourceChainId: 7000,
        destinationAddress: await omniReceiver.getAddress(),
        gasLimit: 100000,
        message: hre.ethers.AbiCoder.defaultAbiCoder().encode(
          ["string"],
          [revertKey]
        )
      },
      revertMessage
    );

    const revertedPayout = await omniRewards.payouts(revertKey);
    expect(revertedPayout.status).to.equal(2); // REVERTED
    console.log("✓ Cross-chain revert handling working correctly");

    console.log("=== CROSS-CHAIN MESSAGING VERIFIED ===\n");
  });
});
