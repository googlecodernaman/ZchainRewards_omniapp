# ZetaChain SDK Documentation Summary

## Overview
ZetaChain enables Universal Apps that can interact natively across multiple blockchains including Bitcoin, Ethereum, Solana, and other connected chains.

## Key Packages
- `@zetachain/protocol-contracts` - Core protocol contracts including GatewayZEVM
- `@zetachain/standard-contracts` - Standard contracts for messaging (if available)

## Universal Contract Pattern

### Basic Universal App Structure
```solidity
import "@zetachain/protocol-contracts/contracts/zevm/GatewayZEVM.sol";

contract Universal is UniversalContract {
    GatewayZEVM public immutable gateway;
    
    event HelloEvent(string, string);
    error Unauthorized();
    
    modifier onlyGateway() {
        if (msg.sender != address(gateway)) revert Unauthorized();
        _;
    }
    
    constructor(address payable gatewayAddress) {
        gateway = GatewayZEVM(gatewayAddress);
    }
    
    function onCall(
        MessageContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external override onlyGateway {
        // Implementation here
    }
}
```

### Core Functions Required

#### onCall Function
```solidity
function onCall(
    MessageContext calldata context,
    address zrc20,
    uint256 amount,
    bytes calldata message
) external override onlyGateway
```

**Parameters:**
- `context`: MessageContext struct containing:
  - `chainID`: Chain ID of the connected chain that initiated the call
  - `sender`: Address (EOA or contract) that called the Gateway on connected chain
  - `origin`: Deprecated field
- `zrc20`: Address of ZRC-20 token representing assets from source chain
- `amount`: Amount of tokens transferred
- `message`: Encoded payload data

#### onRevert Function (for outgoing transactions)
```solidity
function onRevert(RevertContext calldata context) external payable override onlyGateway
```
- Called when a transaction fails during routing before reaching destination chain
- Executes on the source chain
- Used for refund logic, compensation, or notifications

#### onAbort Function (NEW - failsafe mechanism)
```solidity  
function onAbort(AbortContext calldata context) external override onlyGateway
```
- Executes locally when traditional revert cannot be completed
- Prevents stuck assets when insufficient gas for revert
- Provides final failsafe for recovery

### Message Context Structure
```solidity
struct MessageContext {
    uint256 chainID;    // Source chain ID
    address sender;     // Original sender address
    bytes origin;       // Deprecated
}
```

### Revert Context Structure  
```solidity
struct RevertContext {
    address sender;         // Original sender
    address asset;          // Asset address  
    uint256 amount;         // Amount
    uint256 chainID;        // Chain ID
    bytes revertMessage;    // Revert message
    bool outgoing;         // Direction flag
}
```

## Cross-Chain Transaction Flow

### Incoming Transactions (Connected Chain → ZetaChain)
1. User calls `depositAndCall` on connected chain Gateway
2. ZetaChain calls `onCall` on universal contract
3. If `onCall` succeeds → transaction complete
4. If `onCall` fails → attempt revert back to source chain
5. If sufficient gas → call `onRevert` on source chain
6. If insufficient gas → call `onAbort` on ZetaChain

### Outgoing Transactions (ZetaChain → Connected Chain)  
1. Universal contract initiates call to connected chain
2. If destination `onCall` succeeds → transaction complete
3. If destination `onCall` fails → call `onRevert` on ZetaChain
4. If `onRevert` fails → call `onAbort` on ZetaChain

## Key ZetaChain Addresses (Testnet)
- ZetaChain Athens Testnet Gateway: `0x6c533f7fe93fae114d0954697069df33c9b74fd7`
- RPC: `https://zetachain-athens-evm.blockpi.network/v1/rpc/public`

## Important Implementation Notes
1. Always use `onlyGateway` modifier for cross-chain functions
2. Include proper error handling and events for monitoring
3. Implement idempotency checks to prevent duplicate processing
4. Ensure sufficient gas estimation for cross-chain operations
5. Use `RevertOptions` to specify fallback behavior

## Testing & Development
- Use ZetaChain CLI: `npx zetachain@latest new --project <name>`
- Local testing: `npx zetachain localnet start` 
- Query cross-chain transactions: `npx zetachain query cctx --hash <tx_hash>`

## References
- Official docs: https://docs.zetachain.com/
- Universal contract tutorial: https://docs.zetachain.com/developers/tutorials/hello/
- Messaging tutorial: https://docs.zetachain.com/developers/tutorials/messaging/
- Cross-chain revert handling: https://www.zetachain.com/blog/zetachains-new-revert-handling-for-cross-chain
