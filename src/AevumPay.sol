// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AevumPay
/// @notice Metered, session-authorized stablecoin payments with on-chain receipts.
///         A merchant lists a resource with a unit price; a payer opens a session
///         card (spender + merchant + cap + expiry); the spender charges the card
///         per unit consumed and every charge emits a receipt hash that can be
///         reconciled off-chain. Caps here are *business* limits on top of the
///         platform's ERC-4337 session keys, not a replacement for them.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice EIP-3009 (USDC-style) signed transfer. tUSD8 on Aevum implements this,
///         so the payer never needs native gas: the agent submits the charge.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract AevumPay {
    struct Resource {
        address merchant;
        uint256 unitPrice; // in token base units (tUSD8: 6 decimals)
        bool active;
    }

    struct Card {
        address payer;
        address merchant;
        address spender;
        uint256 cap;
        uint256 spent;
        uint64 expiry;
        bool revoked;
        bool anyMerchant;
    }

    /// @notice EIP-3009 signature envelope for a gasless charge.
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        uint256 salt;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IERC20 public immutable token;

    mapping(bytes32 => Resource) public resources; // resourceId => listed resource
    mapping(address => bool) public merchants;

    mapping(bytes32 => Card) public cards;
    uint256 public receiptCount;

    bool private _locked;

    event MerchantRegistered(address indexed merchant);
    event ResourceListed(bytes32 indexed resourceId, address indexed merchant, uint256 unitPrice);
    event ResourcePriceUpdated(bytes32 indexed resourceId, uint256 unitPrice);
    event ResourceDeactivated(bytes32 indexed resourceId);
    event CardCreated(
        bytes32 indexed cardId,
        address indexed payer,
        address indexed merchant,
        address spender,
        uint256 cap,
        uint64 expiry
    );
    event Charged(
        bytes32 indexed cardId,
        bytes32 indexed resourceId,
        address indexed payer,
        address merchant,
        uint256 units,
        uint256 amount,
        bytes32 receiptHash,
        uint256 receiptIndex
    );
    event CardRevoked(bytes32 indexed cardId, address indexed by);
    event Refunded(
        bytes32 indexed cardId, address indexed merchant, address indexed payer, uint256 amount, bytes32 reason
    );

    error NotMerchant();
    error ResourceNotActive();
    error ResourceOwnerMismatch();
    error ZeroAmount();
    error NotPayerOrSpender();
    error CardRevokedErr();
    error CardExpired();
    error SpenderMismatch();
    error MerchantMismatch();
    error CapExceeded();
    error TransferFailed();
    error Reentrant();
    error RefundTooLarge();

    modifier nonReentrant() {
        if (_locked) revert Reentrant();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address token_) {
        token = IERC20(token_);
    }

    // ---------------------------------------------------------------- merchant

    function registerMerchant() external {
        merchants[msg.sender] = true;
        emit MerchantRegistered(msg.sender);
    }

    function listResource(bytes32 resourceId, uint256 unitPrice) external {
        if (!merchants[msg.sender]) revert NotMerchant();
        resources[resourceId] = Resource({merchant: msg.sender, unitPrice: unitPrice, active: true});
        emit ResourceListed(resourceId, msg.sender, unitPrice);
    }

    function setResourcePrice(bytes32 resourceId, uint256 unitPrice) external {
        Resource storage r = resources[resourceId];
        if (!r.active) revert ResourceNotActive();
        if (r.merchant != msg.sender) revert ResourceOwnerMismatch();
        r.unitPrice = unitPrice;
        emit ResourcePriceUpdated(resourceId, unitPrice);
    }

    function deactivateResource(bytes32 resourceId) external {
        Resource storage r = resources[resourceId];
        if (r.merchant != msg.sender) revert ResourceOwnerMismatch();
        r.active = false;
        emit ResourceDeactivated(resourceId);
    }

    // ------------------------------------------------------------------- cards

    /// @notice Payer opens a metered session card for an agent spender.
    /// @dev Payer must approve this contract for up to `cap` of the token.
    function createCard(address spender, address merchant, uint256 cap, uint64 expiry, uint256 salt)
        external
        returns (bytes32 cardId)
    {
        if (cap == 0) revert ZeroAmount();
        cardId = keccak256(abi.encode(msg.sender, spender, merchant, cap, expiry, salt));
        Card storage c = cards[cardId];
        c.payer = msg.sender;
        c.merchant = merchant;
        c.spender = spender;
        c.cap = cap;
        c.expiry = expiry;
        emit CardCreated(cardId, msg.sender, merchant, spender, cap, expiry);
    }

    /// @notice Open a card that any listed merchant may charge (still capped and time-boxed).
    function createAnyMerchantCard(address spender, uint256 cap, uint64 expiry, uint256 salt)
        external
        returns (bytes32 cardId)
    {
        if (cap == 0) revert ZeroAmount();
        cardId = keccak256(abi.encode(msg.sender, spender, address(0), cap, expiry, salt));
        Card storage c = cards[cardId];
        c.payer = msg.sender;
        c.merchant = address(0);
        c.spender = spender;
        c.cap = cap;
        c.expiry = expiry;
        c.anyMerchant = true;
        emit CardCreated(cardId, msg.sender, address(0), spender, cap, expiry);
    }

    /// @notice Merchant sends tUSD8 back to the payer and re-opens that much budget on the card.
    /// @dev Funds come from the caller (must approve this contract); `spent` is reduced, capped at zero.
    function refund(bytes32 cardId, uint256 amount, bytes32 reason) external nonReentrant {
        Card storage c = cards[cardId];
        if (amount == 0) revert ZeroAmount();
        if (amount > c.spent) revert RefundTooLarge();
        c.spent -= amount;
        if (!token.transferFrom(msg.sender, c.payer, amount)) revert TransferFailed();
        emit Refunded(cardId, msg.sender, c.payer, amount, reason);
    }

    function revokeCard(bytes32 cardId) external {
        Card storage c = cards[cardId];
        if (msg.sender != c.payer && msg.sender != c.spender) revert NotPayerOrSpender();
        c.revoked = true;
        emit CardRevoked(cardId, msg.sender);
    }

    /// @notice Charge `units` of a listed resource against a session card.
    ///         Callable only by the card's spender (the agent); payer must approve this contract.
    function charge(bytes32 cardId, bytes32 resourceId, uint256 units, bytes32 receiptHash)
        external
        nonReentrant
        returns (uint256 amount)
    {
        address payer;
        address merchant;
        (payer, merchant, amount) = _reserve(cardId, resourceId, units);
        uint256 idx = ++receiptCount;

        if (!token.transferFrom(payer, merchant, amount)) revert TransferFailed();

        emit Charged(cardId, resourceId, payer, merchant, units, amount, receiptHash, idx);
    }

    // --------------------------------------------------- gasless (EIP-3009)

    /// @notice Gasless charge: the payer signed an EIP-3009 authorization for this
    ///         exact (card, amount, salt) tuple; the agent submits it and pays gas.
    ///         The nonce binds the signature to the card and amount, so a relayer
    ///         cannot replay it against another card, price or merchant.
    function chargeWithAuthorization(
        bytes32 cardId,
        bytes32 resourceId,
        uint256 units,
        bytes32 receiptHash,
        Authorization calldata auth
    ) external nonReentrant returns (uint256 amount) {
        address payer;
        address merchant;
        (payer, merchant, amount) = _reserve(cardId, resourceId, units);
        uint256 idx = ++receiptCount;

        IERC3009(address(token))
            .receiveWithAuthorization(
                payer,
                address(this),
                amount,
                auth.validAfter,
                auth.validBefore,
                authorizationNonce(cardId, amount, auth.salt),
                auth.v,
                auth.r,
                auth.s
            );
        if (!token.transfer(merchant, amount)) revert TransferFailed();

        emit Charged(cardId, resourceId, payer, merchant, units, amount, receiptHash, idx);
    }

    /// @notice Nonce the payer signs for a gasless charge; binds signature to card + amount.
    function authorizationNonce(bytes32 cardId, uint256 amount, uint256 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), cardId, amount, salt));
    }

    /// @dev Shared validation for both payment modes; debits the card and returns
    ///      the parties so each caller can execute its own transfer mechanism.
    function _reserve(bytes32 cardId, bytes32 resourceId, uint256 units)
        internal
        returns (address payer, address merchant, uint256 amount)
    {
        Card storage c = cards[cardId];
        if (c.revoked) revert CardRevokedErr();
        if (block.timestamp > c.expiry) revert CardExpired();
        if (msg.sender != c.spender) revert SpenderMismatch();

        Resource storage res = resources[resourceId];
        if (!res.active) revert ResourceNotActive();
        address payee = c.anyMerchant ? res.merchant : c.merchant;
        if (!c.anyMerchant && res.merchant != c.merchant) revert MerchantMismatch();

        amount = res.unitPrice * units;
        if (amount == 0) revert ZeroAmount();
        if (c.spent + amount > c.cap) revert CapExceeded();

        c.spent += amount;
        return (c.payer, payee, amount);
    }

    // ------------------------------------------------------------------- views

    function remaining(bytes32 cardId) external view returns (uint256) {
        Card storage c = cards[cardId];
        return c.cap - c.spent;
    }
}
