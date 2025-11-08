pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ReliefZama is ZamaEthereumConfig {
    struct ReliefApplication {
        euint32 encryptedLocation;      // Encrypted coordinates
        uint256 publicDisasterType;     // Public disaster category
        uint256 publicUrgencyLevel;     // Public urgency level
        address applicant;              // Applicant address
        uint256 timestamp;              // Application time
        bool isProcessed;               // Processing status flag
        uint32 decryptedLocation;       // Decrypted coordinates
    }

    mapping(string => ReliefApplication) public applications;
    string[] public applicationIds;

    event ApplicationSubmitted(string indexed applicationId, address indexed applicant);
    event ApplicationProcessed(string indexed applicationId, uint32 decryptedLocation);

    constructor() ZamaEthereumConfig() {
        // Initialize contract with Zama configuration
    }

    function submitApplication(
        string calldata applicationId,
        externalEuint32 encryptedLocation,
        bytes calldata locationProof,
        uint256 disasterType,
        uint256 urgencyLevel
    ) external {
        require(bytes(applications[applicationId].applicant).length == 0, "Application already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocation, locationProof)), "Invalid encrypted location");

        applications[applicationId] = ReliefApplication({
            encryptedLocation: FHE.fromExternal(encryptedLocation, locationProof),
            publicDisasterType: disasterType,
            publicUrgencyLevel: urgencyLevel,
            applicant: msg.sender,
            timestamp: block.timestamp,
            isProcessed: false,
            decryptedLocation: 0
        });

        FHE.allowThis(applications[applicationId].encryptedLocation);
        FHE.makePubliclyDecryptable(applications[applicationId].encryptedLocation);

        applicationIds.push(applicationId);
        emit ApplicationSubmitted(applicationId, msg.sender);
    }

    function processApplication(
        string calldata applicationId,
        bytes memory abiEncodedClearLocation,
        bytes memory decryptionProof
    ) external {
        require(bytes(applications[applicationId].applicant).length > 0, "Application does not exist");
        require(!applications[applicationId].isProcessed, "Application already processed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(applications[applicationId].encryptedLocation);

        FHE.checkSignatures(cts, abiEncodedClearLocation, decryptionProof);
        uint32 decodedLocation = abi.decode(abiEncodedClearLocation, (uint32));

        applications[applicationId].decryptedLocation = decodedLocation;
        applications[applicationId].isProcessed = true;

        emit ApplicationProcessed(applicationId, decodedLocation);
    }

    function getEncryptedLocation(string calldata applicationId) external view returns (euint32) {
        require(bytes(applications[applicationId].applicant).length > 0, "Application does not exist");
        return applications[applicationId].encryptedLocation;
    }

    function getApplicationDetails(string calldata applicationId) external view returns (
        uint256 disasterType,
        uint256 urgencyLevel,
        address applicant,
        uint256 timestamp,
        bool isProcessed,
        uint32 decryptedLocation
    ) {
        require(bytes(applications[applicationId].applicant).length > 0, "Application does not exist");
        ReliefApplication storage app = applications[applicationId];

        return (
            app.publicDisasterType,
            app.publicUrgencyLevel,
            app.applicant,
            app.timestamp,
            app.isProcessed,
            app.decryptedLocation
        );
    }

    function getAllApplicationIds() external view returns (string[] memory) {
        return applicationIds;
    }

    function verifyContractStatus() public pure returns (bool) {
        return true;
    }
}

