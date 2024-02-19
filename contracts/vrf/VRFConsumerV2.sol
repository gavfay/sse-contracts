// SPDX-License-Identifier: MIT
// An example of a consumer contract that relies on a subscription for funding.
pragma solidity ^0.8.7;

// import "@chainlink/contracts/src/v0.8/interfaces/LinkTokenInterface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title The VRFConsumerV2 contract
 * @notice A contract that gets random values from Chainlink VRF V2
 */
contract VRFConsumerV2 is VRFConsumerBaseV2, AccessControl {
  VRFCoordinatorV2Interface immutable COORDINATOR;
  // LinkTokenInterface immutable LINKTOKEN;

  // Your subscription ID.
  uint64 immutable s_subscriptionId;

  // The gas lane to use, which specifies the maximum gas price to bump to.
  // For a list of available gas lanes on each network,
  // see https://docs.chain.link/docs/vrf-contracts/#configurations
  bytes32 immutable s_keyHash;

  // Depends on the number of requested values that you want sent to the
  // fulfillRandomWords() function. Storing each word costs about 20,000 gas,
  // so 100,000 is a safe default for this example contract. Test and adjust
  // this limit based on the network that you select, the size of the request,
  // and the processing of the callback request in the fulfillRandomWords()
  // function.
  uint32 internal s_callbackGasLimit = 2000000;

  // The default is 3, but you can set this higher.
  uint16 internal s_requestConfirmations = 1;

  // // For this example, retrieve 2 random values in one request.
  // // Cannot exceed VRFCoordinatorV2.MAX_NUM_WORDS.
  // uint32 public immutable s_numWords = 1;

  uint256[] public s_randomWords;
  uint256 public s_requestId;
  address s_owner;

  uint256 immutable precision = 1000;
  uint256[] public numerators;
  uint256 immutable demonator = 10000;

  bytes32 public constant MARKET = keccak256("MARKET");

  event ReturnedRandomness(uint256 requestId, uint256[] randomWords);

  /**
   * @notice Constructor inherits VRFConsumerBaseV2
   *
   * @param subscriptionId - the subscription ID that this contract uses for funding requests
   * @param vrfCoordinator - coordinator, check https://docs.chain.link/docs/vrf-contracts/#configurations
   * @param keyHash - the gas lane to use, which specifies the maximum gas price to bump to
   */
  constructor(uint64 subscriptionId, address vrfCoordinator, bytes32 keyHash) VRFConsumerBaseV2(vrfCoordinator) {
    COORDINATOR = VRFCoordinatorV2Interface(vrfCoordinator);
    // LINKTOKEN = LinkTokenInterface(link);
    s_keyHash = keyHash;
    s_owner = msg.sender;
    s_subscriptionId = subscriptionId;

    _grantRole(DEFAULT_ADMIN_ROLE, tx.origin);
  }

  function setCallbackGasLimit(uint32 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
    s_callbackGasLimit = limit;
  }

  function setConfirms(uint16 confirms) external onlyRole(DEFAULT_ADMIN_ROLE) {
    s_requestConfirmations = confirms;
  }

  /**
   * @notice Requests randomness
   * Assumes the subscription is funded sufficiently; "Words" refers to unit of data in Computer Science
   */
  function requestRandomWords(uint32 s_numWords) external onlyRole(MARKET) returns (uint256) {
    // Will revert if subscription is not set and funded.
    s_requestId = COORDINATOR.requestRandomWords(
      s_keyHash,
      s_subscriptionId,
      s_requestConfirmations,
      s_callbackGasLimit,
      s_numWords
    );
    return s_requestId;
  }

  /**
   * @notice Callback function used by VRF Coordinator
   *
   * @param requestId - id of the request
   * @param randomWords - array of random results from VRF Coordinator
   */
  function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
    s_randomWords = randomWords;
    emit ReturnedRandomness(requestId, randomWords);
  }
}
