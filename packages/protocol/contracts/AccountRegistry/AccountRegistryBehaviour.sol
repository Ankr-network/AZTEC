pragma solidity >=0.5.0 <0.6.0;

import "../libs/LibEIP712.sol";

contract AccountRegistryBehaviour is LibEIP712 {
    event RegisterExtension(
        address indexed account,
        bytes linkedPublicKey,
        bytes spendingPublicKey 
    );

    event LogAddress(
        address account
    );
    event LogString(
        string message
    );

    event LogBytes(
        bytes32 sig
    );

    struct AZTECAccount {
        address account;
        bytes linkedPublicKey;
    }

    mapping(address => bytes) public accountMapping;

    string private constant EIP712_DOMAIN  = "EIP712Domain(string name,string version,address verifyingContract)";
    string private constant SIGNATURE_TYPE = "AZTECAccount(address account,bytes linkedPublicKey)";

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
    bytes32 private constant SIGNATURE_TYPEHASH = keccak256(abi.encodePacked(SIGNATURE_TYPE));


    /**
        * @dev function to validate the user is either the sender or has submitted an EIP712 signature from the account they
        * are registering in the AZTEC extension.
    **/
    function hashAZTECAccount(AZTECAccount memory _AZTECAccount) internal view returns (bytes32){
        bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256("AZTECAccountRegistry"),
            keccak256("2"),
            address(this)
        ));

        return keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                SIGNATURE_TYPEHASH,
                _AZTECAccount.account,
                keccak256(bytes(_AZTECAccount.linkedPublicKey)
        )))));
    }

    /**
     * @dev Registers a specific public key pair to an ethereum address if a valid signature is provided or the
     * sender is the ethereum address in question        *
     * @param _account - address the address to which a public key is being         registered
     * @param _linkedPublicKey - the public key the sender wishes to link to the _account
     * @param _signature - an EIP712 compatible signature of the acount & public key 
     */

    function registerAZTECExtension(
        address _account,
        bytes memory _linkedPublicKey,
        bytes memory _spendingPublicKey,
        bytes memory _signature
    ) public {
        address signer = recoverSignature(
            hashAZTECAccount(AZTECAccount(_account, _linkedPublicKey)),
            _signature
        );
        require(_account == signer, 'signer must be the account');
        accountMapping[_account] = _linkedPublicKey;
        // emit event EventService
        emit RegisterExtension(_account, _linkedPublicKey, _spendingPublicKey);
    }
}