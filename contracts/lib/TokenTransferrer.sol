// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {
  BadReturnValueFromERC20OnTransfer_error_amount_ptr,
  BadReturnValueFromERC20OnTransfer_error_from_ptr,
  BadReturnValueFromERC20OnTransfer_error_length,
  BadReturnValueFromERC20OnTransfer_error_selector,
  BadReturnValueFromERC20OnTransfer_error_to_ptr,
  BadReturnValueFromERC20OnTransfer_error_token_ptr,
  BatchTransfer1155Params_amounts_head_ptr,
  BatchTransfer1155Params_calldata_baseSize,
  BatchTransfer1155Params_data_head_ptr,
  BatchTransfer1155Params_data_length_basePtr,
  BatchTransfer1155Params_ids_head_ptr,
  BatchTransfer1155Params_ids_length_offset,
  BatchTransfer1155Params_ids_length_ptr,
  BatchTransfer1155Params_ptr,
  CostPerWord,
  DefaultFreeMemoryPointer,
  ERC1155_safeBatchTransferFrom_signature,
  ERC1155_safeTransferFrom_amount_ptr,
  ERC1155_safeTransferFrom_data_length_offset,
  ERC1155_safeTransferFrom_data_length_ptr,
  ERC1155_safeTransferFrom_data_offset_ptr,
  ERC1155_safeTransferFrom_from_ptr,
  ERC1155_safeTransferFrom_id_ptr,
  ERC1155_safeTransferFrom_length,
  ERC1155_safeTransferFrom_sig_ptr,
  ERC1155_safeTransferFrom_signature,
  ERC1155_safeTransferFrom_to_ptr,
  ERC1155BatchTransferGenericFailure_error_signature,
  ERC1155BatchTransferGenericFailure_ids_offset,
  ERC1155BatchTransferGenericFailure_token_ptr,
  ERC20_transferFrom_amount_ptr,
  ERC20_transferFrom_from_ptr,
  ERC20_transferFrom_length,
  ERC20_transferFrom_sig_ptr,
  ERC20_transferFrom_signature,
  ERC20_transferFrom_to_ptr,
  ERC721_transferFrom_from_ptr,
  ERC721_transferFrom_id_ptr,
  ERC721_transferFrom_length,
  ERC721_transferFrom_sig_ptr,
  ERC721_transferFrom_signature,
  ERC721_transferFrom_to_ptr,
  ExtraGasBuffer,
  FreeMemoryPointerSlot,
  Generic_error_selector_offset,
  Invalid1155BatchTransferEncoding_length,
  Invalid1155BatchTransferEncoding_ptr,
  Invalid1155BatchTransferEncoding_selector,
  MemoryExpansionCoefficientShift,
  NoContract_error_account_ptr,
  NoContract_error_length,
  NoContract_error_selector,
  OneWord,
  OneWordShift,
  Slot0x80,
  Slot0xA0,
  Slot0xC0,
  ThirtyOneBytes,
  TokenTransferGenericFailure_err_identifier_ptr,
  TokenTransferGenericFailure_error_amount_ptr,
  TokenTransferGenericFailure_error_from_ptr,
  TokenTransferGenericFailure_error_identifier_ptr,
  TokenTransferGenericFailure_error_length,
  TokenTransferGenericFailure_error_selector,
  TokenTransferGenericFailure_error_to_ptr,
  TokenTransferGenericFailure_error_token_ptr,
  TwoWords,
  TwoWordsShift,
  ZeroSlot
} from "./TokenTransferrerConstants.sol";

import { TokenTransferrerErrors } from "./TokenTransferrerErrors.sol";

/**
 * @title TokenTransferrer
 *
 * @custom:coauthor d1ll0n
 * @custom:coauthor transmissions11
 * @notice TokenTransferrer is a library for performing optimized ERC20, ERC721,
 *         ERC1155, and batch ERC1155 transfers. Use great caution when
 *         considering these functions for use in other codebases, as there are
 *         significant side effects and edge cases that need to be thoroughly
 *         understood and carefully addressed.
 */
contract TokenTransferrer is TokenTransferrerErrors {
  /**
   * @dev Internal function to transfer ERC20 tokens from a given originator
   *      to a given recipient. Sufficient approvals must be set on the
   *      contract performing the transfer.
   *
   * @param token      The ERC20 token to transfer.
   * @param from       The originator of the transfer.
   * @param to         The recipient of the transfer.
   * @param amount     The amount to transfer.
   */
  function _performERC20Transfer(address token, address from, address to, uint256 amount) internal {
    // Utilize assembly to perform an optimized ERC20 token transfer.
    assembly {
      // The free memory pointer memory slot will be used when populating
      // call data for the transfer; read the value and restore it later.
      let memPointer := mload(FreeMemoryPointerSlot)

      // Write call data into memory, starting with function selector.
      mstore(ERC20_transferFrom_sig_ptr, ERC20_transferFrom_signature)
      mstore(ERC20_transferFrom_from_ptr, from)
      mstore(ERC20_transferFrom_to_ptr, to)
      mstore(ERC20_transferFrom_amount_ptr, amount)

      // Make call & copy up to 32 bytes of return data to scratch space.
      // Scratch space does not need to be cleared ahead of time, as the
      // subsequent check will ensure that either at least a full word of
      // return data is received (in which case it will be overwritten) or
      // that no data is received (in which case scratch space will be
      // ignored) on a successful call to the given token.
      let callStatus := call(gas(), token, 0, ERC20_transferFrom_sig_ptr, ERC20_transferFrom_length, 0, OneWord)

      // Determine whether transfer was successful using status & result.
      let success := and(
        // Set success to whether the call reverted, if not check it
        // either returned exactly 1 (can't just be non-zero data), or
        // had no return data.
        or(and(eq(mload(0), 1), gt(returndatasize(), 31)), iszero(returndatasize())),
        callStatus
      )

      // Handle cases where either the transfer failed or no data was
      // returned. Group these, as most transfers will succeed with data.
      // Equivalent to `or(iszero(success), iszero(returndatasize()))`
      // but after it's inverted for JUMPI this expression is cheaper.
      if iszero(and(success, iszero(iszero(returndatasize())))) {
        // If the token has no code or the transfer failed: Equivalent
        // to `or(iszero(success), iszero(extcodesize(token)))` but
        // after it's inverted for JUMPI this expression is cheaper.
        if iszero(and(iszero(iszero(extcodesize(token))), success)) {
          // If the transfer failed:
          if iszero(success) {
            // If it was due to a revert:
            if iszero(callStatus) {
              // If it returned a message, bubble it up as long as
              // sufficient gas remains to do so:
              if returndatasize() {
                // Ensure that sufficient gas is available to
                // copy returndata while expanding memory where
                // necessary. Start by computing the word size
                // of returndata and allocated memory. Round up
                // to the nearest full word.
                let returnDataWords := shr(OneWordShift, add(returndatasize(), ThirtyOneBytes))

                // Note: use the free memory pointer in place of
                // msize() to work around a Yul warning that
                // prevents accessing msize directly when the IR
                // pipeline is activated.
                let msizeWords := shr(OneWordShift, memPointer)

                // Next, compute the cost of the returndatacopy.
                let cost := mul(CostPerWord, returnDataWords)

                // Then, compute cost of new memory allocation.
                if gt(returnDataWords, msizeWords) {
                  cost := add(
                    cost,
                    add(
                      mul(sub(returnDataWords, msizeWords), CostPerWord),
                      shr(
                        MemoryExpansionCoefficientShift,
                        sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords))
                      )
                    )
                  )
                }

                // Finally, add a small constant and compare to
                // gas remaining; bubble up the revert data if
                // enough gas is still available.
                if lt(add(cost, ExtraGasBuffer), gas()) {
                  // Copy returndata to memory; overwrite
                  // existing memory.
                  returndatacopy(0, 0, returndatasize())

                  // Revert, specifying memory region with
                  // copied returndata.
                  revert(0, returndatasize())
                }
              }

              // Store left-padded selector with push4, mem[28:32]
              mstore(0, TokenTransferGenericFailure_error_selector)
              mstore(TokenTransferGenericFailure_error_token_ptr, token)
              mstore(TokenTransferGenericFailure_error_from_ptr, from)
              mstore(TokenTransferGenericFailure_error_to_ptr, to)
              mstore(TokenTransferGenericFailure_err_identifier_ptr, 0)
              mstore(TokenTransferGenericFailure_error_amount_ptr, amount)

              // revert(abi.encodeWithSignature(
              //     "TokenTransferGenericFailure(
              //         address,address,address,uint256,uint256
              //     )", token, from, to, identifier, amount
              // ))
              revert(Generic_error_selector_offset, TokenTransferGenericFailure_error_length)
            }

            // Otherwise revert with a message about the token
            // returning false or non-compliant return values.

            // Store left-padded selector with push4, mem[28:32]
            mstore(0, BadReturnValueFromERC20OnTransfer_error_selector)
            mstore(BadReturnValueFromERC20OnTransfer_error_token_ptr, token)
            mstore(BadReturnValueFromERC20OnTransfer_error_from_ptr, from)
            mstore(BadReturnValueFromERC20OnTransfer_error_to_ptr, to)
            mstore(BadReturnValueFromERC20OnTransfer_error_amount_ptr, amount)

            // revert(abi.encodeWithSignature(
            //     "BadReturnValueFromERC20OnTransfer(
            //         address,address,address,uint256
            //     )", token, from, to, amount
            // ))
            revert(Generic_error_selector_offset, BadReturnValueFromERC20OnTransfer_error_length)
          }

          // Otherwise, revert with error about token not having code:
          // Store left-padded selector with push4, mem[28:32]
          mstore(0, NoContract_error_selector)
          mstore(NoContract_error_account_ptr, token)

          // revert(abi.encodeWithSignature(
          //      "NoContract(address)", account
          // ))
          revert(Generic_error_selector_offset, NoContract_error_length)
        }

        // Otherwise, the token just returned no data despite the call
        // having succeeded; no need to optimize for this as it's not
        // technically ERC20 compliant.
      }

      // Restore the original free memory pointer.
      mstore(FreeMemoryPointerSlot, memPointer)

      // Restore the zero slot to zero.
      mstore(ZeroSlot, 0)
    }
  }

  /**
   * @dev Internal function to transfer an ERC721 token from a given
   *      originator to a given recipient. Sufficient approvals must be set on
   *      the contract performing the transfer. Note that this function does
   *      not check whether the receiver can accept the ERC721 token (i.e. it
   *      does not use `safeTransferFrom`).
   *
   * @param token      The ERC721 token to transfer.
   * @param from       The originator of the transfer.
   * @param to         The recipient of the transfer.
   * @param identifier The tokenId to transfer.
   */
  function _performERC721Transfer(address token, address from, address to, uint256 identifier) internal {
    // Utilize assembly to perform an optimized ERC721 token transfer.
    assembly {
      // If the token has no code, revert.
      if iszero(extcodesize(token)) {
        // Store left-padded selector with push4, mem[28:32] = selector
        mstore(0, NoContract_error_selector)
        mstore(NoContract_error_account_ptr, token)

        // revert(abi.encodeWithSignature(
        //     "NoContract(address)", account
        // ))
        revert(Generic_error_selector_offset, NoContract_error_length)
      }

      // The free memory pointer memory slot will be used when populating
      // call data for the transfer; read the value and restore it later.
      let memPointer := mload(FreeMemoryPointerSlot)

      // Write call data to memory starting with function selector.
      mstore(ERC721_transferFrom_sig_ptr, ERC721_transferFrom_signature)
      mstore(ERC721_transferFrom_from_ptr, from)
      mstore(ERC721_transferFrom_to_ptr, to)
      mstore(ERC721_transferFrom_id_ptr, identifier)

      // Perform the call, ignoring return data.
      let success := call(gas(), token, 0, ERC721_transferFrom_sig_ptr, ERC721_transferFrom_length, 0, 0)

      // If the transfer reverted:
      if iszero(success) {
        // If it returned a message, bubble it up as long as sufficient
        // gas remains to do so:
        if returndatasize() {
          // Ensure that sufficient gas is available to copy
          // returndata while expanding memory where necessary. Start
          // by computing word size of returndata & allocated memory.
          // Round up to the nearest full word.
          let returnDataWords := shr(OneWordShift, add(returndatasize(), ThirtyOneBytes))

          // Note: use the free memory pointer in place of msize() to
          // work around a Yul warning that prevents accessing msize
          // directly when the IR pipeline is activated.
          let msizeWords := shr(OneWordShift, memPointer)

          // Next, compute the cost of the returndatacopy.
          let cost := mul(CostPerWord, returnDataWords)

          // Then, compute cost of new memory allocation.
          if gt(returnDataWords, msizeWords) {
            cost := add(
              cost,
              add(
                mul(sub(returnDataWords, msizeWords), CostPerWord),
                shr(
                  MemoryExpansionCoefficientShift,
                  sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords))
                )
              )
            )
          }

          // Finally, add a small constant and compare to gas
          // remaining; bubble up the revert data if enough gas is
          // still available.
          if lt(add(cost, ExtraGasBuffer), gas()) {
            // Copy returndata to memory; overwrite existing memory.
            returndatacopy(0, 0, returndatasize())

            // Revert, giving memory region with copied returndata.
            revert(0, returndatasize())
          }
        }

        // Otherwise revert with a generic error message.
        // Store left-padded selector with push4, mem[28:32] = selector
        mstore(0, TokenTransferGenericFailure_error_selector)
        mstore(TokenTransferGenericFailure_error_token_ptr, token)
        mstore(TokenTransferGenericFailure_error_from_ptr, from)
        mstore(TokenTransferGenericFailure_error_to_ptr, to)
        mstore(TokenTransferGenericFailure_error_identifier_ptr, identifier)
        mstore(TokenTransferGenericFailure_error_amount_ptr, 1)

        // revert(abi.encodeWithSignature(
        //     "TokenTransferGenericFailure(
        //         address,address,address,uint256,uint256
        //     )", token, from, to, identifier, amount
        // ))
        revert(Generic_error_selector_offset, TokenTransferGenericFailure_error_length)
      }

      // Restore the original free memory pointer.
      mstore(FreeMemoryPointerSlot, memPointer)

      // Restore the zero slot to zero.
      mstore(ZeroSlot, 0)
    }
  }

  /**
   * @dev Internal function to transfer ERC1155 tokens from a given
   *      originator to a given recipient. Sufficient approvals must be set on
   *      the contract performing the transfer and contract recipients must
   *      implement the ERC1155TokenReceiver interface to indicate that they
   *      are willing to accept the transfer.
   *
   * @param token      The ERC1155 token to transfer.
   * @param from       The originator of the transfer.
   * @param to         The recipient of the transfer.
   * @param identifier The id to transfer.
   * @param amount     The amount to transfer.
   */
  function _performERC1155Transfer(
    address token,
    address from,
    address to,
    uint256 identifier,
    uint256 amount
  ) internal {
    // Utilize assembly to perform an optimized ERC1155 token transfer.
    assembly {
      // If the token has no code, revert.
      if iszero(extcodesize(token)) {
        // Store left-padded selector with push4, mem[28:32] = selector
        mstore(0, NoContract_error_selector)
        mstore(NoContract_error_account_ptr, token)

        // revert(abi.encodeWithSignature(
        //     "NoContract(address)", account
        // ))
        revert(Generic_error_selector_offset, NoContract_error_length)
      }

      // The following memory slots will be used when populating call data
      // for the transfer; read the values and restore them later.
      let memPointer := mload(FreeMemoryPointerSlot)
      let slot0x80 := mload(Slot0x80)
      let slot0xA0 := mload(Slot0xA0)
      let slot0xC0 := mload(Slot0xC0)

      // Write call data into memory, beginning with function selector.
      mstore(ERC1155_safeTransferFrom_sig_ptr, ERC1155_safeTransferFrom_signature)
      mstore(ERC1155_safeTransferFrom_from_ptr, from)
      mstore(ERC1155_safeTransferFrom_to_ptr, to)
      mstore(ERC1155_safeTransferFrom_id_ptr, identifier)
      mstore(ERC1155_safeTransferFrom_amount_ptr, amount)
      mstore(ERC1155_safeTransferFrom_data_offset_ptr, ERC1155_safeTransferFrom_data_length_offset)
      mstore(ERC1155_safeTransferFrom_data_length_ptr, 0)

      // Perform the call, ignoring return data.
      let success := call(gas(), token, 0, ERC1155_safeTransferFrom_sig_ptr, ERC1155_safeTransferFrom_length, 0, 0)

      // If the transfer reverted:
      if iszero(success) {
        // If it returned a message, bubble it up as long as sufficient
        // gas remains to do so:
        if returndatasize() {
          // Ensure that sufficient gas is available to copy
          // returndata while expanding memory where necessary. Start
          // by computing word size of returndata & allocated memory.
          // Round up to the nearest full word.
          let returnDataWords := shr(OneWordShift, add(returndatasize(), ThirtyOneBytes))

          // Note: use the free memory pointer in place of msize() to
          // work around a Yul warning that prevents accessing msize
          // directly when the IR pipeline is activated.
          let msizeWords := shr(OneWordShift, memPointer)

          // Next, compute the cost of the returndatacopy.
          let cost := mul(CostPerWord, returnDataWords)

          // Then, compute cost of new memory allocation.
          if gt(returnDataWords, msizeWords) {
            cost := add(
              cost,
              add(
                mul(sub(returnDataWords, msizeWords), CostPerWord),
                shr(
                  MemoryExpansionCoefficientShift,
                  sub(mul(returnDataWords, returnDataWords), mul(msizeWords, msizeWords))
                )
              )
            )
          }

          // Finally, add a small constant and compare to gas
          // remaining; bubble up the revert data if enough gas is
          // still available.
          if lt(add(cost, ExtraGasBuffer), gas()) {
            // Copy returndata to memory; overwrite existing memory.
            returndatacopy(0, 0, returndatasize())

            // Revert, giving memory region with copied returndata.
            revert(0, returndatasize())
          }
        }

        // Otherwise revert with a generic error message.

        // Store left-padded selector with push4, mem[28:32] = selector
        mstore(0, TokenTransferGenericFailure_error_selector)
        mstore(TokenTransferGenericFailure_error_token_ptr, token)
        mstore(TokenTransferGenericFailure_error_from_ptr, from)
        mstore(TokenTransferGenericFailure_error_to_ptr, to)
        mstore(TokenTransferGenericFailure_error_identifier_ptr, identifier)
        mstore(TokenTransferGenericFailure_error_amount_ptr, amount)

        // revert(abi.encodeWithSignature(
        //     "TokenTransferGenericFailure(
        //         address,address,address,uint256,uint256
        //     )", token, from, to, identifier, amount
        // ))
        revert(Generic_error_selector_offset, TokenTransferGenericFailure_error_length)
      }

      mstore(Slot0x80, slot0x80) // Restore slot 0x80.
      mstore(Slot0xA0, slot0xA0) // Restore slot 0xA0.
      mstore(Slot0xC0, slot0xC0) // Restore slot 0xC0.

      // Restore the original free memory pointer.
      mstore(FreeMemoryPointerSlot, memPointer)

      // Restore the zero slot to zero.
      mstore(ZeroSlot, 0)
    }
  }
}
