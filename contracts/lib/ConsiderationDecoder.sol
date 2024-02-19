// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {
    AdvancedOrder,
    ConsiderationItem,
    CriteriaResolver,
    Fulfillment,
    FulfillmentComponent,
    OfferItem,
    Order,
    OrderParameters,
    ReceivedItem
} from "./ConsiderationStructs.sol";

import {
    AdvancedOrder_denominator_offset,
    AdvancedOrder_extraData_offset,
    AdvancedOrder_fixed_segment_0,
    AdvancedOrder_head_size,
    AdvancedOrder_numerator_offset,
    AdvancedOrder_signature_offset,
    AdvancedOrderPlusOrderParameters_head_size,
    Common_amount_offset,
    Common_endAmount_offset,
    ConsiderationItem_size_with_length,
    ConsiderationItem_size,
    CriteriaResolver_criteriaProof_offset,
    CriteriaResolver_fixed_segment_0,
    CriteriaResolver_head_size,
    FourWords,
    FreeMemoryPointerSlot,
    Fulfillment_considerationComponents_offset,
    Fulfillment_head_size,
    FulfillmentComponent_mem_tail_size_shift,
    FulfillmentComponent_mem_tail_size,
    OfferItem_size_with_length,
    OfferItem_size,
    OneWord,
    OneWordShift,
    OnlyFullWordMask,
    Order_head_size,
    Order_signature_offset,
    OrderComponents_OrderParameters_common_head_size,
    OrderParameters_consideration_head_offset,
    OrderParameters_head_size,
    OrderParameters_offer_head_offset,
    OrderParameters_totalOriginalConsiderationItems_offset,
    ReceivedItem_recipient_offset,
    ReceivedItem_size,
    ReceivedItem_size_excluding_recipient,
    SpentItem_size_shift,
    SpentItem_size,
    ThirtyOneBytes,
    TwoWords
} from "./ConsiderationConstants.sol";

import { CalldataPointer, malloc, MemoryPointer, OffsetOrLengthMask } from "./PointerLibraries.sol";

contract ConsiderationDecoder {
    /**
     * @dev Takes a bytes array from calldata and copies it into memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the bytes array in
     *                    calldata which contains the length of the array.
     *
     * @return mPtrLength A memory pointer to the start of the bytes array in
     *                    memory which contains the length of the array.
     */
    function _decodeBytes(CalldataPointer cdPtrLength) internal pure returns (MemoryPointer mPtrLength) {
        assembly {
            // Get the current free memory pointer.
            mPtrLength := mload(FreeMemoryPointerSlot)

            // Derive the size of the bytes array, rounding up to nearest word
            // and adding a word for the length field. Note: masking
            // `calldataload(cdPtrLength)` is redundant here.
            let size := add(and(add(calldataload(cdPtrLength), ThirtyOneBytes), OnlyFullWordMask), OneWord)

            // Copy bytes from calldata into memory based on pointers and size.
            calldatacopy(mPtrLength, cdPtrLength, size)

            // Store the masked value in memory. Note: the value of `size` is at
            // least 32, meaning the calldatacopy above will at least write to
            // `[mPtrLength, mPtrLength + 32)`.
            mstore(mPtrLength, and(calldataload(cdPtrLength), OffsetOrLengthMask))

            // Update free memory pointer based on the size of the bytes array.
            mstore(FreeMemoryPointerSlot, add(mPtrLength, size))
        }
    }

    /**
     * @dev Takes an offer array from calldata and copies it into memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the offer array
     *                    in calldata which contains the length of the array.
     *
     * @return mPtrLength A memory pointer to the start of the offer array in
     *                    memory which contains the length of the array.
     */
    function _decodeOffer(CalldataPointer cdPtrLength) internal pure returns (MemoryPointer mPtrLength) {
        assembly {
            // Retrieve length of array, masking to prevent potential overflow.
            let arrLength := and(calldataload(cdPtrLength), OffsetOrLengthMask)

            // Get the current free memory pointer.
            mPtrLength := mload(FreeMemoryPointerSlot)

            // Write the array length to memory.
            mstore(mPtrLength, arrLength)

            // Derive the head by adding one word to the length pointer.
            let mPtrHead := add(mPtrLength, OneWord)

            // Derive the tail by adding one word per element (note that structs
            // are written to memory with an offset per struct element).
            let mPtrTail := add(mPtrHead, shl(OneWordShift, arrLength))

            // Track the next tail, beginning with the initial tail value.
            let mPtrTailNext := mPtrTail

            // Copy all offer array data into memory at the tail pointer.
            calldatacopy(mPtrTail, add(cdPtrLength, OneWord), mul(arrLength, OfferItem_size))

            // Track the next head pointer, starting with initial head value.
            let mPtrHeadNext := mPtrHead

            // Iterate over each head pointer until it reaches the tail.
            for {

            } lt(mPtrHeadNext, mPtrTail) {

            } {
                // Write the next tail pointer to next head pointer in memory.
                mstore(mPtrHeadNext, mPtrTailNext)

                // Increment the next head pointer by one word.
                mPtrHeadNext := add(mPtrHeadNext, OneWord)

                // Increment the next tail pointer by the size of an offer item.
                mPtrTailNext := add(mPtrTailNext, OfferItem_size)
            }

            // Update free memory pointer to allocate memory up to end of tail.
            mstore(FreeMemoryPointerSlot, mPtrTailNext)
        }
    }

    /**
     * @dev Takes a consideration array from calldata and copies it into memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the consideration
     *                    array in calldata which contains the length of the
     *                    array.
     *
     * @return mPtrLength A memory pointer to the start of the consideration
     *                    array in memory which contains the length of the
     *                    array.
     */
    function _decodeConsideration(CalldataPointer cdPtrLength) internal pure returns (MemoryPointer mPtrLength) {
        assembly {
            // Retrieve length of array, masking to prevent potential overflow.
            let arrLength := and(calldataload(cdPtrLength), OffsetOrLengthMask)

            // Get the current free memory pointer.
            mPtrLength := mload(FreeMemoryPointerSlot)

            // Write the array length to memory.
            mstore(mPtrLength, arrLength)

            // Derive the head by adding one word to the length pointer.
            let mPtrHead := add(mPtrLength, OneWord)

            // Derive the tail by adding one word per element (note that structs
            // are written to memory with an offset per struct element).
            let mPtrTail := add(mPtrHead, shl(OneWordShift, arrLength))

            // Track the next tail, beginning with the initial tail value.
            let mPtrTailNext := mPtrTail

            // Copy all consideration array data into memory at tail pointer.
            calldatacopy(mPtrTail, add(cdPtrLength, OneWord), mul(arrLength, ConsiderationItem_size))

            // Track the next head pointer, starting with initial head value.
            let mPtrHeadNext := mPtrHead

            // Iterate over each head pointer until it reaches the tail.
            for {

            } lt(mPtrHeadNext, mPtrTail) {

            } {
                // Write the next tail pointer to next head pointer in memory.
                mstore(mPtrHeadNext, mPtrTailNext)

                // Increment the next head pointer by one word.
                mPtrHeadNext := add(mPtrHeadNext, OneWord)

                // Increment next tail pointer by size of a consideration item.
                mPtrTailNext := add(mPtrTailNext, ConsiderationItem_size)
            }

            // Update free memory pointer to allocate memory up to end of tail.
            mstore(FreeMemoryPointerSlot, mPtrTailNext)
        }
    }

    /**
     * @dev Takes a calldata pointer and memory pointer and copies a referenced
     *      OrderParameters struct and associated offer and consideration data
     *      to memory.
     *
     * @param cdPtr A calldata pointer for the OrderParameters struct.
     * @param mPtr A memory pointer to the OrderParameters struct head.
     */
    function _decodeOrderParametersTo(CalldataPointer cdPtr, MemoryPointer mPtr) internal pure {
        // Copy the full OrderParameters head from calldata to memory.
        cdPtr.copy(mPtr, OrderParameters_head_size);

        // Resolve the offer calldata offset, use that to decode and copy offer
        // from calldata, and write resultant memory offset to head in memory.
        mPtr.offset(OrderParameters_offer_head_offset).write(
            _decodeOffer(cdPtr.pptr(OrderParameters_offer_head_offset))
        );

        // Resolve consideration calldata offset, use that to copy consideration
        // from calldata, and write resultant memory offset to head in memory.
        mPtr.offset(OrderParameters_consideration_head_offset).write(
            _decodeConsideration(cdPtr.pptr(OrderParameters_consideration_head_offset))
        );
    }

    /**
     * @dev Takes a calldata pointer to an AdvancedOrder struct and copies the
     *      decoded struct to memory.
     *
     * @param cdPtr A calldata pointer for the AdvancedOrder struct.
     *
     * @return mPtr A memory pointer to the AdvancedOrder struct head.
     */
    function _decodeAdvancedOrder(CalldataPointer cdPtr) internal pure returns (MemoryPointer mPtr) {
        // Allocate memory for AdvancedOrder head and OrderParameters head.
        mPtr = malloc(AdvancedOrderPlusOrderParameters_head_size);

        // Use numerator + denominator calldata offset to decode and copy
        // from calldata and write resultant memory offset to head in memory.
        cdPtr.offset(AdvancedOrder_numerator_offset).copy(
            mPtr.offset(AdvancedOrder_numerator_offset),
            AdvancedOrder_fixed_segment_0
        );

        // Get pointer to memory immediately after advanced order.
        MemoryPointer mPtrParameters = mPtr.offset(AdvancedOrder_head_size);

        // Write pptr for advanced order parameters to memory.
        mPtr.write(mPtrParameters);

        // Resolve OrderParameters calldata pointer & write to allocated region.
        _decodeOrderParametersTo(cdPtr.pptr(), mPtrParameters);

        // Resolve signature calldata offset, use that to decode and copy from
        // calldata, and write resultant memory offset to head in memory.
        mPtr.offset(AdvancedOrder_signature_offset).write(_decodeBytes(cdPtr.pptr(AdvancedOrder_signature_offset)));

        // Resolve extraData calldata offset, use that to decode and copy from
        // calldata, and write resultant memory offset to head in memory.
        mPtr.offset(AdvancedOrder_extraData_offset).write(_decodeBytes(cdPtr.pptr(AdvancedOrder_extraData_offset)));
    }



    /**
     * @dev Takes an array of fulfillment components from calldata and copies it
     *      into memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the fulfillment
     *                    components array in calldata which contains the length
     *                    of the array.
     *
     * @return mPtrLength A memory pointer to the start of the fulfillment
     *                    components array in memory which contains the length
     *                    of the array.
     */
    function _decodeFulfillmentComponents(
        CalldataPointer cdPtrLength
    ) internal pure returns (MemoryPointer mPtrLength) {
        assembly {
            let arrLength := and(calldataload(cdPtrLength), OffsetOrLengthMask)

            // Get the current free memory pointer.
            mPtrLength := mload(FreeMemoryPointerSlot)

            mstore(mPtrLength, arrLength)
            let mPtrHead := add(mPtrLength, OneWord)
            let mPtrTail := add(mPtrHead, shl(OneWordShift, arrLength))
            let mPtrTailNext := mPtrTail
            calldatacopy(mPtrTail, add(cdPtrLength, OneWord), shl(FulfillmentComponent_mem_tail_size_shift, arrLength))
            let mPtrHeadNext := mPtrHead
            for {

            } lt(mPtrHeadNext, mPtrTail) {

            } {
                mstore(mPtrHeadNext, mPtrTailNext)
                mPtrHeadNext := add(mPtrHeadNext, OneWord)
                mPtrTailNext := add(mPtrTailNext, FulfillmentComponent_mem_tail_size)
            }

            // Update the free memory pointer.
            mstore(FreeMemoryPointerSlot, mPtrTailNext)
        }
    }

    /**
     * @dev Takes an array of advanced orders from calldata and copies it into
     *      memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the advanced orders
     *                    array in calldata which contains the length of the
     *                    array.
     *
     * @return mPtrLength A memory pointer to the start of the advanced orders
     *                    array in memory which contains the length of the
     *                    array.
     */
    function _decodeAdvancedOrders(CalldataPointer cdPtrLength) internal pure returns (MemoryPointer mPtrLength) {
        // Retrieve length of array, masking to prevent potential overflow.
        uint256 arrLength = cdPtrLength.readMaskedUint256();

        unchecked {
            // Derive offset to the tail based on one word per array element.
            uint256 tailOffset = arrLength << OneWordShift;

            // Add one additional word for the length and allocate memory.
            mPtrLength = malloc(tailOffset + OneWord);

            // Write the length of the array to memory.
            mPtrLength.write(arrLength);

            // Advance to first memory & calldata pointers (e.g. after length).
            MemoryPointer mPtrHead = mPtrLength.next();
            CalldataPointer cdPtrHead = cdPtrLength.next();

            // Iterate over each pointer, word by word, until tail is reached.
            for (uint256 offset = 0; offset < tailOffset; offset += OneWord) {
                // Resolve AdvancedOrder calldata offset, use it to decode and
                // copy from calldata, and write resultant memory offset.
                mPtrHead.offset(offset).write(_decodeAdvancedOrder(cdPtrHead.pptr(offset)));
            }
        }
    }

    /**
     * @dev Takes a calldata pointer to a Fulfillment struct and copies the
     *      decoded struct to memory.
     *
     * @param cdPtr A calldata pointer for the Fulfillment struct.
     *
     * @return mPtr A memory pointer to the Fulfillment struct head.
     */
    function _decodeFulfillment(CalldataPointer cdPtr) internal pure returns (MemoryPointer mPtr) {
        // Allocate required memory for the Fulfillment head (the fulfillment
        // components arrays are allocated independently).
        mPtr = malloc(Fulfillment_head_size);

        // Resolve offerComponents calldata offset, use it to decode and copy
        // from calldata, and write resultant memory offset to head in memory.
        mPtr.write(_decodeFulfillmentComponents(cdPtr.pptr()));

        // Resolve considerationComponents calldata offset, use it to decode and
        // copy from calldata, and write resultant memory offset to memory head.
        mPtr.offset(Fulfillment_considerationComponents_offset).write(
            _decodeFulfillmentComponents(cdPtr.pptr(Fulfillment_considerationComponents_offset))
        );
    }

    /**
     * @dev Takes an array of fulfillments from calldata and copies it into
     *      memory.
     *
     * @param cdPtrLength A calldata pointer to the start of the fulfillments
     *                    array in calldata which contains the length of the
     *                    array.
     *
     * @return mPtrLength A memory pointer to the start of the fulfillments
     *                    array in memory which contains the length of the
     *                    array.
     */
    function _decodeFulfillments(CalldataPointer cdPtrLength) internal pure returns (MemoryPointer mPtrLength) {
        // Retrieve length of array, masking to prevent potential overflow.
        uint256 arrLength = cdPtrLength.readMaskedUint256();

        unchecked {
            // Derive offset to the tail based on one word per array element.
            uint256 tailOffset = arrLength << OneWordShift;

            // Add one additional word for the length and allocate memory.
            mPtrLength = malloc(tailOffset + OneWord);

            // Write the length of the array to memory.
            mPtrLength.write(arrLength);

            // Advance to first memory & calldata pointers (e.g. after length).
            MemoryPointer mPtrHead = mPtrLength.next();
            CalldataPointer cdPtrHead = cdPtrLength.next();

            // Iterate over each pointer, word by word, until tail is reached.
            for (uint256 offset = 0; offset < tailOffset; offset += OneWord) {
                // Resolve Fulfillment calldata offset, use it to decode and
                // copy from calldata, and write resultant memory offset.
                mPtrHead.offset(offset).write(_decodeFulfillment(cdPtrHead.pptr(offset)));
            }
        }
    }

    /**
     * @dev Takes a calldata pointer to an OrderComponents struct and copies the
     *      decoded struct to memory as an OrderParameters struct (with the
     *      totalOriginalConsiderationItems value set equal to the length of the
     *      supplied consideration array).
     *
     * @param cdPtr A calldata pointer for the OrderComponents struct.
     *
     * @return mPtr A memory pointer to the OrderParameters struct head.
     */
    function _decodeOrderComponentsAsOrderParameters(CalldataPointer cdPtr) internal pure returns (MemoryPointer mPtr) {
        // Allocate memory for the OrderParameters head.
        mPtr = malloc(OrderParameters_head_size);

        // Copy the full OrderComponents head from calldata to memory.
        cdPtr.copy(mPtr, OrderComponents_OrderParameters_common_head_size);

        // Resolve the offer calldata offset, use that to decode and copy offer
        // from calldata, and write resultant memory offset to head in memory.
        mPtr.offset(OrderParameters_offer_head_offset).write(
            _decodeOffer(cdPtr.pptr(OrderParameters_offer_head_offset))
        );

        // Resolve consideration calldata offset, use that to copy consideration
        // from calldata, and write resultant memory offset to head in memory.
        MemoryPointer consideration = _decodeConsideration(cdPtr.pptr(OrderParameters_consideration_head_offset));
        mPtr.offset(OrderParameters_consideration_head_offset).write(consideration);

        // Write masked consideration length to totalOriginalConsiderationItems.
        mPtr.offset(OrderParameters_totalOriginalConsiderationItems_offset).write(consideration.readUint256());
    }


    /**
     * @dev Converts a function taking a calldata pointer and returning a memory
     *      pointer into a function taking that calldata pointer and returning
     *      an OrderParameters type.
     *
     * @param inFn The input function, taking an arbitrary calldata pointer and
     *             returning an arbitrary memory pointer.
     *
     * @return outFn The output function, taking an arbitrary calldata pointer
     *               and returning an OrderParameters type.
     */
    function _toOrderParametersReturnType(
        function(CalldataPointer) internal pure returns (MemoryPointer) inFn
    ) internal pure returns (function(CalldataPointer) internal pure returns (OrderParameters memory) outFn) {
        assembly {
            outFn := inFn
        }
    }

    /**
     * @dev Converts a function taking a calldata pointer and returning a memory
     *      pointer into a function taking that calldata pointer and returning
     *      a dynamic array of AdvancedOrder types.
     *
     * @param inFn The input function, taking an arbitrary calldata pointer and
     *             returning an arbitrary memory pointer.
     *
     * @return outFn The output function, taking an arbitrary calldata pointer
     *               and returning a dynamic array of AdvancedOrder types.
     */
    function _toAdvancedOrdersReturnType(
        function(CalldataPointer) internal pure returns (MemoryPointer) inFn
    ) internal pure returns (function(CalldataPointer) internal pure returns (AdvancedOrder[] memory) outFn) {
        assembly {
            outFn := inFn
        }
    }

    /**
     * @dev Converts a function taking a calldata pointer and returning a memory
     *      pointer into a function taking that calldata pointer and returning
     *      a dynamic array of Fulfillment types.
     *
     * @param inFn The input function, taking an arbitrary calldata pointer and
     *             returning an arbitrary memory pointer.
     *
     * @return outFn The output function, taking an arbitrary calldata pointer
     *               and returning a dynamic array of Fulfillment types.
     */
    function _toFulfillmentsReturnType(
        function(CalldataPointer) internal pure returns (MemoryPointer) inFn
    ) internal pure returns (function(CalldataPointer) internal pure returns (Fulfillment[] memory) outFn) {
        assembly {
            outFn := inFn
        }
    }
}
