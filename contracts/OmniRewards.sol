// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IOracle.sol";

/**
 * @title OmniRewards
 * @dev Universal Smart Contract for cross-chain USD-denominated rewards/payouts
 * Implements onCall, onRevert, and onAbort for ZetaChain universal app behavior
 */
contract OmniRewards is Ownable, ReentrancyGuard, Pausable {
    // ==================== STRUCTS ====================

    struct PayoutInstruction {
        uint256 payoutId;           // Unique payout identifier
        address recipientAddr;      // Recipient address on destination chain
        uint256 destChainId;        // Destination chain ID
        address destTokenAddr;      // Token address on destination chain
        uint256 amountUSD;          // Amount in USD (18 decimals)
        uint256 deadline;           // Deadline timestamp
        bytes32 idempotencyKey;     // Idempotency key to prevent duplicates
        address admin;              // Admin who created the payout
        uint256 createdAt;          // Creation timestamp
        PayoutStatus status;        // Current status
    }

    struct MessageContext {
        uint256 chainID;
        address sender;
        bytes origin;
    }

    struct RevertContext {
        address sender;
        address asset;
        uint256 amount;
        uint256 chainID;
        bytes revertMessage;
        bool outgoing;
    }

    struct AbortContext {
        address sender;
        address asset;
        uint256 amount;
        uint256 chainID;
        bytes revertMessage;
        bool outgoing;
    }

    enum PayoutStatus {
        Pending,        // Created but not yet processed
        Processing,     // Being processed cross-chain
        Completed,      // Successfully delivered
        Failed,         // Failed and reverted
        Aborted,        // Aborted due to insufficient gas or other issues
        Expired         // Expired past deadline
    }

    // ==================== STATE VARIABLES ====================

    address public immutable gateway;              // ZetaChain Gateway address
    IOracle public oracle;                         // Price oracle interface
    uint256 public nextPayoutId;                   // Next payout ID counter
    uint256 public totalPoolBalance;               // Total pool balance in native tokens

    // Mappings
    mapping(uint256 => PayoutInstruction) public payouts;           // payoutId => PayoutInstruction
    mapping(bytes32 => bool) public usedIdempotencyKeys;           // idempotencyKey => used
    mapping(address => bool) public authorizedAdmins;              // admin => authorized
    mapping(address => uint256[]) public adminPayouts;             // admin => payoutIds[]

    // Oracle settings
    uint256 public oracleStalenessThreshold = 3600;    // 1 hour
    uint256 public oracleDeviationThreshold = 500;     // 5% in basis points

    // Gas settings for cross-chain operations
    uint256 public constant MIN_GAS_FOR_CROSS_CHAIN = 200000;
    uint256 public gasLimitOnCall = 300000;
    uint256 public gasLimitOnRevert = 200000;

    // ==================== EVENTS ====================

    event PoolFunded(address indexed funder, uint256 amount, uint256 newBalance);
    event PayoutScheduled(
        uint256 indexed payoutId,
        address indexed admin,
        address indexed recipient,
        uint256 destChainId,
        uint256 amountUSD,
        bytes32 idempotencyKey
    );
    event PayoutSent(uint256 indexed payoutId, address indexed recipient, uint256 tokenAmount);
    event PayoutReverted(uint256 indexed payoutId, bytes reason);
    event PayoutAborted(uint256 indexed payoutId, bytes reason);
    event RefundIssued(uint256 indexed payoutId, address indexed recipient, uint256 amount);
    event AdminAuthorized(address indexed admin, bool authorized);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ==================== ERRORS ====================

    error Unauthorized(address caller);
    error InvalidAmount(uint256 amount);
    error InvalidAddress(address addr);
    error InvalidDeadline(uint256 deadline);
    error PayoutNotFound(uint256 payoutId);
    error DuplicateIdempotencyKey(bytes32 key);
    error InsufficientPoolBalance(uint256 required, uint256 available);
    error PayoutExpired(uint256 payoutId, uint256 deadline);
    error PayoutAlreadyProcessed(uint256 payoutId);
    error StaleOracle(uint256 age, uint256 threshold);
    error OracleNotSet();
    error OnlyGateway(address caller);
    error InsufficientGasForCrossChain(uint256 provided, uint256 required);
    error InvalidChainId(uint256 chainId);
    error PayoutAmountTooSmall(uint256 amount, uint256 minimum);

    // ==================== MODIFIERS ====================

    modifier onlyAuthorizedAdmin() {
        if (!authorizedAdmins[msg.sender] && msg.sender != owner()) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    modifier onlyGateway() {
        if (msg.sender != gateway) {
            revert OnlyGateway(msg.sender);
        }
        _;
    }

    modifier validAddress(address addr) {
        if (addr == address(0)) {
            revert InvalidAddress(addr);
        }
        _;
    }

    modifier validAmount(uint256 amount) {
        if (amount == 0) {
            revert InvalidAmount(amount);
        }
        _;
    }

    // ==================== CONSTRUCTOR ====================

    constructor(
        address payable _gateway,
        address _oracle
    ) Ownable(msg.sender) validAddress(_gateway) {
        gateway = _gateway;
        oracle = IOracle(_oracle);
        authorizedAdmins[msg.sender] = true;
        emit AdminAuthorized(msg.sender, true);
    }

    // ==================== FUNDING FUNCTIONS ====================

    /**
     * @dev Fund the reward pool with native tokens
     */
    function fundPool() external payable validAmount(msg.value) {
        totalPoolBalance += msg.value;
        emit PoolFunded(msg.sender, msg.value, totalPoolBalance);
    }

    /**
     * @dev Admin function to withdraw excess funds
     */
    function withdrawFunds(uint256 amount) external onlyOwner validAmount(amount) {
        if (amount > totalPoolBalance) {
            revert InsufficientPoolBalance(amount, totalPoolBalance);
        }
        
        totalPoolBalance -= amount;
        payable(owner()).transfer(amount);
    }

    // ==================== PAYOUT SCHEDULING ====================

    /**
     * @dev Schedule a USD-denominated payout
     */
    function schedulePayout(
        address recipientAddr,
        uint256 destChainId,
        address destTokenAddr,
        uint256 amountUSD,
        uint256 deadline,
        bytes32 idempotencyKey
    ) external onlyAuthorizedAdmin whenNotPaused validAddress(recipientAddr) validAmount(amountUSD) {
        // Validate inputs
        _validatePayoutParameters(destChainId, destTokenAddr, amountUSD, deadline);

        // Check idempotency
        if (usedIdempotencyKeys[idempotencyKey]) {
            revert DuplicateIdempotencyKey(idempotencyKey);
        }

        // Estimate gas costs for the cross-chain operation
        uint256 estimatedGasCost = _estimateGasCost(destChainId, amountUSD);
        
        // Check if pool has sufficient balance for the payout + gas
        if (totalPoolBalance < estimatedGasCost) {
            revert InsufficientPoolBalance(estimatedGasCost, totalPoolBalance);
        }

        uint256 payoutId = nextPayoutId++;
        
        // Create payout instruction
        payouts[payoutId] = PayoutInstruction({
            payoutId: payoutId,
            recipientAddr: recipientAddr,
            destChainId: destChainId,
            destTokenAddr: destTokenAddr,
            amountUSD: amountUSD,
            deadline: deadline,
            idempotencyKey: idempotencyKey,
            admin: msg.sender,
            createdAt: block.timestamp,
            status: PayoutStatus.Pending
        });

        // Mark idempotency key as used
        usedIdempotencyKeys[idempotencyKey] = true;
        
        // Track admin's payouts
        adminPayouts[msg.sender].push(payoutId);

        emit PayoutScheduled(payoutId, msg.sender, recipientAddr, destChainId, amountUSD, idempotencyKey);
    }

    /**
     * @dev Validate payout parameters
     */
    function _validatePayoutParameters(
        uint256 destChainId,
        address destTokenAddr,
        uint256 amountUSD,
        uint256 deadline
    ) internal view {
        // Validate deadline
        if (deadline <= block.timestamp) {
            revert InvalidDeadline(deadline);
        }

        // Validate destination chain (basic check - not same as current chain)
        if (destChainId == block.chainid) {
            revert InvalidChainId(destChainId);
        }

        // Validate destination token address
        if (destTokenAddr == address(0)) {
            revert InvalidAddress(destTokenAddr);
        }

        // Validate minimum payout amount (e.g., at least $1)
        uint256 minimumUSD = 1 ether; // $1 in 18 decimals
        if (amountUSD < minimumUSD) {
            revert PayoutAmountTooSmall(amountUSD, minimumUSD);
        }

        // Validate oracle price is fresh for the destination token
        if (!oracleIsFresh(destTokenAddr)) {
            uint256 age = oracle.getPriceAge(destTokenAddr);
            revert StaleOracle(age, oracleStalenessThreshold);
        }
    }

    /**
     * @dev Estimate gas cost for cross-chain payout
     */
    function _estimateGasCost(uint256 destChainId, uint256 amountUSD) internal view returns (uint256) {
        // This is a simplified estimation - in reality would consider:
        // - Destination chain gas prices
        // - Token transfer costs
        // - Cross-chain messaging fees
        
        uint256 baseGasCost = MIN_GAS_FOR_CROSS_CHAIN;
        
        // Add extra gas for larger amounts (more complex operations)
        if (amountUSD > 1000 ether) { // > $1000
            baseGasCost += 50000;
        }
        
        // Different chains might have different costs
        if (destChainId == 1) { // Ethereum mainnet
            baseGasCost += 100000; // Higher gas costs
        }
        
        // Convert gas to native token cost (simplified - would use actual gas price)
        // For now, assume 1 native token can cover the gas
        return 1 ether; // Placeholder: 1 ETH equivalent
    }

    // ==================== UNIVERSAL APP FUNCTIONS ====================

    /**
     * @dev Called when cross-chain message is received (ZetaChain Universal App)
     */
    function onCall(
        MessageContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external onlyGateway nonReentrant {
        // Decode the message to get payout ID
        uint256 payoutId = abi.decode(message, (uint256));
        
        // Convert calldata to memory for internal function
        MessageContext memory contextMemory = MessageContext({
            chainID: context.chainID,
            sender: context.sender,
            origin: context.origin
        });
        
        // Process the payout
        _processPayout(payoutId, contextMemory, zrc20, amount);
    }

    /**
     * @dev Process a cross-chain payout
     */
    function _processPayout(
        uint256 payoutId,
        MessageContext memory context,
        address zrc20,
        uint256 amount
    ) internal {
        PayoutInstruction storage payout = payouts[payoutId];
        
        // Validate payout exists and is pending
        if (payout.payoutId == 0) {
            revert PayoutNotFound(payoutId);
        }
        
        if (payout.status != PayoutStatus.Pending) {
            revert PayoutAlreadyProcessed(payoutId);
        }
        
        // Check if payout has expired
        if (block.timestamp > payout.deadline) {
            payout.status = PayoutStatus.Expired;
            emit PayoutReverted(payoutId, "Payout expired");
            return;
        }
        
        // Mark as processing
        payout.status = PayoutStatus.Processing;
        
        // Calculate token amount from USD amount using oracle
        uint256 tokenAmount;
        try this.getTokenAmountForUSD(payout.destTokenAddr, payout.amountUSD) returns (uint256 _tokenAmount) {
            tokenAmount = _tokenAmount;
        } catch (bytes memory reason) {
            payout.status = PayoutStatus.Failed;
            emit PayoutReverted(payoutId, reason);
            return;
        }
        
        // Reserve pool balance for this payout
        uint256 gasEstimate = _estimateGasCost(payout.destChainId, payout.amountUSD);
        if (totalPoolBalance < gasEstimate) {
            payout.status = PayoutStatus.Failed;
            emit PayoutReverted(payoutId, "Insufficient pool balance");
            return;
        }
        
        // Deduct estimated gas cost from pool
        totalPoolBalance -= gasEstimate;
        
        // In a real implementation, this would initiate the cross-chain transfer
        // For now, we'll simulate successful delivery
        payout.status = PayoutStatus.Completed;
        
        emit PayoutSent(payoutId, payout.recipientAddr, tokenAmount);
    }

    /**
     * @dev Manually trigger payout processing (for testing and admin use)
     */
    function processPayout(uint256 payoutId) external onlyAuthorizedAdmin whenNotPaused {
        PayoutInstruction storage payout = payouts[payoutId];
        
        if (payout.payoutId == 0) {
            revert PayoutNotFound(payoutId);
        }
        
        if (payout.status != PayoutStatus.Pending) {
            revert PayoutAlreadyProcessed(payoutId);
        }
        
        // Create a mock context for manual processing
        MessageContext memory context = MessageContext({
            chainID: block.chainid,
            sender: msg.sender,
            origin: ""
        });
        
        // Process the payout
        _processPayout(payoutId, context, address(0), 0);
    }

    /**
     * @dev Called when cross-chain transaction reverts
     */
    function onRevert(RevertContext calldata context) external onlyGateway nonReentrant {
        // Try to decode payout ID from revert message
        uint256 payoutId;
        try this.decodePayoutId(context.revertMessage) returns (uint256 _payoutId) {
            payoutId = _payoutId;
        } catch {
            // If we can't decode, emit generic revert event
            emit PayoutReverted(0, "Unknown payout reverted");
            return;
        }
        
        _handlePayoutRevert(payoutId, context);
    }

    /**
     * @dev Called when revert fails - final failsafe
     */
    function onAbort(AbortContext calldata context) external onlyGateway nonReentrant {
        // Try to decode payout ID from abort message
        uint256 payoutId;
        try this.decodePayoutId(context.revertMessage) returns (uint256 _payoutId) {
            payoutId = _payoutId;
        } catch {
            // If we can't decode, emit generic abort event
            emit PayoutAborted(0, "Unknown payout aborted");
            return;
        }
        
        _handlePayoutAbort(payoutId, context);
    }

    /**
     * @dev Handle payout revert
     */
    function _handlePayoutRevert(uint256 payoutId, RevertContext calldata context) internal {
        PayoutInstruction storage payout = payouts[payoutId];
        
        if (payout.payoutId == 0) {
            emit PayoutReverted(payoutId, "Payout not found");
            return;
        }
        
        // Mark payout as failed
        payout.status = PayoutStatus.Failed;
        
        // Refund the gas cost back to pool if possible
        uint256 gasRefund = _estimateGasCost(payout.destChainId, payout.amountUSD);
        totalPoolBalance += gasRefund;
        
        // Issue refund to admin or recipient based on context
        if (context.amount > 0) {
            emit RefundIssued(payoutId, payout.recipientAddr, context.amount);
        }
        
        emit PayoutReverted(payoutId, "Cross-chain transaction reverted");
    }

    /**
     * @dev Handle payout abort (final failsafe)
     */
    function _handlePayoutAbort(uint256 payoutId, AbortContext calldata context) internal {
        PayoutInstruction storage payout = payouts[payoutId];
        
        if (payout.payoutId == 0) {
            emit PayoutAborted(payoutId, "Payout not found");
            return;
        }
        
        // Mark payout as aborted
        payout.status = PayoutStatus.Aborted;
        
        // Refund the gas cost back to pool
        uint256 gasRefund = _estimateGasCost(payout.destChainId, payout.amountUSD);
        totalPoolBalance += gasRefund;
        
        // In abort scenarios, assets might be stuck on ZetaChain
        // The abort handler ensures they're not lost
        if (context.amount > 0) {
            // Return assets to pool or admin as last resort
            totalPoolBalance += context.amount;
            emit RefundIssued(payoutId, owner(), context.amount);
        }
        
        emit PayoutAborted(payoutId, "Cross-chain transaction aborted - assets recovered");
    }

    /**
     * @dev Decode payout ID from message (external function for try/catch)
     */
    function decodePayoutId(bytes calldata message) external pure returns (uint256) {
        return abi.decode(message, (uint256));
    }

    // ==================== ORACLE FUNCTIONS ====================

    /**
     * @dev Get USD amount converted to token amount using oracle
     */
    function getTokenAmountForUSD(address token, uint256 usdAmount) 
        public view returns (uint256 tokenAmount) {
        if (address(oracle) == address(0)) {
            revert OracleNotSet();
        }

        // Check if price is fresh before conversion
        if (oracle.isStale(token)) {
            uint256 age = oracle.getPriceAge(token);
            revert StaleOracle(age, oracleStalenessThreshold);
        }

        // Get token amount from oracle
        tokenAmount = oracle.getTokenAmount(token, usdAmount);
    }

    /**
     * @dev Get token amount in USD using oracle
     */
    function getUSDAmountForToken(address token, uint256 tokenAmount) 
        public view returns (uint256 usdAmount) {
        if (address(oracle) == address(0)) {
            revert OracleNotSet();
        }

        // Check if price is fresh before conversion
        if (oracle.isStale(token)) {
            uint256 age = oracle.getPriceAge(token);
            revert StaleOracle(age, oracleStalenessThreshold);
        }

        // Get USD value from oracle
        usdAmount = oracle.getUSDValue(token, tokenAmount);
    }

    /**
     * @dev Check if oracle price is fresh for a token
     */
    function oracleIsFresh(address token) public view returns (bool) {
        if (address(oracle) == address(0)) {
            revert OracleNotSet();
        }

        return !oracle.isStale(token);
    }

    /**
     * @dev Get oracle price and timestamp for a token
     */
    function getOraclePrice(address token) external view returns (uint256 price, uint256 timestamp) {
        if (address(oracle) == address(0)) {
            revert OracleNotSet();
        }

        return oracle.getPrice(token);
    }

    // ==================== ADMIN FUNCTIONS ====================

    /**
     * @dev Authorize/deauthorize admin
     */
    function setAdminAuthorization(address admin, bool authorized) 
        external onlyOwner validAddress(admin) {
        authorizedAdmins[admin] = authorized;
        emit AdminAuthorized(admin, authorized);
    }

    /**
     * @dev Update oracle address
     */
    function setOracle(address _oracle) external onlyOwner validAddress(_oracle) {
        address oldOracle = address(oracle);
        oracle = IOracle(_oracle);
        emit OracleUpdated(oldOracle, _oracle);
    }

    /**
     * @dev Set oracle staleness threshold
     */
    function setOracleStalenessThreshold(uint256 threshold) external onlyOwner {
        oracleStalenessThreshold = threshold;
    }

    /**
     * @dev Set gas limits for cross-chain operations
     */
    function setGasLimits(uint256 _gasLimitOnCall, uint256 _gasLimitOnRevert) external onlyOwner {
        gasLimitOnCall = _gasLimitOnCall;
        gasLimitOnRevert = _gasLimitOnRevert;
    }

    /**
     * @dev Cancel a pending payout (only by admin who created it)
     */
    function cancelPayout(uint256 payoutId) external onlyAuthorizedAdmin {
        PayoutInstruction storage payout = payouts[payoutId];
        
        if (payout.payoutId == 0) {
            revert PayoutNotFound(payoutId);
        }
        
        if (payout.admin != msg.sender && msg.sender != owner()) {
            revert Unauthorized(msg.sender);
        }
        
        if (payout.status != PayoutStatus.Pending) {
            revert PayoutAlreadyProcessed(payoutId);
        }
        
        payout.status = PayoutStatus.Failed;
        emit PayoutReverted(payoutId, "Cancelled by admin");
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @dev Get payout details
     */
    function getPayout(uint256 payoutId) external view returns (PayoutInstruction memory) {
        return payouts[payoutId];
    }

    /**
     * @dev Get admin's payouts
     */
    function getAdminPayouts(address admin) external view returns (uint256[] memory) {
        return adminPayouts[admin];
    }

    /**
     * @dev Get pool balance
     */
    function getPoolBalance() external view returns (uint256) {
        return totalPoolBalance;
    }

    /**
     * @dev Check if idempotency key is used
     */
    function isIdempotencyKeyUsed(bytes32 key) external view returns (bool) {
        return usedIdempotencyKeys[key];
    }

    // ==================== FALLBACK ====================

    /**
     * @dev Receive function for direct ETH transfers (treated as pool funding)
     */
    receive() external payable {
        if (msg.value > 0) {
            totalPoolBalance += msg.value;
            emit PoolFunded(msg.sender, msg.value, totalPoolBalance);
        }
    }
}
