// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title P2PEscrow
 * @notice Peer-to-peer escrow for shielded Zcash <-> fiat trades
 * @dev Manages offers, trades, and escrow for P2P marketplace
 * 
 * Flow for SELL ZEC offer (seller has ZEC, wants fiat):
 * 1. Seller creates offer with ZEC amount and fiat price
 * 2. Seller deposits ZEC into escrow (registers commitment on-chain)
 * 3. Buyer accepts offer, providing fiat payment info
 * 4. Buyer sends fiat payment to seller (off-chain)
 * 5. Buyer marks payment as sent
 * 6. Seller confirms receipt, releasing ZEC to buyer's shielded address
 * 7. If dispute: arbitration by resolver
 * 
 * Flow for BUY ZEC offer (buyer has fiat, wants ZEC):
 * 1. Buyer creates offer specifying amount they want to buy
 * 2. Seller accepts offer and deposits ZEC into escrow
 * 3. Buyer sends fiat payment (off-chain)
 * 4. Same confirmation flow as above
 */
contract P2PEscrow is ReentrancyGuard, Pausable, Ownable {
    
    // ============ Enums ============
    
    enum OfferType {
        Sell,   // Offering ZEC for fiat
        Buy     // Offering fiat for ZEC
    }
    
    enum OfferStatus {
        Active,     // Open for takers
        InTrade,    // Currently in an active trade
        Completed,  // Closed after successful trade
        Cancelled   // Cancelled by maker
    }
    
    enum TradeStatus {
        None,           // 0: Does not exist
        Pending,        // 1: Trade initiated, waiting for escrow
        EscrowLocked,   // 2: ZEC escrowed, waiting for fiat payment
        FiatSent,       // 3: Buyer claims fiat sent
        Completed,      // 4: Trade completed successfully
        Disputed,       // 5: Under dispute
        Cancelled,      // 6: Cancelled (before escrow)
        Released,       // 7: ZEC released to buyer
        Refunded        // 8: ZEC refunded to seller after dispute
    }
    
    // ============ Structs ============
    
    struct Offer {
        bytes32 offerId;
        address maker;
        OfferType offerType;
        
        // Amount in zatoshi (1 ZEC = 100_000_000 zatoshi)
        uint256 zecAmountZatoshi;
        
        // Price in fiat cents (e.g., USD cents)
        uint256 fiatAmountCents;
        string fiatCurrency;        // "USD", "EUR", etc.
        
        // Payment methods accepted (e.g., "bank,venmo,cashapp")
        string paymentMethods;
        
        // Maker's contact info (encrypted or hash)
        bytes32 contactHash;
        
        // Min/max trade amounts
        uint256 minTradeZatoshi;
        uint256 maxTradeZatoshi;
        
        // State
        OfferStatus status;
        uint256 createdAt;
        uint256 completedTrades;
        
        // Maker's shielded address commitment (for receiving/sending ZEC)
        bytes32 shieldedAddressCommitment;
    }
    
    struct Trade {
        bytes32 tradeId;
        bytes32 offerId;
        
        address seller;
        address buyer;
        
        // Trade amounts
        uint256 zecAmountZatoshi;
        uint256 fiatAmountCents;
        string fiatCurrency;
        
        // Payment info
        string paymentMethod;
        bytes32 paymentReference;   // Off-chain reference (bank txn ID, etc.)
        
        // Buyer's shielded address commitment (to receive ZEC)
        bytes32 buyerShieldedCommitment;
        
        // ZEC escrow proof (commitment to escrowed funds)
        bytes32 escrowCommitment;
        
        // State
        TradeStatus status;
        uint256 createdAt;
        uint256 escrowedAt;
        uint256 fiatSentAt;
        uint256 completedAt;
        uint256 expiresAt;
        
        // Dispute
        string disputeReason;
        address disputeOpener;
    }
    
    struct UserProfile {
        address userAddress;
        uint256 totalTrades;
        uint256 successfulTrades;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 totalVolumeZatoshi;
        uint256 registeredAt;
        uint256 lastActiveAt;
        bytes32 reputationHash;     // IPFS hash of reputation data
    }
    
    // ============ State ============
    
    /// @notice All offers by ID
    mapping(bytes32 => Offer) public offers;
    
    /// @notice All trades by ID
    mapping(bytes32 => Trade) public trades;
    
    /// @notice User profiles
    mapping(address => UserProfile) public profiles;
    
    /// @notice Maker's active offers
    mapping(address => bytes32[]) public makerOffers;
    
    /// @notice User's trade history
    mapping(address => bytes32[]) public userTrades;
    
    /// @notice Trade timeout (default 2 hours for fiat payment)
    uint256 public tradeTimeout = 2 hours;
    
    /// @notice Escrow timeout (time for seller to escrow after trade starts)
    uint256 public escrowTimeout = 30 minutes;
    
    /// @notice Dispute resolution timeout
    uint256 public disputeTimeout = 72 hours;
    
    /// @notice Protocol fee in basis points
    uint256 public protocolFeeBps = 25; // 0.25%
    
    /// @notice Fee recipient
    address public feeRecipient;
    
    /// @notice Dispute resolver (multisig or DAO)
    address public disputeResolver;
    
    /// @notice Offer counter for unique IDs
    uint256 private offerNonce;
    
    /// @notice Trade counter for unique IDs
    uint256 private tradeNonce;
    
    // ============ Events ============
    
    event OfferCreated(
        bytes32 indexed offerId,
        address indexed maker,
        OfferType offerType,
        uint256 zecAmountZatoshi,
        uint256 fiatAmountCents,
        string fiatCurrency
    );
    
    event OfferCancelled(bytes32 indexed offerId);
    event OfferCompleted(bytes32 indexed offerId);
    
    event TradeInitiated(
        bytes32 indexed tradeId,
        bytes32 indexed offerId,
        address indexed taker,
        uint256 zecAmountZatoshi
    );
    
    event EscrowDeposited(
        bytes32 indexed tradeId,
        bytes32 escrowCommitment
    );
    
    event FiatPaymentSent(
        bytes32 indexed tradeId,
        bytes32 paymentReference
    );
    
    event TradeCompleted(
        bytes32 indexed tradeId,
        address indexed buyer,
        address indexed seller
    );
    
    event TradeCancelled(bytes32 indexed tradeId, string reason);
    
    event DisputeOpened(
        bytes32 indexed tradeId,
        address indexed opener,
        string reason
    );
    
    event DisputeResolved(
        bytes32 indexed tradeId,
        bool buyerWins
    );
    
    event UserRegistered(address indexed user);
    event ReputationUpdated(address indexed user, uint256 successfulTrades);
    
    // ============ Modifiers ============
    
    modifier onlyDisputeResolver() {
        require(msg.sender == disputeResolver, "Not dispute resolver");
        _;
    }
    
    modifier onlyTradeParticipant(bytes32 tradeId) {
        Trade storage trade = trades[tradeId];
        require(
            msg.sender == trade.seller || msg.sender == trade.buyer,
            "Not trade participant"
        );
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        address _feeRecipient,
        address _disputeResolver
    ) Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
        disputeResolver = _disputeResolver;
    }
    
    // ============ User Functions ============
    
    /**
     * @notice Register as a P2P trader
     */
    function registerUser() external {
        require(profiles[msg.sender].registeredAt == 0, "Already registered");
        
        profiles[msg.sender] = UserProfile({
            userAddress: msg.sender,
            totalTrades: 0,
            successfulTrades: 0,
            disputesWon: 0,
            disputesLost: 0,
            totalVolumeZatoshi: 0,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            reputationHash: bytes32(0)
        });
        
        emit UserRegistered(msg.sender);
    }
    
    // ============ Offer Functions ============
    
    /**
     * @notice Create a new offer
     * @param offerType Sell or Buy
     * @param zecAmountZatoshi Amount of ZEC in zatoshi
     * @param fiatAmountCents Fiat price in cents
     * @param fiatCurrency Currency code
     * @param paymentMethods Accepted payment methods
     * @param minTradeZatoshi Minimum trade amount
     * @param maxTradeZatoshi Maximum trade amount
     * @param shieldedAddressCommitment Commitment to maker's shielded address
     * @param contactHash Hash of contact info
     */
    function createOffer(
        OfferType offerType,
        uint256 zecAmountZatoshi,
        uint256 fiatAmountCents,
        string calldata fiatCurrency,
        string calldata paymentMethods,
        uint256 minTradeZatoshi,
        uint256 maxTradeZatoshi,
        bytes32 shieldedAddressCommitment,
        bytes32 contactHash
    ) external whenNotPaused returns (bytes32 offerId) {
        require(zecAmountZatoshi > 0, "Amount must be > 0");
        require(fiatAmountCents > 0, "Price must be > 0");
        require(minTradeZatoshi <= maxTradeZatoshi, "Invalid min/max");
        require(maxTradeZatoshi <= zecAmountZatoshi, "Max exceeds total");
        require(bytes(fiatCurrency).length == 3, "Invalid currency");
        require(shieldedAddressCommitment != bytes32(0), "Invalid address commitment");
        
        // Ensure user is registered
        if (profiles[msg.sender].registeredAt == 0) {
            this.registerUser();
        }
        
        offerId = keccak256(abi.encodePacked(
            msg.sender,
            offerType,
            zecAmountZatoshi,
            block.timestamp,
            ++offerNonce
        ));
        
        offers[offerId] = Offer({
            offerId: offerId,
            maker: msg.sender,
            offerType: offerType,
            zecAmountZatoshi: zecAmountZatoshi,
            fiatAmountCents: fiatAmountCents,
            fiatCurrency: fiatCurrency,
            paymentMethods: paymentMethods,
            contactHash: contactHash,
            minTradeZatoshi: minTradeZatoshi,
            maxTradeZatoshi: maxTradeZatoshi,
            status: OfferStatus.Active,
            createdAt: block.timestamp,
            completedTrades: 0,
            shieldedAddressCommitment: shieldedAddressCommitment
        });
        
        makerOffers[msg.sender].push(offerId);
        profiles[msg.sender].lastActiveAt = block.timestamp;
        
        emit OfferCreated(
            offerId,
            msg.sender,
            offerType,
            zecAmountZatoshi,
            fiatAmountCents,
            fiatCurrency
        );
    }
    
    /**
     * @notice Cancel an active offer
     * @param offerId Offer to cancel
     */
    function cancelOffer(bytes32 offerId) external {
        Offer storage offer = offers[offerId];
        require(offer.maker == msg.sender, "Not offer maker");
        require(offer.status == OfferStatus.Active, "Offer not active");
        
        offer.status = OfferStatus.Cancelled;
        emit OfferCancelled(offerId);
    }
    
    // ============ Trade Functions ============
    
    /**
     * @notice Initiate a trade on an offer
     * @param offerId Offer to trade on
     * @param zecAmountZatoshi Amount to trade (within offer limits)
     * @param buyerShieldedCommitment Buyer's shielded address commitment
     * @param paymentMethod Chosen payment method
     */
    function initiateTrade(
        bytes32 offerId,
        uint256 zecAmountZatoshi,
        bytes32 buyerShieldedCommitment,
        string calldata paymentMethod
    ) external whenNotPaused returns (bytes32 tradeId) {
        Offer storage offer = offers[offerId];
        require(offer.status == OfferStatus.Active, "Offer not active");
        require(offer.maker != msg.sender, "Cannot trade own offer");
        require(zecAmountZatoshi >= offer.minTradeZatoshi, "Below minimum");
        require(zecAmountZatoshi <= offer.maxTradeZatoshi, "Above maximum");
        require(zecAmountZatoshi <= offer.zecAmountZatoshi, "Exceeds available");
        require(buyerShieldedCommitment != bytes32(0), "Invalid buyer address");
        
        // Ensure taker is registered
        if (profiles[msg.sender].registeredAt == 0) {
            this.registerUser();
        }
        
        // Calculate proportional fiat amount
        uint256 fiatAmount = (offer.fiatAmountCents * zecAmountZatoshi) / offer.zecAmountZatoshi;
        
        tradeId = keccak256(abi.encodePacked(
            offerId,
            msg.sender,
            zecAmountZatoshi,
            block.timestamp,
            ++tradeNonce
        ));
        
        // Determine buyer/seller based on offer type
        address seller = offer.offerType == OfferType.Sell ? offer.maker : msg.sender;
        address buyer = offer.offerType == OfferType.Sell ? msg.sender : offer.maker;
        
        trades[tradeId] = Trade({
            tradeId: tradeId,
            offerId: offerId,
            seller: seller,
            buyer: buyer,
            zecAmountZatoshi: zecAmountZatoshi,
            fiatAmountCents: fiatAmount,
            fiatCurrency: offer.fiatCurrency,
            paymentMethod: paymentMethod,
            paymentReference: bytes32(0),
            buyerShieldedCommitment: buyerShieldedCommitment,
            escrowCommitment: bytes32(0),
            status: TradeStatus.Pending,
            createdAt: block.timestamp,
            escrowedAt: 0,
            fiatSentAt: 0,
            completedAt: 0,
            expiresAt: block.timestamp + escrowTimeout,
            disputeReason: "",
            disputeOpener: address(0)
        });
        
        // Update offer status
        offer.status = OfferStatus.InTrade;
        
        // Track trade for both users
        userTrades[seller].push(tradeId);
        userTrades[buyer].push(tradeId);
        
        // Update user activity
        profiles[msg.sender].lastActiveAt = block.timestamp;
        profiles[offer.maker].lastActiveAt = block.timestamp;
        
        emit TradeInitiated(tradeId, offerId, msg.sender, zecAmountZatoshi);
    }
    
    /**
     * @notice Seller deposits ZEC into escrow (registers commitment)
     * @param tradeId Trade ID
     * @param escrowCommitment Commitment proving ZEC is locked
     * @dev In a real implementation, this would verify a ZK proof that ZEC
     *      has been sent to the escrow address with a nullifier commitment
     */
    function depositEscrow(
        bytes32 tradeId,
        bytes32 escrowCommitment
    ) external {
        Trade storage trade = trades[tradeId];
        require(trade.seller == msg.sender, "Not seller");
        require(trade.status == TradeStatus.Pending, "Invalid status");
        require(block.timestamp <= trade.expiresAt, "Trade expired");
        require(escrowCommitment != bytes32(0), "Invalid escrow commitment");
        
        trade.escrowCommitment = escrowCommitment;
        trade.status = TradeStatus.EscrowLocked;
        trade.escrowedAt = block.timestamp;
        trade.expiresAt = block.timestamp + tradeTimeout;
        
        emit EscrowDeposited(tradeId, escrowCommitment);
    }
    
    /**
     * @notice Buyer marks fiat payment as sent
     * @param tradeId Trade ID
     * @param paymentReference Off-chain payment reference
     */
    function markFiatSent(
        bytes32 tradeId,
        bytes32 paymentReference
    ) external {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender, "Not buyer");
        require(trade.status == TradeStatus.EscrowLocked, "ZEC not escrowed");
        
        trade.paymentReference = paymentReference;
        trade.status = TradeStatus.FiatSent;
        trade.fiatSentAt = block.timestamp;
        
        emit FiatPaymentSent(tradeId, paymentReference);
    }
    
    /**
     * @notice Seller confirms fiat received, releasing ZEC to buyer
     * @param tradeId Trade ID
     * @dev In a real implementation, seller would provide a signature
     *      authorizing release of the escrowed ZEC
     */
    function confirmFiatReceived(bytes32 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.seller == msg.sender, "Not seller");
        require(
            trade.status == TradeStatus.EscrowLocked ||
            trade.status == TradeStatus.FiatSent,
            "Invalid status"
        );
        
        _completeTrade(tradeId);
    }
    
    /**
     * @notice Cancel a trade (only before escrow is locked)
     * @param tradeId Trade ID
     */
    function cancelTrade(bytes32 tradeId) external {
        Trade storage trade = trades[tradeId];
        require(
            msg.sender == trade.seller || msg.sender == trade.buyer,
            "Not participant"
        );
        require(trade.status == TradeStatus.Pending, "Cannot cancel");
        
        trade.status = TradeStatus.Cancelled;
        
        // Reactivate the offer
        Offer storage offer = offers[trade.offerId];
        offer.status = OfferStatus.Active;
        
        emit TradeCancelled(tradeId, "Cancelled by participant");
    }
    
    // ============ Dispute Functions ============
    
    /**
     * @notice Open a dispute on a trade
     * @param tradeId Trade ID
     * @param reason Reason for dispute
     */
    function openDispute(
        bytes32 tradeId,
        string calldata reason
    ) external onlyTradeParticipant(tradeId) {
        Trade storage trade = trades[tradeId];
        require(
            trade.status == TradeStatus.EscrowLocked ||
            trade.status == TradeStatus.FiatSent,
            "Cannot dispute"
        );
        
        trade.status = TradeStatus.Disputed;
        trade.disputeReason = reason;
        trade.disputeOpener = msg.sender;
        trade.expiresAt = block.timestamp + disputeTimeout;
        
        emit DisputeOpened(tradeId, msg.sender, reason);
    }
    
    /**
     * @notice Resolve a dispute (only dispute resolver)
     * @param tradeId Trade ID
     * @param buyerWins True if buyer should receive ZEC
     */
    function resolveDispute(
        bytes32 tradeId,
        bool buyerWins
    ) external onlyDisputeResolver nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Disputed, "Not disputed");
        
        if (buyerWins) {
            // Complete trade - ZEC goes to buyer
            _completeTrade(tradeId);
            profiles[trade.buyer].disputesWon += 1;
            profiles[trade.seller].disputesLost += 1;
        } else {
            // Refund - ZEC returns to seller
            trade.status = TradeStatus.Refunded;
            profiles[trade.seller].disputesWon += 1;
            profiles[trade.buyer].disputesLost += 1;
            
            // Reactivate offer
            Offer storage offer = offers[trade.offerId];
            offer.status = OfferStatus.Active;
        }
        
        emit DisputeResolved(tradeId, buyerWins);
    }
    
    // ============ Internal Functions ============
    
    function _completeTrade(bytes32 tradeId) internal {
        Trade storage trade = trades[tradeId];
        Offer storage offer = offers[trade.offerId];
        
        trade.status = TradeStatus.Released;
        trade.completedAt = block.timestamp;
        
        // Update offer
        offer.zecAmountZatoshi -= trade.zecAmountZatoshi;
        offer.completedTrades += 1;
        
        if (offer.zecAmountZatoshi == 0) {
            offer.status = OfferStatus.Completed;
            emit OfferCompleted(offer.offerId);
        } else {
            offer.status = OfferStatus.Active;
        }
        
        // Update user profiles
        profiles[trade.seller].totalTrades += 1;
        profiles[trade.seller].successfulTrades += 1;
        profiles[trade.seller].totalVolumeZatoshi += trade.zecAmountZatoshi;
        
        profiles[trade.buyer].totalTrades += 1;
        profiles[trade.buyer].successfulTrades += 1;
        profiles[trade.buyer].totalVolumeZatoshi += trade.zecAmountZatoshi;
        
        emit TradeCompleted(tradeId, trade.buyer, trade.seller);
        emit ReputationUpdated(trade.seller, profiles[trade.seller].successfulTrades);
        emit ReputationUpdated(trade.buyer, profiles[trade.buyer].successfulTrades);
    }
    
    // ============ View Functions ============
    
    function getOffer(bytes32 offerId) external view returns (Offer memory) {
        return offers[offerId];
    }
    
    function getTrade(bytes32 tradeId) external view returns (Trade memory) {
        return trades[tradeId];
    }
    
    function getUserProfile(address user) external view returns (UserProfile memory) {
        return profiles[user];
    }
    
    function getMakerOffers(address maker) external view returns (bytes32[] memory) {
        return makerOffers[maker];
    }
    
    function getUserTrades(address user) external view returns (bytes32[] memory) {
        return userTrades[user];
    }
    
    function getUserSuccessRate(address user) external view returns (uint256) {
        UserProfile storage profile = profiles[user];
        if (profile.totalTrades == 0) return 0;
        return (profile.successfulTrades * 100) / profile.totalTrades;
    }
    
    // ============ Admin Functions ============
    
    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 100, "Max 1%");
        protocolFeeBps = newFeeBps;
    }
    
    function setTradeTimeout(uint256 newTimeout) external onlyOwner {
        tradeTimeout = newTimeout;
    }
    
    function setEscrowTimeout(uint256 newTimeout) external onlyOwner {
        escrowTimeout = newTimeout;
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
}

