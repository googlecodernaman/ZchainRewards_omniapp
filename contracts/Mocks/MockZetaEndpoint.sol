// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title MockZetaEndpoint
 * @dev Mock ZetaChain Gateway contract for testing cross-chain messaging
 * Simulates Gateway behavior with configurable delays and failure modes
 */
contract MockZetaEndpoint {
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

    // State variables for testing
    mapping(uint256 => bool) public shouldFailCall;
    mapping(uint256 => bool) public shouldFailRevert;
    mapping(uint256 => uint256) public callDelays;
    uint256 public nextCallId;
    
    // Track calls for verification
    struct CallRecord {
        address target;
        address zrc20;
        uint256 amount;
        bytes message;
        uint256 timestamp;
        bool executed;
        bool failed;
    }
    
    mapping(uint256 => CallRecord) public calls;
    
    event CrossChainCall(
        uint256 indexed callId,
        address indexed target,
        address zrc20,
        uint256 amount,
        bytes message
    );
    
    event CallExecuted(uint256 indexed callId, bool success);
    event CallReverted(uint256 indexed callId, bytes reason);
    event CallAborted(uint256 indexed callId, bytes reason);

    error CallFailed(uint256 callId, bytes reason);
    error RevertFailed(uint256 callId, bytes reason);

    /**
     * @dev Simulate cross-chain call to universal contract
     */
    function crossChainCall(
        address target,
        address zrc20,
        uint256 amount,
        bytes calldata message,
        MessageContext calldata context
    ) external returns (uint256 callId) {
        callId = nextCallId++;
        
        calls[callId] = CallRecord({
            target: target,
            zrc20: zrc20,
            amount: amount,
            message: message,
            timestamp: block.timestamp,
            executed: false,
            failed: false
        });

        emit CrossChainCall(callId, target, zrc20, amount, message);

        // Check if this call should fail
        if (shouldFailCall[callId]) {
            calls[callId].failed = true;
            emit CallReverted(callId, "Mock call failure");
            
            // Try to revert
            if (shouldFailRevert[callId]) {
                emit CallAborted(callId, "Mock revert failure");
                _executeAbort(target, context, zrc20, amount, message);
            } else {
                _executeRevert(target, context, zrc20, amount, message);
            }
            return callId;
        }

        // Simulate delay if configured
        if (callDelays[callId] > 0) {
            // In real implementation, this would be handled by the protocol
            // For testing, we just record it
        }

        // Execute the call
        try IUniversalContract(target).onCall(context, zrc20, amount, message) {
            calls[callId].executed = true;
            emit CallExecuted(callId, true);
        } catch (bytes memory reason) {
            calls[callId].failed = true;
            emit CallReverted(callId, reason);
            
            // Try to revert
            if (shouldFailRevert[callId]) {
                emit CallAborted(callId, "Revert failed");
                _executeAbort(target, context, zrc20, amount, message);
            } else {
                _executeRevert(target, context, zrc20, amount, message);
            }
        }

        return callId;
    }

    /**
     * @dev Execute revert on the target contract
     */
    function _executeRevert(
        address target,
        MessageContext memory context,
        address zrc20,
        uint256 amount,
        bytes memory message
    ) internal {
        RevertContext memory revertCtx = RevertContext({
            sender: context.sender,
            asset: zrc20,
            amount: amount,
            chainID: context.chainID,
            revertMessage: message,
            outgoing: false
        });

        try IUniversalContract(target).onRevert(revertCtx) {
            // Revert successful
        } catch {
            // Revert failed, should trigger abort
            _executeAbort(target, context, zrc20, amount, message);
        }
    }

    /**
     * @dev Execute abort on the target contract
     */
    function _executeAbort(
        address target,
        MessageContext memory context,
        address zrc20,
        uint256 amount,
        bytes memory message
    ) internal {
        AbortContext memory abortCtx = AbortContext({
            sender: context.sender,
            asset: zrc20,
            amount: amount,
            chainID: context.chainID,
            revertMessage: message,
            outgoing: false
        });

        try IUniversalContract(target).onAbort(abortCtx) {
            // Abort executed
        } catch {
            // Even abort failed - this is a critical error
            // In real protocol, this would be handled by governance
        }
    }

    /**
     * @dev Configure call to fail for testing
     */
    function setCallFailure(uint256 callId, bool shouldFail) external {
        shouldFailCall[callId] = shouldFail;
    }

    /**
     * @dev Configure revert to fail for testing
     */
    function setRevertFailure(uint256 callId, bool shouldFail) external {
        shouldFailRevert[callId] = shouldFail;
    }

    /**
     * @dev Set delay for a call
     */
    function setCallDelay(uint256 callId, uint256 delay) external {
        callDelays[callId] = delay;
    }

    /**
     * @dev Get call details
     */
    function getCall(uint256 callId) external view returns (CallRecord memory) {
        return calls[callId];
    }

    /**
     * @dev Check if call was executed successfully
     */
    function isCallExecuted(uint256 callId) external view returns (bool) {
        return calls[callId].executed;
    }

    /**
     * @dev Check if call failed
     */
    function isCallFailed(uint256 callId) external view returns (bool) {
        return calls[callId].failed;
    }

    /**
     * @dev Simulate deposit and call (for connected chain contracts)
     */
    function depositAndCall(
        address receiver,
        uint256 amount,
        address asset,
        bytes calldata message
    ) external payable {
        // This would normally be called from connected chains
        // For testing, we can simulate the cross-chain message
        MessageContext memory context = MessageContext({
            chainID: block.chainid,
            sender: msg.sender,
            origin: ""
        });

        this.crossChainCall(receiver, asset, amount, message, context);
    }
}

/**
 * @dev Interface for Universal Contract
 */
interface IUniversalContract {
    function onCall(
        MockZetaEndpoint.MessageContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external;

    function onRevert(MockZetaEndpoint.RevertContext calldata context) external;

    function onAbort(MockZetaEndpoint.AbortContext calldata context) external;
}
