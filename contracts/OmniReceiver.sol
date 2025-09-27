// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title OmniReceiver
 * @dev Destination chain contract that receives cross-chain payouts from OmniRewards
 * Deployed on destination chains (Ethereum, Polygon, Base, etc.)
 */
contract OmniReceiver is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ==================== STRUCTS ====================

    struct PayoutReceipt {
        uint256 payoutId;           // Original payout ID from OmniRewards
        address recipient;          // Final recipient address
        uint256 amount;             // Amount received in destination token
        address token;              // Token address on destination chain
        uint256 timestamp;          // Receipt timestamp
        address sourceContract;     // Source contract (OmniRewards) address
        uint256 sourceChainId;      // Source chain ID (ZetaChain)
        bytes32 transactionHash;    // Cross-chain transaction hash
    }

    // ==================== STATE VARIABLES ====================

    mapping(uint256 => PayoutReceipt) public receipts;           // payoutId => PayoutReceipt
    mapping(address => uint256[]) public recipientPayouts;       // recipient => payoutIds[]
    mapping(bytes32 => bool) public processedTransactions;      // txHash => processed
    
    uint256 public totalPayoutsReceived;
    uint256 public totalValueReceived;  // Total USD value received (estimated)
    
    address public authorizedSource;    // Authorized source contract (OmniRewards)
    uint256 public sourceChainId;       // Expected source chain ID (ZetaChain)

    // ==================== EVENTS ====================

    event PayoutReceived(
        uint256 indexed payoutId,
        address indexed recipient,
        uint256 amount,
        address indexed token,
        address sourceContract,
        bytes32 transactionHash
    );

    event PayoutForwarded(
        uint256 indexed payoutId,
        address indexed originalRecipient,
        address indexed newRecipient,
        uint256 amount
    );

    event AuthorizedSourceUpdated(address indexed oldSource, address indexed newSource);
    event EmergencyWithdrawal(address indexed token, uint256 amount, address indexed to);

    // ==================== ERRORS ====================

    error UnauthorizedSource(address caller);
    error PayoutAlreadyProcessed(uint256 payoutId);
    error InvalidRecipient(address recipient);
    error InvalidAmount(uint256 amount);
    error InvalidToken(address token);
    error TransactionAlreadyProcessed(bytes32 txHash);
    error PayoutNotFound(uint256 payoutId);
    error InsufficientBalance(uint256 requested, uint256 available);

    // ==================== MODIFIERS ====================

    modifier onlyAuthorizedSource() {
        if (msg.sender != authorizedSource && authorizedSource != address(0)) {
            revert UnauthorizedSource(msg.sender);
        }
        _;
    }

    modifier validRecipient(address recipient) {
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
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
        address _authorizedSource,
        uint256 _sourceChainId
    ) Ownable(msg.sender) {
        authorizedSource = _authorizedSource;
        sourceChainId = _sourceChainId;
    }

    // ==================== MAIN FUNCTIONS ====================

    /**
     * @dev Receive a cross-chain payout (called by ZetaChain messaging)
     */
    function receivePayout(
        uint256 payoutId,
        address recipient,
        uint256 amount,
        address token,
        bytes32 transactionHash
    ) external onlyAuthorizedSource nonReentrant validRecipient(recipient) validAmount(amount) {
        // Check if payout already processed
        if (receipts[payoutId].payoutId != 0) {
            revert PayoutAlreadyProcessed(payoutId);
        }

        // Check if transaction already processed (prevent replay attacks)
        if (processedTransactions[transactionHash]) {
            revert TransactionAlreadyProcessed(transactionHash);
        }

        // Validate token
        if (token == address(0)) {
            // Native token (ETH/MATIC/BNB)
            _receiveNativePayout(payoutId, recipient, amount, transactionHash);
        } else {
            // ERC20 token
            _receiveTokenPayout(payoutId, recipient, amount, token, transactionHash);
        }

        // Record the receipt
        receipts[payoutId] = PayoutReceipt({
            payoutId: payoutId,
            recipient: recipient,
            amount: amount,
            token: token,
            timestamp: block.timestamp,
            sourceContract: msg.sender,
            sourceChainId: sourceChainId,
            transactionHash: transactionHash
        });

        // Track recipient's payouts
        recipientPayouts[recipient].push(payoutId);
        
        // Mark transaction as processed
        processedTransactions[transactionHash] = true;
        
        // Update counters
        totalPayoutsReceived++;
        totalValueReceived += amount; // Simplified - in reality would convert to USD

        emit PayoutReceived(payoutId, recipient, amount, token, msg.sender, transactionHash);
    }

    /**
     * @dev Receive native token payout
     */
    function _receiveNativePayout(
        uint256 payoutId,
        address recipient,
        uint256 amount,
        bytes32 transactionHash
    ) internal {
        // Check contract has sufficient native balance
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        // Transfer native tokens to recipient
        payable(recipient).transfer(amount);
    }

    /**
     * @dev Receive ERC20 token payout
     */
    function _receiveTokenPayout(
        uint256 payoutId,
        address recipient,
        uint256 amount,
        address token,
        bytes32 transactionHash
    ) internal {
        IERC20 tokenContract = IERC20(token);
        
        // Check contract has sufficient token balance
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < amount) {
            revert InsufficientBalance(amount, balance);
        }

        // Transfer tokens to recipient
        tokenContract.safeTransfer(recipient, amount);
    }

    /**
     * @dev Forward a received payout to a different recipient (admin function)
     */
    function forwardPayout(
        uint256 payoutId,
        address newRecipient
    ) external onlyOwner validRecipient(newRecipient) {
        PayoutReceipt storage receipt = receipts[payoutId];
        
        if (receipt.payoutId == 0) {
            revert PayoutNotFound(payoutId);
        }

        address originalRecipient = receipt.recipient;
        uint256 amount = receipt.amount;
        address token = receipt.token;

        // Update recipient in receipt
        receipt.recipient = newRecipient;

        // Transfer the funds
        if (token == address(0)) {
            payable(newRecipient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(newRecipient, amount);
        }

        // Update recipient tracking
        recipientPayouts[newRecipient].push(payoutId);

        emit PayoutForwarded(payoutId, originalRecipient, newRecipient, amount);
    }

    // ==================== ADMIN FUNCTIONS ====================

    /**
     * @dev Update authorized source contract
     */
    function setAuthorizedSource(address _authorizedSource) external onlyOwner {
        address oldSource = authorizedSource;
        authorizedSource = _authorizedSource;
        emit AuthorizedSourceUpdated(oldSource, _authorizedSource);
    }

    /**
     * @dev Emergency withdrawal of stuck funds
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner validRecipient(to) {
        if (token == address(0)) {
            // Withdraw native tokens
            if (amount > address(this).balance) {
                revert InsufficientBalance(amount, address(this).balance);
            }
            payable(to).transfer(amount);
        } else {
            // Withdraw ERC20 tokens
            IERC20 tokenContract = IERC20(token);
            uint256 balance = tokenContract.balanceOf(address(this));
            if (amount > balance) {
                revert InsufficientBalance(amount, balance);
            }
            tokenContract.safeTransfer(to, amount);
        }

        emit EmergencyWithdrawal(token, amount, to);
    }

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @dev Get payout receipt details
     */
    function getReceipt(uint256 payoutId) external view returns (PayoutReceipt memory) {
        return receipts[payoutId];
    }

    /**
     * @dev Get all payouts for a recipient
     */
    function getRecipientPayouts(address recipient) external view returns (uint256[] memory) {
        return recipientPayouts[recipient];
    }

    /**
     * @dev Get contract balances
     */
    function getBalances(address[] calldata tokens) external view returns (uint256[] memory balances) {
        balances = new uint256[](tokens.length + 1);
        
        // Native token balance
        balances[0] = address(this).balance;
        
        // ERC20 token balances
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] != address(0)) {
                balances[i + 1] = IERC20(tokens[i]).balanceOf(address(this));
            }
        }
    }

    /**
     * @dev Check if transaction was processed
     */
    function isTransactionProcessed(bytes32 txHash) external view returns (bool) {
        return processedTransactions[txHash];
    }

    /**
     * @dev Get total statistics
     */
    function getStats() external view returns (
        uint256 totalPayouts,
        uint256 totalValue,
        uint256 nativeBalance
    ) {
        return (totalPayoutsReceived, totalValueReceived, address(this).balance);
    }

    // ==================== FALLBACK FUNCTIONS ====================

    /**
     * @dev Receive native tokens
     */
    receive() external payable {
        // Allow contract to receive native tokens for payouts
    }

    /**
     * @dev Fallback function
     */
    fallback() external payable {
        // Handle unknown function calls
    }
}
