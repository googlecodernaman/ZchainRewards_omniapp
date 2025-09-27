const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OmniRewards Contract Skeleton", function () {
  let omniRewards;
  let mockOracle;
  let mockGateway;
  let owner;
  let admin;
  let recipient;

  beforeEach(async function () {
    [owner, admin, recipient] = await ethers.getSigners();

    // Deploy mock contracts first
    const MockOracle = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();

    const MockZetaEndpoint = await ethers.getContractFactory("MockZetaEndpoint");
    mockGateway = await MockZetaEndpoint.deploy();
    await mockGateway.waitForDeployment();

    // Deploy OmniRewards contract
    const OmniRewards = await ethers.getContractFactory("OmniRewards");
    omniRewards = await OmniRewards.deploy(
      await mockGateway.getAddress(),
      await mockOracle.getAddress()
    );
    await omniRewards.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully with correct initial state", async function () {
      expect(await omniRewards.getAddress()).to.be.properAddress;
      expect(await omniRewards.gateway()).to.equal(await mockGateway.getAddress());
      expect(await omniRewards.oracle()).to.equal(await mockOracle.getAddress());
      expect(await omniRewards.nextPayoutId()).to.equal(0);
      expect(await omniRewards.totalPoolBalance()).to.equal(0);
    });

    it("Should set owner as authorized admin", async function () {
      expect(await omniRewards.authorizedAdmins(owner.address)).to.be.true;
    });
  });

  describe("Pool Funding", function () {
    it("Should accept ETH funding", async function () {
      const fundAmount = ethers.parseEther("1.0");
      
      await expect(omniRewards.fundPool({ value: fundAmount }))
        .to.emit(omniRewards, "PoolFunded")
        .withArgs(owner.address, fundAmount, fundAmount);

      expect(await omniRewards.getPoolBalance()).to.equal(fundAmount);
    });

    it("Should accept ETH via receive function", async function () {
      const fundAmount = ethers.parseEther("0.5");
      
      await expect(owner.sendTransaction({
        to: await omniRewards.getAddress(),
        value: fundAmount
      }))
        .to.emit(omniRewards, "PoolFunded")
        .withArgs(owner.address, fundAmount, fundAmount);

      expect(await omniRewards.getPoolBalance()).to.equal(fundAmount);
    });
  });

  describe("Admin Management", function () {
    it("Should allow owner to authorize admin", async function () {
      await expect(omniRewards.setAdminAuthorization(admin.address, true))
        .to.emit(omniRewards, "AdminAuthorized")
        .withArgs(admin.address, true);

      expect(await omniRewards.authorizedAdmins(admin.address)).to.be.true;
    });

    it("Should allow owner to deauthorize admin", async function () {
      // First authorize
      await omniRewards.setAdminAuthorization(admin.address, true);
      
      // Then deauthorize
      await expect(omniRewards.setAdminAuthorization(admin.address, false))
        .to.emit(omniRewards, "AdminAuthorized")
        .withArgs(admin.address, false);

      expect(await omniRewards.authorizedAdmins(admin.address)).to.be.false;
    });
  });

  describe("Payout Scheduling", function () {
    beforeEach(async function () {
      // Fund the pool
      await omniRewards.fundPool({ value: ethers.parseEther("10") });
    });

    it("Should allow authorized admin to schedule payout", async function () {
      const payoutParams = {
        recipientAddr: recipient.address,
        destChainId: 1,
        destTokenAddr: "0x1234567890123456789012345678901234567890",
        amountUSD: ethers.parseEther("100"), // $100
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        idempotencyKey: ethers.keccak256(ethers.toUtf8Bytes("test-key-1"))
      };

      await expect(omniRewards.schedulePayout(
        payoutParams.recipientAddr,
        payoutParams.destChainId,
        payoutParams.destTokenAddr,
        payoutParams.amountUSD,
        payoutParams.deadline,
        payoutParams.idempotencyKey
      ))
        .to.emit(omniRewards, "PayoutScheduled")
        .withArgs(0, owner.address, payoutParams.recipientAddr, payoutParams.destChainId, payoutParams.amountUSD, payoutParams.idempotencyKey);

      // Check payout was created
      const payout = await omniRewards.getPayout(0);
      expect(payout.payoutId).to.equal(0);
      expect(payout.recipientAddr).to.equal(payoutParams.recipientAddr);
      expect(payout.amountUSD).to.equal(payoutParams.amountUSD);
    });

    it("Should reject duplicate idempotency key", async function () {
      const idempotencyKey = ethers.keccak256(ethers.toUtf8Bytes("duplicate-key"));
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // First payout
      await omniRewards.schedulePayout(
        recipient.address,
        1,
        "0x1234567890123456789012345678901234567890",
        ethers.parseEther("100"),
        deadline,
        idempotencyKey
      );

      // Second payout with same key should fail
      await expect(omniRewards.schedulePayout(
        recipient.address,
        1,
        "0x1234567890123456789012345678901234567890",
        ethers.parseEther("50"),
        deadline,
        idempotencyKey
      )).to.be.revertedWithCustomError(omniRewards, "DuplicateIdempotencyKey");
    });
  });
});
