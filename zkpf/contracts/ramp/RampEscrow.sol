// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RampEscrow
 * @notice Permissionless fiat-to-crypto escrow for the zkpf Ramp Protocol
 * @dev Manages ramp intents, agent liquidity, and settlement
 * 
 * Flow:
 * 1. Buyer creates intent (specifies fiat amount, crypto out)
 * 2. Agent accepts intent, locking their liquidity
 * 3. Buyer pays agent via fiat rails (card, bank, etc.)
 * 4. Agent confirms payment, releasing crypto to buyer
 * 5. Dispute mechanism if either party misbehaves
 */
contract RampEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    enum IntentStatus {
        None,           // 0: Does not exist
        Pending,        // 1: Created, waiting for agent
        Locked,         // 2: Agent accepted, crypto locked
        PaymentSent,    // 3: Buyer claims payment sent
        Confirmed,      // 4: Agent confirmed payment
        Released,       // 5: Crypto released to buyer
        Disputed,       // 6: Under dispute
        Cancelled,      // 7: Cancelled by buyer (before lock)
        Expired,        // 8: Timed out
        Refunded        // 9: Refunded after dispute
    }

    struct RampIntent {
        bytes32 intentId;
        address buyer;
        address agent;
        address cryptoToken;        // Token to receive (zkUSD, etc.)
        uint256 cryptoAmount;       // Amount of crypto to receive
        uint256 fiatAmountCents;    // Fiat amount in cents
        string fiatCurrency;        // "USD", "EUR", etc.
        IntentStatus status;
        uint256 createdAt;
        uint256 lockedAt;
        uint256 expiresAt;
        bytes32 paymentReference;   // Off-chain payment reference
    }

    struct Agent {
        address agentAddress;
        uint256 stakedAmount;
        uint256 availableLiquidity;
        uint256 lockedLiquidity;
        uint16 spreadBps;           // Fee in basis points
        uint256 totalVolume;
        uint256 successCount;
        uint256 disputeCount;
        bool isActive;
        uint256 registeredAt;
    }

    // ============ State ============

    /// @notice Supported crypto tokens for ramp
    mapping(address => bool) public supportedTokens;

    /// @notice Ramp intents by ID
    mapping(bytes32 => RampIntent) public intents;

    /// @notice Registered agents
    mapping(address => Agent) public agents;

    /// @notice Agent liquidity per token
    mapping(address => mapping(address => uint256)) public agentTokenLiquidity;

    /// @notice Protocol fee in basis points
    uint256 public protocolFeeBps = 10; // 0.1%

    /// @notice Minimum agent stake
    uint256 public minAgentStake = 10_000e6; // $10,000 in staking token

    /// @notice Staking token (USDC or zkUSD)
    IERC20 public stakingToken;

    /// @notice Intent timeout (default 1 hour)
    uint256 public intentTimeout = 1 hours;

    /// @notice Payment confirmation timeout (after lock)
    uint256 public paymentTimeout = 30 minutes;

    /// @notice Dispute resolution timeout
    uint256 public disputeTimeout = 24 hours;

    /// @notice Protocol fee recipient
    address public feeRecipient;

    /// @notice Dispute resolver (can be DAO, multisig, or oracle)
    address public disputeResolver;

    /// @notice Intent counter for unique IDs
    uint256 private intentNonce;

    // ============ Events ============

    event AgentRegistered(address indexed agent, uint256 stake, uint16 spreadBps);
    event AgentDeactivated(address indexed agent);
    event LiquidityDeposited(address indexed agent, address indexed token, uint256 amount);
    event LiquidityWithdrawn(address indexed agent, address indexed token, uint256 amount);
    
    event IntentCreated(
        bytes32 indexed intentId,
        address indexed buyer,
        address cryptoToken,
        uint256 fiatAmountCents,
        string fiatCurrency
    );
    event IntentAccepted(bytes32 indexed intentId, address indexed agent, uint256 cryptoAmount);
    event PaymentSent(bytes32 indexed intentId, bytes32 paymentReference);
    event PaymentConfirmed(bytes32 indexed intentId);
    event CryptoReleased(bytes32 indexed intentId, address indexed buyer, uint256 amount);
    event IntentCancelled(bytes32 indexed intentId);
    event IntentExpired(bytes32 indexed intentId);
    event DisputeOpened(bytes32 indexed intentId, address indexed opener);
    event DisputeResolved(bytes32 indexed intentId, bool buyerWins);

    // ============ Modifiers ============

    modifier onlyAgent() {
        require(agents[msg.sender].isActive, "Not an active agent");
        _;
    }

    modifier onlyDisputeResolver() {
        require(msg.sender == disputeResolver, "Not dispute resolver");
        _;
    }

    // ============ Constructor ============

    constructor(
        address _stakingToken,
        address _feeRecipient,
        address _disputeResolver
    ) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        feeRecipient = _feeRecipient;
        disputeResolver = _disputeResolver;
    }

    // ============ Agent Functions ============

    /**
     * @notice Register as a ramp agent
     * @param spreadBps Agent's spread in basis points
     */
    function registerAgent(uint16 spreadBps) external nonReentrant {
        require(!agents[msg.sender].isActive, "Already registered");
        require(spreadBps <= 500, "Spread too high"); // Max 5%

        // Transfer stake
        stakingToken.safeTransferFrom(msg.sender, address(this), minAgentStake);

        agents[msg.sender] = Agent({
            agentAddress: msg.sender,
            stakedAmount: minAgentStake,
            availableLiquidity: 0,
            lockedLiquidity: 0,
            spreadBps: spreadBps,
            totalVolume: 0,
            successCount: 0,
            disputeCount: 0,
            isActive: true,
            registeredAt: block.timestamp
        });

        emit AgentRegistered(msg.sender, minAgentStake, spreadBps);
    }

    /**
     * @notice Deposit liquidity for a specific token
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function depositLiquidity(address token, uint256 amount) external onlyAgent nonReentrant {
        require(supportedTokens[token], "Token not supported");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        agentTokenLiquidity[msg.sender][token] += amount;
        agents[msg.sender].availableLiquidity += amount;

        emit LiquidityDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw available liquidity
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawLiquidity(address token, uint256 amount) external onlyAgent nonReentrant {
        require(agentTokenLiquidity[msg.sender][token] >= amount, "Insufficient liquidity");
        
        agentTokenLiquidity[msg.sender][token] -= amount;
        agents[msg.sender].availableLiquidity -= amount;
        
        IERC20(token).safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, token, amount);
    }

    /**
     * @notice Deactivate agent and begin stake withdrawal
     */
    function deactivateAgent() external onlyAgent {
        require(agents[msg.sender].lockedLiquidity == 0, "Has locked funds");
        agents[msg.sender].isActive = false;
        emit AgentDeactivated(msg.sender);
    }

    // ============ Buyer Functions ============

    /**
     * @notice Create a ramp intent
     * @param cryptoToken Token to receive
     * @param fiatAmountCents Fiat amount in cents
     * @param fiatCurrency Fiat currency code
     * @return intentId Unique intent identifier
     */
    function createIntent(
        address cryptoToken,
        uint256 fiatAmountCents,
        string calldata fiatCurrency
    ) external whenNotPaused returns (bytes32 intentId) {
        require(supportedTokens[cryptoToken], "Token not supported");
        require(fiatAmountCents >= 1000, "Minimum $10"); // $10 minimum

        intentId = keccak256(abi.encodePacked(
            msg.sender,
            cryptoToken,
            fiatAmountCents,
            block.timestamp,
            ++intentNonce
        ));

        intents[intentId] = RampIntent({
            intentId: intentId,
            buyer: msg.sender,
            agent: address(0),
            cryptoToken: cryptoToken,
            cryptoAmount: 0,
            fiatAmountCents: fiatAmountCents,
            fiatCurrency: fiatCurrency,
            status: IntentStatus.Pending,
            createdAt: block.timestamp,
            lockedAt: 0,
            expiresAt: block.timestamp + intentTimeout,
            paymentReference: bytes32(0)
        });

        emit IntentCreated(intentId, msg.sender, cryptoToken, fiatAmountCents, fiatCurrency);
    }

    /**
     * @notice Cancel a pending intent (before agent accepts)
     * @param intentId Intent to cancel
     */
    function cancelIntent(bytes32 intentId) external {
        RampIntent storage intent = intents[intentId];
        require(intent.buyer == msg.sender, "Not buyer");
        require(intent.status == IntentStatus.Pending, "Cannot cancel");

        intent.status = IntentStatus.Cancelled;
        emit IntentCancelled(intentId);
    }

    /**
     * @notice Mark payment as sent (provides reference for agent)
     * @param intentId Intent ID
     * @param paymentReference Off-chain payment reference
     */
    function markPaymentSent(bytes32 intentId, bytes32 paymentReference) external {
        RampIntent storage intent = intents[intentId];
        require(intent.buyer == msg.sender, "Not buyer");
        require(intent.status == IntentStatus.Locked, "Not locked");

        intent.paymentReference = paymentReference;
        intent.status = IntentStatus.PaymentSent;

        emit PaymentSent(intentId, paymentReference);
    }

    // ============ Agent Intent Functions ============

    /**
     * @notice Accept an intent and lock liquidity
     * @param intentId Intent to accept
     * @param cryptoAmount Amount of crypto to provide
     */
    function acceptIntent(bytes32 intentId, uint256 cryptoAmount) external onlyAgent nonReentrant {
        RampIntent storage intent = intents[intentId];
        require(intent.status == IntentStatus.Pending, "Not pending");
        require(block.timestamp < intent.expiresAt, "Intent expired");
        require(
            agentTokenLiquidity[msg.sender][intent.cryptoToken] >= cryptoAmount,
            "Insufficient liquidity"
        );

        // Lock liquidity
        agentTokenLiquidity[msg.sender][intent.cryptoToken] -= cryptoAmount;
        agents[msg.sender].availableLiquidity -= cryptoAmount;
        agents[msg.sender].lockedLiquidity += cryptoAmount;

        // Update intent
        intent.agent = msg.sender;
        intent.cryptoAmount = cryptoAmount;
        intent.status = IntentStatus.Locked;
        intent.lockedAt = block.timestamp;
        intent.expiresAt = block.timestamp + paymentTimeout;

        emit IntentAccepted(intentId, msg.sender, cryptoAmount);
    }

    /**
     * @notice Confirm payment received and release crypto
     * @param intentId Intent to confirm
     */
    function confirmPayment(bytes32 intentId) external nonReentrant {
        RampIntent storage intent = intents[intentId];
        require(intent.agent == msg.sender, "Not agent");
        require(
            intent.status == IntentStatus.Locked || 
            intent.status == IntentStatus.PaymentSent,
            "Invalid status"
        );

        // Calculate fees
        uint256 protocolFee = (intent.cryptoAmount * protocolFeeBps) / 10000;
        uint256 buyerAmount = intent.cryptoAmount - protocolFee;

        // Update state
        intent.status = IntentStatus.Released;
        agents[msg.sender].lockedLiquidity -= intent.cryptoAmount;
        agents[msg.sender].totalVolume += intent.fiatAmountCents;
        agents[msg.sender].successCount += 1;

        // Transfer crypto to buyer
        IERC20(intent.cryptoToken).safeTransfer(intent.buyer, buyerAmount);

        // Transfer protocol fee
        if (protocolFee > 0 && feeRecipient != address(0)) {
            IERC20(intent.cryptoToken).safeTransfer(feeRecipient, protocolFee);
        }

        emit PaymentConfirmed(intentId);
        emit CryptoReleased(intentId, intent.buyer, buyerAmount);
    }

    // ============ Dispute Functions ============

    /**
     * @notice Open a dispute (buyer claims payment sent, agent denies)
     * @param intentId Intent to dispute
     */
    function openDispute(bytes32 intentId) external {
        RampIntent storage intent = intents[intentId];
        require(
            msg.sender == intent.buyer || msg.sender == intent.agent,
            "Not participant"
        );
        require(intent.status == IntentStatus.PaymentSent, "Cannot dispute");
        require(block.timestamp > intent.expiresAt, "Payment window active");

        intent.status = IntentStatus.Disputed;
        intent.expiresAt = block.timestamp + disputeTimeout;

        emit DisputeOpened(intentId, msg.sender);
    }

    /**
     * @notice Resolve a dispute (called by dispute resolver)
     * @param intentId Intent under dispute
     * @param buyerWins True if buyer should receive crypto
     */
    function resolveDispute(
        bytes32 intentId,
        bool buyerWins
    ) external onlyDisputeResolver nonReentrant {
        RampIntent storage intent = intents[intentId];
        require(intent.status == IntentStatus.Disputed, "Not disputed");

        Agent storage agent = agents[intent.agent];

        if (buyerWins) {
            // Release crypto to buyer, slash agent
            uint256 protocolFee = (intent.cryptoAmount * protocolFeeBps) / 10000;
            uint256 buyerAmount = intent.cryptoAmount - protocolFee;

            intent.status = IntentStatus.Released;
            agent.lockedLiquidity -= intent.cryptoAmount;
            agent.disputeCount += 1;

            IERC20(intent.cryptoToken).safeTransfer(intent.buyer, buyerAmount);
            
            if (protocolFee > 0) {
                IERC20(intent.cryptoToken).safeTransfer(feeRecipient, protocolFee);
            }

            // Slash portion of agent stake
            uint256 slashAmount = intent.cryptoAmount / 2; // 50% of disputed amount
            if (slashAmount > agent.stakedAmount) {
                slashAmount = agent.stakedAmount;
            }
            agent.stakedAmount -= slashAmount;
            
            // Send slash to buyer as compensation
            stakingToken.safeTransfer(intent.buyer, slashAmount);
        } else {
            // Return crypto to agent
            intent.status = IntentStatus.Refunded;
            agent.lockedLiquidity -= intent.cryptoAmount;
            agentTokenLiquidity[intent.agent][intent.cryptoToken] += intent.cryptoAmount;
            agent.availableLiquidity += intent.cryptoAmount;
        }

        emit DisputeResolved(intentId, buyerWins);
    }

    /**
     * @notice Expire a timed-out intent
     * @param intentId Intent to expire
     */
    function expireIntent(bytes32 intentId) external {
        RampIntent storage intent = intents[intentId];
        require(block.timestamp > intent.expiresAt, "Not expired");
        require(
            intent.status == IntentStatus.Pending ||
            intent.status == IntentStatus.Locked,
            "Cannot expire"
        );

        if (intent.status == IntentStatus.Locked) {
            // Return locked funds to agent
            Agent storage agent = agents[intent.agent];
            agent.lockedLiquidity -= intent.cryptoAmount;
            agentTokenLiquidity[intent.agent][intent.cryptoToken] += intent.cryptoAmount;
            agent.availableLiquidity += intent.cryptoAmount;
        }

        intent.status = IntentStatus.Expired;
        emit IntentExpired(intentId);
    }

    // ============ Admin Functions ============

    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
    }

    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
    }

    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 100, "Max 1%");
        protocolFeeBps = newFeeBps;
    }

    function setMinAgentStake(uint256 newMin) external onlyOwner {
        minAgentStake = newMin;
    }

    function setDisputeResolver(address newResolver) external onlyOwner {
        disputeResolver = newResolver;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    function getIntent(bytes32 intentId) external view returns (RampIntent memory) {
        return intents[intentId];
    }

    function getAgent(address agentAddress) external view returns (Agent memory) {
        return agents[agentAddress];
    }

    function getAgentLiquidity(
        address agentAddress,
        address token
    ) external view returns (uint256) {
        return agentTokenLiquidity[agentAddress][token];
    }
}

