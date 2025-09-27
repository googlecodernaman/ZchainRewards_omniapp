// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../interfaces/IOracle.sol";

/**
 * @title MockOracle
 * @dev Mock oracle contract for testing USD price feeds
 * Simulates oracle behavior with configurable responses and staleness
 */
contract MockOracle is IOracle {
    struct PriceData {
        uint256 price;          // Price in 8 decimals (like Chainlink)
        uint256 timestamp;      // Last update timestamp
        bool isActive;          // Whether price feed is active
    }

    mapping(address => PriceData) public priceFeeds;
    uint256 public constant DECIMALS = 8;
    uint256 public stalenessThreshold = 3600; // 1 hour default
    uint256 public deviationThreshold = 500;  // 5% in basis points

    event PriceUpdated(address indexed token, uint256 price, uint256 timestamp);
    event StalenessThresholdUpdated(uint256 newThreshold);

    error StalePriceFeed(address token, uint256 lastUpdate, uint256 threshold);
    error InactivePriceFeed(address token);
    error InvalidPrice(uint256 price);

    /**
     * @dev Set price for a token (for testing)
     */
    function setPrice(address token, uint256 price) external {
        if (price == 0) revert InvalidPrice(price);
        
        priceFeeds[token] = PriceData({
            price: price,
            timestamp: block.timestamp,
            isActive: true
        });

        emit PriceUpdated(token, price, block.timestamp);
    }

    /**
     * @dev Set price with custom timestamp (for staleness testing)
     */
    function setPriceWithTimestamp(address token, uint256 price, uint256 timestamp) external {
        if (price == 0) revert InvalidPrice(price);
        
        priceFeeds[token] = PriceData({
            price: price,
            timestamp: timestamp,
            isActive: true
        });

        emit PriceUpdated(token, price, timestamp);
    }

    /**
     * @dev Deactivate a price feed
     */
    function deactivateFeed(address token) external {
        priceFeeds[token].isActive = false;
    }

    /**
     * @dev Get latest price for token
     */
    function getPrice(address token) external view returns (uint256 price, uint256 timestamp) {
        PriceData memory data = priceFeeds[token];
        
        if (!data.isActive) {
            revert InactivePriceFeed(token);
        }

        if (block.timestamp - data.timestamp > stalenessThreshold) {
            revert StalePriceFeed(token, data.timestamp, stalenessThreshold);
        }

        return (data.price, data.timestamp);
    }

    /**
     * @dev Get price without staleness check (for testing)
     */
    function getPriceUnchecked(address token) external view returns (uint256 price, uint256 timestamp) {
        PriceData memory data = priceFeeds[token];
        
        if (!data.isActive) {
            revert InactivePriceFeed(token);
        }

        return (data.price, data.timestamp);
    }

    /**
     * @dev Calculate USD value for token amount
     */
    function getUSDValue(address token, uint256 amount) external view returns (uint256) {
        (uint256 price,) = this.getPrice(token);
        
        // Assuming token has 18 decimals and price has 8 decimals
        // USD Value = (amount * price) / (10^8)
        return (amount * price) / (10 ** DECIMALS);
    }

    /**
     * @dev Calculate token amount for USD value
     */
    function getTokenAmount(address token, uint256 usdAmount) external view returns (uint256) {
        (uint256 price,) = this.getPrice(token);
        
        // Token Amount = (usdAmount * 10^8) / price
        // Assumes 18 decimal token, so multiply by 10^18 to get proper token units
        return (usdAmount * (10 ** (18 + DECIMALS))) / price;
    }

    /**
     * @dev Set staleness threshold for testing
     */
    function setStalenessThreshold(uint256 newThreshold) external {
        stalenessThreshold = newThreshold;
        emit StalenessThresholdUpdated(newThreshold);
    }

    /**
     * @dev Check if price is stale
     */
    function isStale(address token) external view returns (bool) {
        PriceData memory data = priceFeeds[token];
        return (block.timestamp - data.timestamp) > stalenessThreshold;
    }

    /**
     * @dev Get price age in seconds
     */
    function getPriceAge(address token) external view returns (uint256) {
        PriceData memory data = priceFeeds[token];
        return block.timestamp - data.timestamp;
    }
}
