// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title IOracle
 * @dev Interface for price oracle contracts
 */
interface IOracle {
    /**
     * @dev Get latest price for token
     * @param token Token address
     * @return price Price in 8 decimals
     * @return timestamp Last update timestamp
     */
    function getPrice(address token) external view returns (uint256 price, uint256 timestamp);

    /**
     * @dev Calculate USD value for token amount
     * @param token Token address
     * @param amount Token amount (in token's native decimals)
     * @return USD value in 18 decimals
     */
    function getUSDValue(address token, uint256 amount) external view returns (uint256);

    /**
     * @dev Calculate token amount for USD value
     * @param token Token address  
     * @param usdAmount USD amount in 18 decimals
     * @return Token amount in token's native decimals
     */
    function getTokenAmount(address token, uint256 usdAmount) external view returns (uint256);

    /**
     * @dev Check if price is stale
     * @param token Token address
     * @return true if price is stale
     */
    function isStale(address token) external view returns (bool);

    /**
     * @dev Get price age in seconds
     * @param token Token address
     * @return Age in seconds since last update
     */
    function getPriceAge(address token) external view returns (uint256);
}
