// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { ConsiderationEventsAndErrors } from "./ConsiderationEventsAndErrors.sol";
import "./ConsiderationConstants.sol";
import "./ConsiderationStructs.sol";
import "./ConsiderationErrorConstants.sol";
import { ConsiderationDecoder } from "./ConsiderationDecoder.sol";
import { OrderStatus } from "./ConsiderationStructs.sol";
import "./ConsiderationErrors.sol";
import { SignatureVerification } from "./SignatureVerification.sol";
import { Executor } from "./Executor.sol";
import "hardhat/console.sol";

/**
 * @title ConsiderationBase
 *
 * @notice ConsiderationBase contains immutable constants and constructor logic.
 */
contract ConsiderationBase is
    ConsiderationDecoder,
    ConsiderationEventsAndErrors,
    SignatureVerification,
    Executor
{
    // Precompute hashes, original chainId, and domain separator on deployment.
    bytes32 internal immutable _NAME_HASH;
    bytes32 internal immutable _VERSION_HASH;
    bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 internal immutable _OFFER_ITEM_TYPEHASH;
    bytes32 internal immutable _CONSIDERATION_ITEM_TYPEHASH;
    bytes32 internal immutable _ORDER_TYPEHASH;
    uint256 internal immutable _CHAIN_ID;
    bytes32 internal immutable _DOMAIN_SEPARATOR;

    mapping(address => uint256) private _counters;

    // Track status of each order (validated, cancelled, and fraction filled).
    mapping(bytes32 => OrderStatus) private _orderStatus;
    // Track doing orders
    mapping(bytes32 => LastMatchStatus) private _lastMatchStatus;

    /**
     * @dev Derive and set hashes, reference chainId, and associated domain
     *      separator during deployment.
     *
     */
    constructor() Executor() {
        // Derive name and version hashes alongside required EIP-712 typehashes.
        (
            _NAME_HASH,
            _VERSION_HASH,
            _EIP_712_DOMAIN_TYPEHASH,
            _OFFER_ITEM_TYPEHASH,
            _CONSIDERATION_ITEM_TYPEHASH,
            _ORDER_TYPEHASH
        ) = _deriveTypehashes();

        // Store the current chainId and derive the current domain separator.
        _CHAIN_ID = block.chainid;
        _DOMAIN_SEPARATOR = _deriveDomainSeparator();
    }

    /**
     * @dev Internal view function to retrieve the current counter for a given
     *      offerer.
     *
     * @param offerer The offerer in question.
     *
     * @return currentCounter The current counter.
     */
    function _getCounter(address offerer) internal view returns (uint256 currentCounter) {
        // Return the counter for the supplied offerer.
        currentCounter = _counters[offerer];
    }

    /**
     * @dev Internal view function to retrieve the status of a given order by
     *      hash, including whether the order has been cancelled or validated
     *      and the fraction of the order that has been filled.
     *
     * @param orderHash The order hash in question.
     *
     * @return isValidated A boolean indicating whether the order in question
     *                     has been validated (i.e. previously approved or
     *                     partially filled).
     * @return isCancelled A boolean indicating whether the order in question
     *                     has been cancelled.
     * @return totalFilled The total portion of the order that has been filled
     *                     (i.e. the "numerator").
     * @return totalSize   The total size of the order that is either filled or
     *                     unfilled (i.e. the "denominator").
     */
    function _getOrderStatus(
        bytes32 orderHash
    ) internal view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize) {
        // Retrieve the order status using the order hash.
        OrderStatus storage orderStatus = _orderStatus[orderHash];

        // Return the fields on the order status.
        return (orderStatus.isValidated, orderStatus.isCancelled, orderStatus.numerator, orderStatus.denominator);
    }

    function _getLastMatchStatus(bytes32 orderHash) internal view returns (uint120 numerator, uint120 denominator) {
        LastMatchStatus storage lastMatchStatus = _lastMatchStatus[orderHash];

        return (lastMatchStatus.numerator, lastMatchStatus.denominator);
    }

    function _storeLastMatchStatus(bytes32 orderHash, uint120 numerator, uint120 denominator) internal {
        LastMatchStatus storage lastMatchStatus = _lastMatchStatus[orderHash];

        lastMatchStatus.numerator = numerator;
        lastMatchStatus.denominator = denominator;
        lastMatchStatus.timestamp = block.timestamp;
    }

    function _checkLasmMatchStatusExist(bytes32 orderHash) internal view {
        require(_lastMatchStatus[orderHash].denominator == 0, Error_OngoingMatch);
    }

    function _restoreOriginalStatus(bytes32 orderHash) internal {
        OrderStatus storage orderStatus = _orderStatus[orderHash];
        LastMatchStatus storage lastMatchStatus = _lastMatchStatus[orderHash];
        // orderStatus.denominator is always equal to lastMatchStatus.denominator
        if (orderStatus.numerator == lastMatchStatus.numerator) {
            delete _orderStatus[orderHash];
        } else {
            orderStatus.numerator = orderStatus.numerator - lastMatchStatus.numerator;
        }
    }

    function _clearLastMatchStatus(bytes32 orderHash) internal {
        delete _lastMatchStatus[orderHash];
    }

    /**
     * @dev Internal view function to derive the EIP-712 domain separator.
     *
     * @return domainSeparator The derived domain separator.
     */
    function _deriveDomainSeparator() internal view returns (bytes32 domainSeparator) {
        bytes32 typehash = _EIP_712_DOMAIN_TYPEHASH;
        bytes32 nameHash = _NAME_HASH;
        bytes32 versionHash = _VERSION_HASH;

        // Leverage scratch space and other memory to perform an efficient hash.
        assembly {
            // Retrieve the free memory pointer; it will be replaced afterwards.
            let freeMemoryPointer := mload(FreeMemoryPointerSlot)

            // Retrieve value at 0x80; it will also be replaced afterwards.
            let slot0x80 := mload(Slot0x80)

            // Place typehash, name hash, and version hash at start of memory.
            mstore(0, typehash)
            mstore(EIP712_domainData_nameHash_offset, nameHash)
            mstore(EIP712_domainData_versionHash_offset, versionHash)

            // Place chainId in the next memory location.
            mstore(EIP712_domainData_chainId_offset, chainid())

            // Place the address of this contract in the next memory location.
            mstore(EIP712_domainData_verifyingContract_offset, address())

            // Hash relevant region of memory to derive the domain separator.
            domainSeparator := keccak256(0, EIP712_domainData_size)

            // Restore the free memory pointer.
            mstore(FreeMemoryPointerSlot, freeMemoryPointer)

            // Restore the zero slot to zero.
            mstore(ZeroSlot, 0)

            // Restore the value at 0x80.
            mstore(Slot0x80, slot0x80)
        }
    }

    /**
     * @dev Internal pure function to retrieve the default name of this contract
     *      as a string that can be used internally.
     *
     * @return The name of this contract.
     */
    function _nameString() internal pure virtual returns (string memory) {
        // Return the name of the contract.
        return "Consideration";
    }

    /**
     * @dev Internal pure function to derive required EIP-712 typehashes and
     *      other hashes during contract creation.
     *
     * @return nameHash                  The hash of the name of the contract.
     * @return versionHash               The hash of the version string of the
     *                                   contract.
     * @return eip712DomainTypehash      The primary EIP-712 domain typehash.
     * @return offerItemTypehash         The EIP-712 typehash for OfferItem
     *                                   types.
     * @return considerationItemTypehash The EIP-712 typehash for
     *                                   ConsiderationItem types.
     * @return orderTypehash             The EIP-712 typehash for Order types.
     */
    function _deriveTypehashes()
        internal
        pure
        returns (
            bytes32 nameHash,
            bytes32 versionHash,
            bytes32 eip712DomainTypehash,
            bytes32 offerItemTypehash,
            bytes32 considerationItemTypehash,
            bytes32 orderTypehash
        )
    {
        // Derive hash of the name of the contract.
        nameHash = keccak256(bytes(_nameString()));

        // Derive hash of the version string of the contract.
        versionHash = keccak256(bytes("2.0"));

        // Construct the OfferItem type string.
        bytes memory offerItemTypeString = bytes(
            "OfferItem("
            "uint8 itemType,"
            "address token,"
            "uint256 identifierOrCriteria,"
            "uint256 startAmount,"
            "uint256 endAmount"
            ")"
        );

        // Construct the ConsiderationItem type string.
        bytes memory considerationItemTypeString = bytes(
            "ConsiderationItem("
            "uint8 itemType,"
            "address token,"
            "uint256 identifierOrCriteria,"
            "uint256 startAmount,"
            "uint256 endAmount,"
            "address recipient"
            ")"
        );

        // Construct the OrderComponents type string, not including the above.
        bytes memory orderComponentsPartialTypeString = bytes(
            "OrderComponents("
            "address offerer,"
            "address zone,"
            "OfferItem[] offer,"
            "ConsiderationItem[] consideration,"
            "uint8 orderType,"
            "uint256 startTime,"
            "uint256 endTime,"
            "bytes32 zoneHash,"
            "uint256 salt,"
            "bytes32 conduitKey,"
            "uint256 counter"
            ")"
        );

        // Construct the primary EIP-712 domain type string.
        eip712DomainTypehash = keccak256(
            bytes(
                "EIP712Domain("
                "string name,"
                "string version,"
                "uint256 chainId,"
                "address verifyingContract"
                ")"
            )
        );

        // Derive the OfferItem type hash using the corresponding type string.
        offerItemTypehash = keccak256(offerItemTypeString);

        // Derive ConsiderationItem type hash using corresponding type string.
        considerationItemTypehash = keccak256(considerationItemTypeString);

        bytes memory orderTypeString = bytes.concat(
            orderComponentsPartialTypeString,
            considerationItemTypeString,
            offerItemTypeString
        );

        // Derive OrderItem type hash via combination of relevant type strings.
        orderTypehash = keccak256(orderTypeString);
    }

    /**
     * @dev Internal pure function to look up one of twenty-four potential bulk
     *      order typehash constants based on the height of the bulk order tree.
     *      Note that values between one and twenty-four are supported, which is
     *      enforced by _isValidBulkOrderSize.
     *
     * @param _treeHeight The height of the bulk order tree. The value must be
     *                    between one and twenty-four.
     *
     * @return _typeHash The EIP-712 typehash for the bulk order type with the
     *                   given height.
     */
    function _lookupBulkOrderTypehash(uint256 _treeHeight) internal pure returns (bytes32 _typeHash) {
        // Utilize assembly to efficiently retrieve correct bulk order typehash.
        assembly {
            // Use a Yul function to enable use of the `leave` keyword
            // to stop searching once the appropriate type hash is found.
            function lookupTypeHash(treeHeight) -> typeHash {
                // Handle tree heights one through eight.
                if lt(treeHeight, 9) {
                    // Handle tree heights one through four.
                    if lt(treeHeight, 5) {
                        // Handle tree heights one and two.
                        if lt(treeHeight, 3) {
                            // Utilize branchless logic to determine typehash.
                            typeHash := ternary(
                                eq(treeHeight, 1),
                                BulkOrder_Typehash_Height_One,
                                BulkOrder_Typehash_Height_Two
                            )

                            // Exit the function once typehash has been located.
                            leave
                        }

                        // Handle height three and four via branchless logic.
                        typeHash := ternary(
                            eq(treeHeight, 3),
                            BulkOrder_Typehash_Height_Three,
                            BulkOrder_Typehash_Height_Four
                        )

                        // Exit the function once typehash has been located.
                        leave
                    }

                    // Handle tree height five and six.
                    if lt(treeHeight, 7) {
                        // Utilize branchless logic to determine typehash.
                        typeHash := ternary(
                            eq(treeHeight, 5),
                            BulkOrder_Typehash_Height_Five,
                            BulkOrder_Typehash_Height_Six
                        )

                        // Exit the function once typehash has been located.
                        leave
                    }

                    // Handle height seven and eight via branchless logic.
                    typeHash := ternary(
                        eq(treeHeight, 7),
                        BulkOrder_Typehash_Height_Seven,
                        BulkOrder_Typehash_Height_Eight
                    )

                    // Exit the function once typehash has been located.
                    leave
                }

                // Handle tree height nine through sixteen.
                if lt(treeHeight, 17) {
                    // Handle tree height nine through twelve.
                    if lt(treeHeight, 13) {
                        // Handle tree height nine and ten.
                        if lt(treeHeight, 11) {
                            // Utilize branchless logic to determine typehash.
                            typeHash := ternary(
                                eq(treeHeight, 9),
                                BulkOrder_Typehash_Height_Nine,
                                BulkOrder_Typehash_Height_Ten
                            )

                            // Exit the function once typehash has been located.
                            leave
                        }

                        // Handle height eleven and twelve via branchless logic.
                        typeHash := ternary(
                            eq(treeHeight, 11),
                            BulkOrder_Typehash_Height_Eleven,
                            BulkOrder_Typehash_Height_Twelve
                        )

                        // Exit the function once typehash has been located.
                        leave
                    }

                    // Handle tree height thirteen and fourteen.
                    if lt(treeHeight, 15) {
                        // Utilize branchless logic to determine typehash.
                        typeHash := ternary(
                            eq(treeHeight, 13),
                            BulkOrder_Typehash_Height_Thirteen,
                            BulkOrder_Typehash_Height_Fourteen
                        )

                        // Exit the function once typehash has been located.
                        leave
                    }
                    // Handle height fifteen and sixteen via branchless logic.
                    typeHash := ternary(
                        eq(treeHeight, 15),
                        BulkOrder_Typehash_Height_Fifteen,
                        BulkOrder_Typehash_Height_Sixteen
                    )

                    // Exit the function once typehash has been located.
                    leave
                }

                // Handle tree height seventeen through twenty.
                if lt(treeHeight, 21) {
                    // Handle tree height seventeen and eighteen.
                    if lt(treeHeight, 19) {
                        // Utilize branchless logic to determine typehash.
                        typeHash := ternary(
                            eq(treeHeight, 17),
                            BulkOrder_Typehash_Height_Seventeen,
                            BulkOrder_Typehash_Height_Eighteen
                        )

                        // Exit the function once typehash has been located.
                        leave
                    }

                    // Handle height nineteen and twenty via branchless logic.
                    typeHash := ternary(
                        eq(treeHeight, 19),
                        BulkOrder_Typehash_Height_Nineteen,
                        BulkOrder_Typehash_Height_Twenty
                    )

                    // Exit the function once typehash has been located.
                    leave
                }

                // Handle tree height twenty-one and twenty-two.
                if lt(treeHeight, 23) {
                    // Utilize branchless logic to determine typehash.
                    typeHash := ternary(
                        eq(treeHeight, 21),
                        BulkOrder_Typehash_Height_TwentyOne,
                        BulkOrder_Typehash_Height_TwentyTwo
                    )

                    // Exit the function once typehash has been located.
                    leave
                }

                // Handle height twenty-three & twenty-four w/ branchless logic.
                typeHash := ternary(
                    eq(treeHeight, 23),
                    BulkOrder_Typehash_Height_TwentyThree,
                    BulkOrder_Typehash_Height_TwentyFour
                )

                // Exit the function once typehash has been located.
                leave
            }

            // Implement ternary conditional using branchless logic.
            function ternary(cond, ifTrue, ifFalse) -> c {
                c := xor(ifFalse, mul(cond, xor(ifFalse, ifTrue)))
            }

            // Look up the typehash using the supplied tree height.
            _typeHash := lookupTypeHash(_treeHeight)
        }
    }

    /**
     * @dev Internal view function to ensure that the current time falls within
     *      an order's valid timespan.
     *
     * @param startTime       The time at which the order becomes active.
     * @param endTime         The time at which the order becomes inactive.
     * @param revertOnInvalid A boolean indicating whether to revert if the
     *                        order is not active.
     *
     * @return valid A boolean indicating whether the order is active.
     */
    function _verifyTime(uint256 startTime, uint256 endTime, bool revertOnInvalid) internal view returns (bool valid) {
        // Mark as valid if order has started and has not already ended.
        assembly {
            valid := and(iszero(gt(startTime, timestamp())), gt(endTime, timestamp()))
        }

        // Only revert on invalid if revertOnInvalid has been supplied as true.
        if (revertOnInvalid && !valid) {
            _revertInvalidTime(startTime, endTime);
        }
    }

    /**
     * @dev Internal view function to verify the signature of an order. An
     *      ERC-1271 fallback will be attempted if either the signature length
     *      is not 64 or 65 bytes or if the recovered signer does not match the
     *      supplied offerer. Note that in cases where a 64 or 65 byte signature
     *      is supplied, only standard ECDSA signatures that recover to a
     *      non-zero address are supported.
     *
     * @param offerer   The offerer for the order.
     * @param orderHash The order hash.
     * @param signature A signature from the offerer indicating that the order
     *                  has been approved.
     */
    function _verifySignature(address offerer, bytes32 orderHash, bytes memory signature) internal view {
        // Determine whether the offerer is the caller.
        bool offererIsCaller;
        assembly {
            offererIsCaller := eq(offerer, caller())
        }

        // Skip signature verification if the offerer is the caller.
        if (offererIsCaller) {
            return;
        }

        // Derive the EIP-712 domain separator.
        bytes32 domainSeparator = _domainSeparator();

        // Derive original EIP-712 digest using domain separator and order hash.
        bytes32 originalDigest = _deriveEIP712Digest(domainSeparator, orderHash);

        // Read the length of the signature from memory and place on the stack.
        uint256 originalSignatureLength = signature.length;

        // Determine effective digest if signature has a valid bulk order size.
        bytes32 digest;
        if (_isValidBulkOrderSize(originalSignatureLength)) {
            // Rederive order hash and digest using bulk order proof.
            (orderHash) = _computeBulkOrderProof(signature, orderHash);
            digest = _deriveEIP712Digest(domainSeparator, orderHash);
        } else {
            // Supply the original digest as the effective digest.
            digest = originalDigest;
        }

        // Ensure that the signature for the digest is valid for the offerer.
        _assertValidSignature(offerer, digest, originalDigest, originalSignatureLength, signature);
    }

    /**
     * @dev Internal pure function to efficiently derive an digest to sign for
     *      an order in accordance with EIP-712.
     *
     * @param domainSeparator The domain separator.
     * @param orderHash       The order hash.
     *
     * @return value The hash.
     */
    function _deriveEIP712Digest(bytes32 domainSeparator, bytes32 orderHash) internal pure returns (bytes32 value) {
        // Leverage scratch space to perform an efficient hash.
        assembly {
            // Place the EIP-712 prefix at the start of scratch space.
            mstore(0, EIP_712_PREFIX)

            // Place the domain separator in the next region of scratch space.
            mstore(EIP712_DomainSeparator_offset, domainSeparator)

            // Place the order hash in scratch space, spilling into the first
            // two bytes of the free memory pointer — this should never be set
            // as memory cannot be expanded to that size, and will be zeroed out
            // after the hash is performed.
            mstore(EIP712_OrderHash_offset, orderHash)

            // Hash the relevant region (65 bytes).
            value := keccak256(0, EIP712_DigestPayload_size)

            // Clear out the dirtied bits in the memory pointer.
            mstore(EIP712_OrderHash_offset, 0)
        }
    }

    /**
     * @dev Internal view function to get the EIP-712 domain separator. If the
     *      chainId matches the chainId set on deployment, the cached domain
     *      separator will be returned; otherwise, it will be derived from
     *      scratch.
     *
     * @return The domain separator.
     */
    function _domainSeparator() internal view returns (bytes32) {
        return block.chainid == _CHAIN_ID ? _DOMAIN_SEPARATOR : _deriveDomainSeparator();
    }

    /**
     * @dev Determines whether the specified bulk order size is valid.
     *
     * @param signatureLength The signature length of the bulk order to check.
     *
     * @return validLength True if bulk order size is valid, false otherwise.
     */
    function _isValidBulkOrderSize(uint256 signatureLength) internal pure returns (bool validLength) {
        // Utilize assembly to validate the length; the equivalent logic is
        // (64 + x) + 3 + 32y where (0 <= x <= 1) and (1 <= y <= 24).
        assembly {
            validLength := and(
                lt(sub(signatureLength, BulkOrderProof_minSize), BulkOrderProof_rangeSize),
                lt(
                    and(add(signatureLength, BulkOrderProof_lengthAdjustmentBeforeMask), ThirtyOneBytes),
                    BulkOrderProof_lengthRangeAfterMask
                )
            )
        }
    }

    /**
     * @dev Computes the bulk order hash for the specified proof and leaf. Note
     *      that if an index that exceeds the number of orders in the bulk order
     *      payload will instead "wrap around" and refer to an earlier index.
     *
     * @param proofAndSignature The proof and signature of the bulk order.
     * @param leaf              The leaf of the bulk order tree.
     *
     * @return bulkOrderHash The bulk order hash.
     */
    function _computeBulkOrderProof(
        bytes memory proofAndSignature,
        bytes32 leaf
    ) internal pure returns (bytes32 bulkOrderHash) {
        // Declare arguments for the root hash and the height of the proof.
        bytes32 root;
        uint256 height;

        // Utilize assembly to efficiently derive the root hash using the proof.
        assembly {
            // Retrieve the length of the proof, key, and signature combined.
            let fullLength := mload(proofAndSignature)

            // If proofAndSignature has odd length, it is a compact signature
            // with 64 bytes.
            let signatureLength := sub(ECDSA_MaxLength, and(fullLength, 1))

            // Derive height (or depth of tree) with signature and proof length.
            height := shr(OneWordShift, sub(fullLength, signatureLength))

            // Update the length in memory to only include the signature.
            mstore(proofAndSignature, signatureLength)

            // Derive the pointer for the key using the signature length.
            let keyPtr := add(proofAndSignature, add(OneWord, signatureLength))

            // Retrieve the three-byte key using the derived pointer.
            let key := shr(BulkOrderProof_keyShift, mload(keyPtr))

            /// Retrieve pointer to first proof element by applying a constant
            // for the key size to the derived key pointer.
            let proof := add(keyPtr, BulkOrderProof_keySize)

            // Compute level 1.
            let scratchPtr1 := shl(OneWordShift, and(key, 1))
            mstore(scratchPtr1, leaf)
            mstore(xor(scratchPtr1, OneWord), mload(proof))

            // Compute remaining proofs.
            for {
                let i := 1
            } lt(i, height) {
                i := add(i, 1)
            } {
                proof := add(proof, OneWord)
                let scratchPtr := shl(OneWordShift, and(shr(i, key), 1))
                mstore(scratchPtr, keccak256(0, TwoWords))
                mstore(xor(scratchPtr, OneWord), mload(proof))
            }

            // Compute root hash.
            root := keccak256(0, TwoWords)
        }

        // Retrieve appropriate typehash constant based on height.
        bytes32 rootTypeHash = _lookupBulkOrderTypehash(height);

        // Use the typehash and the root hash to derive final bulk order hash.
        assembly {
            mstore(0, rootTypeHash)
            mstore(OneWord, root)
            bulkOrderHash := keccak256(0, TwoWords)
        }
    }

    /**
     * @dev Internal view function to validate that a given order is fillable
     *      and not cancelled based on the order status.
     *
     * @param orderHash       The order hash.
     * @param orderStatus     The status of the order, including whether it has
     *                        been cancelled and the fraction filled.
     * @param onlyAllowUnused A boolean flag indicating whether partial fills
     *                        are supported by the calling function.
     * @param revertOnInvalid A boolean indicating whether to revert if the
     *                        order has been cancelled or filled beyond the
     *                        allowable amount.
     *
     * @return valid A boolean indicating whether the order is valid.
     */
    function _verifyOrderStatus(
        bytes32 orderHash,
        OrderStatus storage orderStatus,
        bool onlyAllowUnused,
        bool revertOnInvalid
    ) internal view returns (bool valid) {
        // Ensure that the order has not been cancelled.
        if (orderStatus.isCancelled) {
            // Only revert if revertOnInvalid has been supplied as true.
            if (revertOnInvalid) {
                _revertOrderIsCancelled(orderHash);
            }

            // Return false as the order status is invalid.
            return false;
        }

        // Read order status numerator from storage and place on stack.
        uint256 orderStatusNumerator = orderStatus.numerator;

        // If the order is not entirely unused...
        if (orderStatusNumerator != 0) {
            // ensure the order has not been partially filled when not allowed.
            if (onlyAllowUnused) {
                // Always revert on partial fills when onlyAllowUnused is true.
                _revertOrderPartiallyFilled(orderHash);
            }
            // Otherwise, ensure that order has not been entirely filled.
            else if (orderStatusNumerator >= orderStatus.denominator) {
                // Only revert if revertOnInvalid has been supplied as true.
                if (revertOnInvalid) {
                    _revertOrderAlreadyFilled(orderHash);
                }

                // Return false as the order status is invalid.
                return false;
            }
        }

        // Return true as the order status is valid.
        valid = true;
    }

    /**
     * @dev Internal view function to retrieve configuration information for
     *      this contract.
     *
     * @return The contract version.
     * @return The domain separator for this contract.
     */
    function _information() internal view returns (string memory, bytes32) {
        // Derive the domain separator.
        bytes32 domainSeparator = _domainSeparator();

        // Return the version, domain separator
        assembly {
            mstore(information_version_offset, information_version_cd_offset)
            mstore(information_domainSeparator_offset, domainSeparator)
            mstore(information_versionLengthPtr, information_versionWithLength)
            return(information_version_offset, information_length)
        }
    }

    /**
     * @dev Internal function to validate an order, determine what portion to
     *      fill, and update its status. The desired fill amount is supplied as
     *      a fraction, as is the returned amount to fill.
     *
     * @param advancedOrder     The order to fulfill as well as the fraction to
     *                          fill. Note that all offer and consideration
     *                          amounts must divide with no remainder in order
     *                          for a partial fill to be valid.
     * @param revertOnInvalid   A boolean indicating whether to revert if the
     *                          order is invalid due to the time or status.
     *
     * @return orderHash      The order hash.
     * @return numerator      A value indicating the portion of the order that
     *                        will be filled.
     * @return denominator    A value indicating the total size of the order.
     */
    function _validateOrderAndUpdateStatus(
        AdvancedOrder memory advancedOrder,
        bool revertOnInvalid
    ) internal returns (bytes32 orderHash, uint120 numerator, uint120 denominator) {
        // Retrieve the parameters for the order.
        OrderParameters memory orderParameters = advancedOrder.parameters;

        // Ensure current timestamp falls between order start time and end time.
        if (!_verifyTime(orderParameters.startTime, orderParameters.endTime, revertOnInvalid)) {
            // Assuming an invalid time and no revert, return zeroed out values.
            return (bytes32(0), 0, 0);
        }

        // Read numerator and denominator from memory and place on the stack.
        // Note that overflowed values are masked.
        assembly {
            numerator := and(mload(add(advancedOrder, AdvancedOrder_numerator_offset)), MaxUint120)

            denominator := and(mload(add(advancedOrder, AdvancedOrder_denominator_offset)), MaxUint120)
        }

        // Declare variable for tracking the validity of the supplied fraction.
        bool invalidFraction;
        // revert on orderType is Contract
        require(orderParameters.orderType != OrderType.CONTRACT, Error_NotSupportContract);

        // Ensure numerator does not exceed denominator and is not zero.
        assembly {
            invalidFraction := or(gt(numerator, denominator), iszero(numerator))
        }

        // Revert if the supplied numerator and denominator are not valid.
        if (invalidFraction) {
            _revertBadFraction();
        }

        // If attempting partial fill (n < d) check order type & ensure support.
        if (_doesNotSupportPartialFills(orderParameters.orderType, numerator, denominator)) {
            // Revert if partial fill was attempted on an unsupported order.
            _revertPartialFillsNotEnabledForOrder();
        }

        // Retrieve current counter & use it w/ parameters to derive order hash.
        orderHash = _assertConsiderationLengthAndGetOrderHash(orderParameters);

        _checkLasmMatchStatusExist(orderHash);

        // Retrieve the order status using the derived order hash.
        OrderStatus storage orderStatus = _orderStatus[orderHash];

        // Ensure order is fillable and is not cancelled.
        if (
            // Allow partially used orders to be filled.
            !_verifyOrderStatus(orderHash, orderStatus, false, revertOnInvalid)
        ) {
            // Assuming an invalid order status and no revert, return zero fill.
            return (orderHash, 0, 0);
        }

        // If the order is not already validated, verify the supplied signature.
        if (!orderStatus.isValidated) {
            _verifySignature(orderParameters.offerer, orderHash, advancedOrder.signature);
        }

        // Utilize assembly to determine the fraction to fill and update status.
        assembly {
            let orderStatusSlot := orderStatus.slot
            // Read filled amount as numerator and denominator and put on stack.
            let filledNumerator := sload(orderStatusSlot)
            let filledDenominator := shr(OrderStatus_filledDenominator_offset, filledNumerator)

            // "Loop" until the appropriate fill fraction has been determined.
            for {

            } 1 {

            } {
                // If no portion of the order has been filled yet...
                if iszero(filledDenominator) {
                    // fill the full supplied fraction.
                    filledNumerator := numerator

                    // Exit the "loop" early.
                    break
                }

                // Shift and mask to calculate the current filled numerator.
                filledNumerator := and(shr(OrderStatus_filledNumerator_offset, filledNumerator), MaxUint120)

                // If denominator of 1 supplied, fill entire remaining amount.
                if eq(denominator, 1) {
                    // Set the amount to fill to the remaining amount.
                    numerator := sub(filledDenominator, filledNumerator)

                    // Set the fill size to the current size.
                    denominator := filledDenominator

                    // Set the filled amount to the current size.
                    filledNumerator := filledDenominator

                    // Exit the "loop" early.
                    break
                }

                // If supplied denominator is equal to the current one:
                if eq(denominator, filledDenominator) {
                    // Increment the filled numerator by the new numerator.
                    filledNumerator := add(numerator, filledNumerator)

                    // Once adjusted, if current + supplied numerator exceeds
                    // the denominator:
                    let carry := mul(sub(filledNumerator, denominator), gt(filledNumerator, denominator))

                    // reduce the amount to fill by the excess.
                    numerator := sub(numerator, carry)

                    // Reduce the filled amount by the excess as well.
                    filledNumerator := sub(filledNumerator, carry)

                    // Exit the "loop" early.
                    break
                }

                // Otherwise, if supplied denominator differs from current one:
                // Scale the filled amount up by the supplied size.
                filledNumerator := mul(filledNumerator, denominator)

                // Scale the supplied amount and size up by the current size.
                numerator := mul(numerator, filledDenominator)
                denominator := mul(denominator, filledDenominator)

                // Increment the filled numerator by the new numerator.
                filledNumerator := add(numerator, filledNumerator)

                // Once adjusted, if current + supplied numerator exceeds
                // denominator:
                let carry := mul(sub(filledNumerator, denominator), gt(filledNumerator, denominator))

                // reduce the amount to fill by the excess.
                numerator := sub(numerator, carry)

                // Reduce the filled amount by the excess as well.
                filledNumerator := sub(filledNumerator, carry)

                // Check filledNumerator and denominator for uint120 overflow.
                if or(gt(filledNumerator, MaxUint120), gt(denominator, MaxUint120)) {
                    // Derive greatest common divisor using euclidean algorithm.
                    function gcd(_a, _b) -> out {
                        // "Loop" until only one non-zero value remains.
                        for {

                        } _b {

                        } {
                            // Assign the second value to a temporary variable.
                            let _c := _b

                            // Derive the modulus of the two values.
                            _b := mod(_a, _c)

                            // Set the first value to the temporary value.
                            _a := _c
                        }

                        // Return the remaining non-zero value.
                        out := _a
                    }

                    // Determine the amount to scale down the fill fractions.
                    let scaleDown := gcd(numerator, gcd(filledNumerator, denominator))

                    // Ensure that the divisor is at least one.
                    let safeScaleDown := add(scaleDown, iszero(scaleDown))

                    // Scale all fractional values down by gcd.
                    numerator := div(numerator, safeScaleDown)
                    filledNumerator := div(filledNumerator, safeScaleDown)
                    denominator := div(denominator, safeScaleDown)

                    // Perform the overflow check a second time.
                    if or(gt(filledNumerator, MaxUint120), gt(denominator, MaxUint120)) {
                        // Store the Panic error signature.
                        mstore(0, Panic_error_selector)
                        // Store the arithmetic (0x11) panic code.
                        mstore(Panic_error_code_ptr, Panic_arithmetic)

                        // revert(abi.encodeWithSignature(
                        //     "Panic(uint256)", 0x11
                        // ))
                        revert(Error_selector_offset, Panic_error_length)
                    }
                }

                // Exit the "loop" now that all evaluation is complete.
                break
            }

            // Update order status and fill amount, packing struct values.
            // [denominator: 15 bytes] [numerator: 15 bytes]
            // [isCancelled: 1 byte] [isValidated: 1 byte]
            sstore(
                orderStatusSlot,
                or(
                    OrderStatus_ValidatedAndNotCancelled,
                    or(
                        shl(OrderStatus_filledNumerator_offset, filledNumerator),
                        shl(OrderStatus_filledDenominator_offset, denominator)
                    )
                )
            )
        }
    }

    /**
     * @dev Internal view function to ensure that the supplied consideration
     *      array length on a given set of order parameters is not less than the
     *      original consideration array length for that order and to retrieve
     *      the current counter for a given order's offerer and zone and use it
     *      to derive the order hash.
     *
     * @param orderParameters The parameters of the order to hash.
     *
     * @return The hash.
     */
    function _assertConsiderationLengthAndGetOrderHash(
        OrderParameters memory orderParameters
    ) internal view returns (bytes32) {
        // Ensure supplied consideration array length is not less than original.
        _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(
            orderParameters.consideration.length,
            orderParameters.totalOriginalConsiderationItems
        );

        // Derive and return order hash using current counter for the offerer.
        return _deriveOrderHash(orderParameters, _getCounter(orderParameters.offerer));
    }

    /**
     * @dev Internal pure function to ensure that the supplied consideration
     *      array length for an order to be fulfilled is not less than the
     *      original consideration array length for that order.
     *
     * @param suppliedConsiderationItemTotal The number of consideration items
     *                                       supplied when fulfilling the order.
     * @param originalConsiderationItemTotal The number of consideration items
     *                                       supplied on initial order creation.
     */
    function _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(
        uint256 suppliedConsiderationItemTotal,
        uint256 originalConsiderationItemTotal
    ) internal pure {
        // Ensure supplied consideration array length is not less than original.
        if (suppliedConsiderationItemTotal < originalConsiderationItemTotal) {
            _revertMissingOriginalConsiderationItems();
        }
    }

    /**
     * @dev Internal view function to derive the order hash for a given order.
     *      Note that only the original consideration items are included in the
     *      order hash, as additional consideration items may be supplied by the
     *      caller.
     *
     * @param orderParameters The parameters of the order to hash.
     * @param counter         The counter of the order to hash.
     *
     * @return orderHash The hash.
     */
    function _deriveOrderHash(
        OrderParameters memory orderParameters,
        uint256 counter
    ) internal view returns (bytes32 orderHash) {
        // Get length of original consideration array and place it on the stack.
        uint256 originalConsiderationLength = (orderParameters.totalOriginalConsiderationItems);

        /*
         * Memory layout for an array of structs (dynamic or not) is similar
         * to ABI encoding of dynamic types, with a head segment followed by
         * a data segment. The main difference is that the head of an element
         * is a memory pointer rather than an offset.
         */

        // Declare a variable for the derived hash of the offer array.
        bytes32 offerHash;

        // Read offer item EIP-712 typehash from runtime code & place on stack.
        bytes32 typeHash = _OFFER_ITEM_TYPEHASH;

        // Utilize assembly so that memory regions can be reused across hashes.
        assembly {
            // Retrieve the free memory pointer and place on the stack.
            let hashArrPtr := mload(FreeMemoryPointerSlot)

            // Get the pointer to the offers array.
            let offerArrPtr := mload(add(orderParameters, OrderParameters_offer_head_offset))

            // Load the length.
            let offerLength := mload(offerArrPtr)

            // Set the pointer to the first offer's head.
            offerArrPtr := add(offerArrPtr, OneWord)

            // Iterate over the offer items.
            for {
                let i := 0
            } lt(i, offerLength) {
                i := add(i, 1)
            } {
                // Read the pointer to the offer data and subtract one word
                // to get typeHash pointer.
                let ptr := sub(mload(offerArrPtr), OneWord)

                // Read the current value before the offer data.
                let value := mload(ptr)

                // Write the type hash to the previous word.
                mstore(ptr, typeHash)

                // Take the EIP712 hash and store it in the hash array.
                mstore(hashArrPtr, keccak256(ptr, EIP712_OfferItem_size))

                // Restore the previous word.
                mstore(ptr, value)

                // Increment the array pointers by one word.
                offerArrPtr := add(offerArrPtr, OneWord)
                hashArrPtr := add(hashArrPtr, OneWord)
            }

            // Derive the offer hash using the hashes of each item.
            offerHash := keccak256(mload(FreeMemoryPointerSlot), shl(OneWordShift, offerLength))
        }

        // Declare a variable for the derived hash of the consideration array.
        bytes32 considerationHash;

        // Read consideration item typehash from runtime code & place on stack.
        typeHash = _CONSIDERATION_ITEM_TYPEHASH;

        // Utilize assembly so that memory regions can be reused across hashes.
        assembly {
            // Retrieve the free memory pointer and place on the stack.
            let hashArrPtr := mload(FreeMemoryPointerSlot)

            // Get the pointer to the consideration array.
            let considerationArrPtr := add(
                mload(add(orderParameters, OrderParameters_consideration_head_offset)),
                OneWord
            )

            // Iterate over the consideration items (not including tips).
            for {
                let i := 0
            } lt(i, originalConsiderationLength) {
                i := add(i, 1)
            } {
                // Read the pointer to the consideration data and subtract one
                // word to get typeHash pointer.
                let ptr := sub(mload(considerationArrPtr), OneWord)

                // Read the current value before the consideration data.
                let value := mload(ptr)

                // Write the type hash to the previous word.
                mstore(ptr, typeHash)

                // Take the EIP712 hash and store it in the hash array.
                mstore(hashArrPtr, keccak256(ptr, EIP712_ConsiderationItem_size))

                // Restore the previous word.
                mstore(ptr, value)

                // Increment the array pointers by one word.
                considerationArrPtr := add(considerationArrPtr, OneWord)
                hashArrPtr := add(hashArrPtr, OneWord)
            }

            // Derive the consideration hash using the hashes of each item.
            considerationHash := keccak256(mload(FreeMemoryPointerSlot), shl(OneWordShift, originalConsiderationLength))
        }

        // Read order item EIP-712 typehash from runtime code & place on stack.
        typeHash = _ORDER_TYPEHASH;

        // Utilize assembly to access derived hashes & other arguments directly.
        assembly {
            // Retrieve pointer to the region located just behind parameters.
            let typeHashPtr := sub(orderParameters, OneWord)

            // Store the value at that pointer location to restore later.
            let previousValue := mload(typeHashPtr)

            // Store the order item EIP-712 typehash at the typehash location.
            mstore(typeHashPtr, typeHash)

            // Retrieve the pointer for the offer array head.
            let offerHeadPtr := add(orderParameters, OrderParameters_offer_head_offset)

            // Retrieve the data pointer referenced by the offer head.
            let offerDataPtr := mload(offerHeadPtr)

            // Store the offer hash at the retrieved memory location.
            mstore(offerHeadPtr, offerHash)

            // Retrieve the pointer for the consideration array head.
            let considerationHeadPtr := add(orderParameters, OrderParameters_consideration_head_offset)

            // Retrieve the data pointer referenced by the consideration head.
            let considerationDataPtr := mload(considerationHeadPtr)

            // Store the consideration hash at the retrieved memory location.
            mstore(considerationHeadPtr, considerationHash)

            // Retrieve the pointer for the counter.
            let counterPtr := add(orderParameters, OrderParameters_counter_offset)

            // Store the counter at the retrieved memory location.
            mstore(counterPtr, counter)

            // Derive the order hash using the full range of order parameters.
            orderHash := keccak256(typeHashPtr, EIP712_Order_size)

            // Restore the value previously held at typehash pointer location.
            mstore(typeHashPtr, previousValue)

            // Restore offer data pointer at the offer head pointer location.
            mstore(offerHeadPtr, offerDataPtr)

            // Restore consideration data pointer at the consideration head ptr.
            mstore(considerationHeadPtr, considerationDataPtr)

            // Restore consideration item length at the counter pointer.
            mstore(counterPtr, originalConsiderationLength)
        }
    }

    /**
     * @dev Internal function to cancel an arbitrary number of orders. Note that
     *      only the offerer or the zone of a given order may cancel it. Callers
     *      should ensure that the intended order was cancelled by calling
     *      `getOrderStatus` and confirming that `isCancelled` returns `true`.
     *      Also note that contract orders are not cancellable.
     *
     * @param orders The orders to cancel.
     *
     * @return cancelled A boolean indicating whether the supplied orders were
     *                   successfully cancelled.
     */
    function _cancel(OrderComponents[] calldata orders) internal returns (bool cancelled) {
        // Ensure that the reentrancy guard is not currently set.

        // Declare variables outside of the loop.
        OrderStatus storage orderStatus;

        // Declare a variable for tracking invariants in the loop.
        bool anyInvalidCallerOrContractOrder;

        // Skip overflow check as for loop is indexed starting at zero.
        unchecked {
            // Read length of the orders array from memory and place on stack.
            uint256 totalOrders = orders.length;

            // Iterate over each order.
            for (uint256 i = 0; i < totalOrders; ) {
                // Retrieve the order.
                OrderComponents calldata order = orders[i];

                address offerer = order.offerer;
                address zone = order.zone;
                OrderType orderType = order.orderType;

                assembly {
                    // If caller is neither the offerer nor zone, or a contract
                    // order is present, flag anyInvalidCallerOrContractOrder.
                    anyInvalidCallerOrContractOrder := or(
                        anyInvalidCallerOrContractOrder,
                        // orderType == CONTRACT ||
                        // !(caller == offerer || caller == zone)
                        or(eq(orderType, 4), iszero(or(eq(caller(), offerer), eq(caller(), zone))))
                    )
                }

                bytes32 orderHash = _deriveOrderHash(
                    _toOrderParametersReturnType(_decodeOrderComponentsAsOrderParameters)(order.toCalldataPointer()),
                    order.counter
                );
                // check last match status
                LastMatchStatus memory lms = _lastMatchStatus[orderHash];
                require(lms.numerator == 0, Error_CancelInProgressOrder);
                // Retrieve the order status using the derived order hash.
                orderStatus = _orderStatus[orderHash];

                // Update the order status as not valid and cancelled.
                orderStatus.isValidated = false;
                orderStatus.isCancelled = true;

                // Emit an event signifying that the order has been cancelled.
                emit OrderCancelled(orderHash, offerer, zone);

                // Increment counter inside body of loop for gas efficiency.
                ++i;
            }
        }

        if (anyInvalidCallerOrContractOrder) {
            _revertCannotCancelOrder();
        }

        // Return a boolean indicating that orders were successfully cancelled.
        cancelled = true;
    }

    /**
     * @dev Internal pure function to either revert or return an empty tuple
     *      depending on the value of `revertOnInvalid`.
     *
     * @param revertOnInvalid   Whether to revert on invalid input.
     * @param contractOrderHash The contract order hash.
     *
     * @return orderHash   The order hash.
     * @return numerator   The numerator.
     * @return denominator The denominator.
     */
    function _revertOrReturnEmpty(
        bool revertOnInvalid,
        bytes32 contractOrderHash
    ) internal pure returns (bytes32 orderHash, uint120 numerator, uint120 denominator) {
        if (revertOnInvalid) {
            _revertInvalidContractOrder(contractOrderHash);
        }

        return (contractOrderHash, 0, 0);
    }

    /**
     * @dev Internal pure function to check whether a given order type indicates
     *      that partial fills are not supported (e.g. only "full fills" are
     *      allowed for the order in question).
     *
     * @param orderType   The order type in question.
     * @param numerator   The numerator in question.
     * @param denominator The denominator in question.
     *
     * @return isFullOrder A boolean indicating whether the order type only
     *                     supports full fills.
     */
    function _doesNotSupportPartialFills(
        OrderType orderType,
        uint256 numerator,
        uint256 denominator
    ) internal pure returns (bool isFullOrder) {
        // The "full" order types are even, while "partial" order types are odd.
        // Bitwise and by 1 is equivalent to modulo by 2, but 2 gas cheaper. The
        // check is only necessary if numerator is less than denominator.
        assembly {
            // Equivalent to `uint256(orderType) & 1 == 0`.
            isFullOrder := and(lt(numerator, denominator), iszero(and(orderType, 1)))
        }
    }

    function _getFraction(
        uint256 numerator,
        uint256 denominator,
        uint256 value
    ) internal pure returns (uint256 newValue) {
        // Return value early in cases where the fraction resolves to 1.
        if (numerator == denominator) {
            return value;
        }

        bool failure = false;

        // Ensure fraction can be applied to the value with no remainder. Note
        // that the denominator cannot be zero.
        assembly {
            // Ensure new value contains no remainder via mulmod operator.
            // Credit to @hrkrshnn + @axic for proposing this optimal solution.
            if mulmod(value, numerator, denominator) {
                failure := true
            }
        }

        if (failure) {
            revert("OrderParametersLib: bad fraction");
        }

        // Multiply the numerator by the value and ensure no overflow occurs.
        uint256 valueTimesNumerator = value * numerator;

        // Divide and check for remainder. Note that denominator cannot be zero.
        assembly {
            // Perform division without zero check.
            newValue := div(valueTimesNumerator, denominator)
        }
    }

    /**
     * OfferItem to ReceivedItem
     */
    function _offerToReceived(
        OfferItem memory offer,
        address payable recipient,
        bool useEndAmount
    ) internal pure returns (ReceivedItem memory item) {
        item.itemType = offer.itemType;
        item.token = offer.token;
        item.identifier = offer.identifierOrCriteria;
        item.amount = (useEndAmount ? offer.endAmount : offer.startAmount);
        item.recipient = recipient;
    }

    /**
     * ConsiderationItem to ReceivedItem
     */
    function _considerationToReceived(ConsiderationItem memory cons) internal pure returns (ReceivedItem memory item) {
        item.itemType = cons.itemType;
        item.token = cons.token;
        item.identifier = cons.identifierOrCriteria;
        item.amount = cons.startAmount;
        item.recipient = cons.recipient;
    }
}
