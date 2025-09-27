// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title MockReceiver
 * @dev Mock receiver contract for testing cross-chain payouts on destination chains
 * Simulates a simple receiver that logs payout receipts
 */
contract MockReceiver {
    struct PayoutRecord {
        uint256 payoutId;
        address recipient;
        uint256 amount;
        address token;
        uint256 timestamp;
        address sender;
    }

    mapping(uint256 => PayoutRecord) public payouts;
    mapping(address => uint256[]) public recipientPayouts;
    uint256 public payoutCount;

    event PayoutReceived(
        uint256 indexed payoutId,
        address indexed recipient,
        uint256 amount,
        address token,
        address sender
    );

    event TestEvent(string message, uint256 value);

    error InvalidAmount(uint256 amount);
    error InvalidRecipient(address recipient);

    /**
     * @dev Receive a payout (called by cross-chain message)
     */
    function receivePayout(
        uint256 payoutId,
        address recipient,
        uint256 amount,
        address token
    ) external {
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (amount == 0) revert InvalidAmount(amount);

        payouts[payoutId] = PayoutRecord({
            payoutId: payoutId,
            recipient: recipient,
            amount: amount,
            token: token,
            timestamp: block.timestamp,
            sender: msg.sender
        });

        recipientPayouts[recipient].push(payoutId);
        payoutCount++;

        emit PayoutReceived(payoutId, recipient, amount, token, msg.sender);
    }

    /**
     * @dev Simple function to test basic cross-chain calls
     */
    function testFunction(string calldata message, uint256 value) external {
        emit TestEvent(message, value);
    }

    /**
     * @dev Get payout details
     */
    function getPayout(uint256 payoutId) external view returns (PayoutRecord memory) {
        return payouts[payoutId];
    }

    /**
     * @dev Get all payouts for a recipient
     */
    function getRecipientPayouts(address recipient) external view returns (uint256[] memory) {
        return recipientPayouts[recipient];
    }

    /**
     * @dev Get total number of payouts received
     */
    function getTotalPayouts() external view returns (uint256) {
        return payoutCount;
    }

    /**
     * @dev Allow contract to receive ETH
     */
    receive() external payable {
        // Contract can receive ETH payments
    }

    /**
     * @dev Fallback function for testing
     */
    fallback() external payable {
        // Handle unknown function calls
    }
}
