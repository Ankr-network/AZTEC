/* global expect, web3, contract, it:true */
const {
    BurnProof,
    DividendProof,
    JoinSplitProof,
    MintProof,
    note,
    PrivateRangeProof,
    PublicRangeProof,
    signer,
    SwapProof,
} = require('aztec.js');
const bn128 = require('@aztec/bn128');
const { TestFactory } = require('@aztec/contract-artifacts');

const {
    constants: { ERC20_SCALING_FACTOR },
    proofs: { BURN_PROOF, DIVIDEND_PROOF, JOIN_SPLIT_PROOF, SWAP_PROOF, MINT_PROOF, PRIVATE_RANGE_PROOF, PUBLIC_RANGE_PROOF },
} = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');

const BN = require('bn.js');
const { getNotesForAccount, generateFactoryId } = require('../src/utils');
const Setup = require('../src/setup');
const { NUM_TEST_TOKENS } = require('../src/config');


contract.only('AZTEC integration', (accounts) => {
    // let upgradeFactoryId;
    // let upgradeFactoryContract;
    let aztecAccount;
    let ace;
    let dividendValidator;
    let erc20;
    // let factoryContract;
    let joinSplitValidator;
    let joinSplitFluidValidator;
    let privateRangeValidator;
    let publicRangeValidator;
    let swapValidator;
    let zkAsset;
    let firstMintCounterValue;
    let firstMintCounterNote;

    const scalingFactor = ERC20_SCALING_FACTOR;

    // Note: there are two funded accounts:
    // accounts[0]: 0x72FCb708B5cD17ead637A54E0A23AF7779f4a5E9
    // accounts[1]: 
    const publicOwner = accounts[0];
    const sender = accounts[0];
    const opts = { from: sender };

    before(async () => {
        const NETWORK = 'Ropsten';
        const contractsToDeploy = [
            'ACE',
            'Dividend',
            'ERC20Mintable',
            'JoinSplit',
            'JoinSplitFluid',
            'PrivateRange',
            'PublicRange',
            'Swap',
            'ZkAssetAdjustable',
        ];
        const setup = new Setup(contractsToDeploy, NETWORK);

        ({
            ACE: ace,
            Dividend: dividendValidator,
            ERC20Mintable: erc20,
            JoinSplit: joinSplitValidator,
            JoinSplitFluid: joinSplitFluidValidator,
            PrivateRange: privateRangeValidator,
            PublicRange: publicRangeValidator,
            Swap: swapValidator,
            ZkAssetAdjustable: zkAsset,
        } = await setup.getContracts());

        aztecAccount = secp256k1.generateAccount();
        // upgradeFactoryId = generateFactoryId(2, 1, 3);
        // upgradeFactoryContract = await TestFactory.new(ace.address);
        // await ace.setFactory(upgradeFactoryId, upgradeFactoryContract.address, { from: accounts[0] });


        // Fund account with ERC20s, if running low
        const publicOwnerBalance = await erc20.balanceOf(publicOwner);
        if (publicOwnerBalance < NUM_TEST_TOKENS.mul(scalingFactor)) {
            const tokensTransferred = new BN(500);
            await erc20.mint(publicOwner, scalingFactor.mul(tokensTransferred), opts);
            await erc20.approve(ace.address, scalingFactor.mul(tokensTransferred), opts);
        }
    });

    describe('Initialisation', async () => {
        it('should set ace owner to be deployment address', async () => {
            const owner = await ace.owner();
            expect(owner).to.equal(accounts[0]);
        });

        it('should have set ACE common reference string', async () => {
            const aceCRS = await ace.getCommonReferenceString();
            expect(aceCRS).to.deep.equal(bn128.CRS);
        });

        it('should have set ACE proofs', async () => {
            const joinSplitValidatorAddress = await ace.getValidatorAddress(JOIN_SPLIT_PROOF);
            const dividendValidatorAddress = await ace.getValidatorAddress(DIVIDEND_PROOF);
            const privateRangeValidatorAddress = await ace.getValidatorAddress(PRIVATE_RANGE_PROOF);
            const publicRangeValidatorAddress = await ace.getValidatorAddress(PUBLIC_RANGE_PROOF);
            const mintValidatorAddress = await ace.getValidatorAddress(MINT_PROOF);
            const burnValidatorAddress = await ace.getValidatorAddress(BURN_PROOF);
            const swapValidatorAddress = await ace.getValidatorAddress(SWAP_PROOF);

            expect(joinSplitValidatorAddress).to.equal(joinSplitValidator.address);
            expect(dividendValidatorAddress).to.equal(dividendValidator.address);
            expect(privateRangeValidatorAddress).to.equal(privateRangeValidator.address);
            expect(publicRangeValidatorAddress).to.equal(publicRangeValidator.address);
            expect(mintValidatorAddress).to.equal(joinSplitFluidValidator.address);
            expect(burnValidatorAddress).to.equal(joinSplitFluidValidator.address);
            expect(swapValidatorAddress).to.equal(swapValidator.address);
        });

        it('should set zkAsset owner', async () => {
            const zkAssetOwner = await zkAsset.owner();
            expect(zkAssetOwner).to.equal(sender);
        });

        it('should set zkAsset linkedToken', async () => {
            const linkedTokenAddress = await zkAsset.linkedToken();
            expect(linkedTokenAddress).to.equal(erc20.address);
        });
    });

    describe('Key flows', async () => {
        it('should verify a dividend proof', async () => {
            const za = 100;
            const zb = 5;
            const notionalNote = await note.create(aztecAccount.publicKey, 90);
            const residualNote = await note.create(aztecAccount.publicKey, 4);
            const targetNote = await note.create(aztecAccount.publicKey, 50);

            const proof = new DividendProof(notionalNote, residualNote, targetNote, sender, za, zb);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(DIVIDEND_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should verify a private range proof', async () => {
            const originalNote = await note.create(aztecAccount.publicKey, 10);
            const comparisonNote = await note.create(aztecAccount.publicKey, 4);
            const utilityNote = await note.create(aztecAccount.publicKey, 6);

            const proof = new PrivateRangeProof(originalNote, comparisonNote, utilityNote, sender);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(PRIVATE_RANGE_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should verify a public range range proof', async () => {
            const originalNote = await note.create(aztecAccount.publicKey, 50);
            const utilityNote = await note.create(aztecAccount.publicKey, 40);
            const publicComparison = 10;
            const isGreaterOrEqual = true;

            const proof = new PublicRangeProof(originalNote, publicComparison, sender, isGreaterOrEqual, utilityNote);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(PUBLIC_RANGE_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should verify a mint proof', async () => {
            const currentMintCounterNote = await note.create(aztecAccount.publicKey, 0);
            const newMintCounterNote = await note.create(aztecAccount.publicKey, 50);
            const mintedNotes = [await note.create(aztecAccount.publicKey, 45), await note.create(aztecAccount.publicKey, 5)];

            const proof = new MintProof(currentMintCounterNote, newMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(MINT_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should verify a burn proof', async () => {
            const currentBurnCounterNote = await note.create(aztecAccount.publicKey, 0);
            const newBurnCounterNote = await note.create(aztecAccount.publicKey, 50);
            const burnedNotes = [await note.create(aztecAccount.publicKey, 45), await note.create(aztecAccount.publicKey, 5)];

            const proof = new BurnProof(currentBurnCounterNote, newBurnCounterNote, burnedNotes, sender);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(BURN_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should verify a swap proof ', async () => {
            const asks = [10, 20];
            const bids = [10, 20];
            const maker = secp256k1.generateAccount();
            const taker = secp256k1.generateAccount();

            const inputNotes = [
                await note.create(maker.publicKey, bids[0]),
                await note.create(taker.publicKey, bids[1]),
            ];

            const outputNotes = [
                await note.create(maker.publicKey, asks[0]),
                await note.create(taker.publicKey, asks[1]),
            ];

            const proof = new SwapProof(inputNotes, outputNotes, sender);
            const data = proof.encodeABI();
            const { receipt } = await ace.validateProof(SWAP_PROOF, sender, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should perform a confidentialTransfer(), with a deposit proof', async () => {
            // Convert 100 tokens into two output notes
            const depositInputNotes = [];
            const depositInputOwnerAccounts = [];
            const depositOutputNotes = await getNotesForAccount(aztecAccount, [50, 50]);
            const depositPublicValue = 100;
            const publicValue = depositPublicValue * -1;

            const proof = new JoinSplitProof(depositInputNotes, depositOutputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(zkAsset.address);
            const signatures = proof.constructSignatures(zkAsset.address, depositInputOwnerAccounts);

            const balancePreTransfer = await erc20.balanceOf(publicOwner);
            const transferAmountBN = new BN(depositPublicValue);
            const expectedBalancePostTransfer = balancePreTransfer.sub(transferAmountBN.mul(scalingFactor));

            await ace.publicApprove(zkAsset.address, proof.hash, depositPublicValue, { from: publicOwner });

            const { receipt } = await zkAsset.methods['confidentialTransfer(bytes,bytes)'](data, signatures, opts);
            expect(receipt.status).to.equal(true);

            const balancePostTransfer = await erc20.balanceOf(publicOwner, opts);
            expect(balancePostTransfer.toString()).to.equal(expectedBalancePostTransfer.toString());
        });

        it('should perform a confidentialTransfer(), with a withdraw proof', async () => {
            // Convert tokens into notes, then withdraw those notes
            const depositInputNotes = [];
            const depositInputOwnerAccounts = [];
            const depositOutputNotes = await getNotesForAccount(aztecAccount, [50, 50]);
            const depositPublicValue = 100;
            const publicValue = depositPublicValue * -1;

            const depositProof = new JoinSplitProof(depositInputNotes, depositOutputNotes, sender, publicValue, publicOwner);
            const depositData = depositProof.encodeABI(zkAsset.address);
            const signatures = depositProof.constructSignatures(zkAsset.address, depositInputOwnerAccounts);

            await ace.publicApprove(zkAsset.address, depositProof.hash, depositPublicValue, { from: publicOwner });
            await zkAsset.methods['confidentialTransfer(bytes,bytes)'](depositData, signatures, opts);

            const balancePostDeposit = await erc20.balanceOf(publicOwner, opts);

            // withdraw notes into tokens
            const withdrawInputNotes = depositOutputNotes;
            const withdrawInputOwnerAccounts = [aztecAccount, aztecAccount];
            const withdrawOutputNotes = [];
            const withdrawPublicValue = 100;

            const withdrawAmountBN = new BN(withdrawPublicValue);
            const expectedBalancePostWithdraw = balancePostDeposit.add(withdrawAmountBN.mul(scalingFactor));

            const withdrawProof = new JoinSplitProof(
                withdrawInputNotes,
                withdrawOutputNotes,
                sender,
                withdrawPublicValue,
                publicOwner,
            );
            const withdrawData = withdrawProof.encodeABI(zkAsset.address);
            const withdrawSignatures = withdrawProof.constructSignatures(zkAsset.address, withdrawInputOwnerAccounts);

            await zkAsset.methods['confidentialTransfer(bytes,bytes)'](withdrawData, withdrawSignatures, opts);

            const balancePostWithdraw = await erc20.balanceOf(publicOwner, opts);
            expect(balancePostWithdraw.toString()).to.equal(expectedBalancePostWithdraw.toString());
        });

        it('should perform a mint operation', async () => {
            // Mint 3 AZTEC notes, worth a total of 300 tokens
            firstMintCounterValue = 50;
            const mintedNoteValues = [20, 30];

            const zeroMintCounterNote = await note.createZeroValueNote();
            firstMintCounterNote = await note.create(aztecAccount.publicKey, firstMintCounterValue);
            const mintedNotes = await getNotesForAccount(aztecAccount, mintedNoteValues);

            const proof = new MintProof(zeroMintCounterNote, firstMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            const { receipt } = await zkAsset.confidentialMint(MINT_PROOF, data, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should be able to burn minted value', async () => {
            // Mint 3 AZTEC notes, worth a total of 300 tokens
            // Have already performed a mint worth 50 tokens in previous test, so initial counter note
            // is worth 50 - use firstMintCounter
            const secondMintCounterValue = firstMintCounterValue + 100;
            const mintedNoteValues = [80, 20];

            const secondMintCounterNote = await note.create(aztecAccount.publicKey, secondMintCounterValue);
            const mintedNotes = await getNotesForAccount(aztecAccount, mintedNoteValues);

            const proof = new MintProof(firstMintCounterNote, secondMintCounterNote, mintedNotes, sender);
            const data = proof.encodeABI();
            await zkAsset.confidentialMint(MINT_PROOF, data, opts);

            const firstBurnCounter = 100;
            const zeroBurnCounterNote = await note.createZeroValueNote();
            const firstBurnCounterNote = await note.create(aztecAccount.publicKey, firstBurnCounter);
            const burnedNotes = mintedNotes;

            const burnProof = new BurnProof(zeroBurnCounterNote, firstBurnCounterNote, burnedNotes, sender);
            const burnData = burnProof.encodeABI(zkAsset.address);

            const { receipt: burnReceipt } = await zkAsset.confidentialBurn(BURN_PROOF, burnData, opts);
            expect(burnReceipt.status).to.equal(true);
        });

        it('should delegate note spending control using a confidentialApprove() and allow a confidentialTransferFrom()', async () => {
            // Call confidentialApprove() on two notes to approve the zkAsset to spend on user's behalf
            const delegatedAddress = accounts[1];

            const depositInputNotes = [];
            const depositOutputNotes = await getNotesForAccount(aztecAccount, [50, 10]);
            const depositPublicValue = -60;
            const depositInputOwnerAccounts = [];

            const depositProof = new JoinSplitProof(
                depositInputNotes,
                depositOutputNotes,
                sender,
                depositPublicValue,
                publicOwner,
            );
            const depositData = depositProof.encodeABI(zkAsset.address);
            const depositSignatures = depositProof.constructSignatures(zkAsset.address, depositInputOwnerAccounts);

            await ace.publicApprove(zkAsset.address, depositProof.hash, depositPublicValue, opts);

            await zkAsset.methods['confidentialTransfer(bytes,bytes)'](depositData, depositSignatures, opts);

            const transferInputNotes = depositOutputNotes;
            const transferOutputNotes = await getNotesForAccount(aztecAccount, [20, 30]);
            const withdrawalPublicValue = 10;

            const transferProof = new JoinSplitProof(
                transferInputNotes,
                transferOutputNotes,
                delegatedAddress,
                withdrawalPublicValue,
                publicOwner,
            );
            const transferData = transferProof.encodeABI(zkAsset.address);

            const signature1 = signer.signNoteForConfidentialApprove(
                zkAsset.address,
                transferInputNotes[0].noteHash,
                delegatedAddress,
                true,
                aztecAccount.privateKey,
            );

            await zkAsset.confidentialApprove(transferInputNotes[0].noteHash, delegatedAddress, true, signature1, opts);

            const signature2 = signer.signNoteForConfidentialApprove(
                zkAsset.address,
                transferInputNotes[1].noteHash,
                delegatedAddress,
                true,
                aztecAccount.privateKey,
            );

            await zkAsset.confidentialApprove(transferInputNotes[1].noteHash, delegatedAddress, true, signature2, opts);

            await ace.validateProof(JOIN_SPLIT_PROOF, delegatedAddress, transferData, { from: delegatedAddress });
            const { receipt } = await zkAsset.confidentialTransferFrom(JOIN_SPLIT_PROOF, transferProof.eth.output, {
                from: delegatedAddress,
            });
            expect(receipt.status).to.equal(true);
        });

        // it.skip('should perform a note registry upgrade', async () => {
        //     const zkAssetOwner = await zkAsset.owner();

        //     await zkAsset.upgradeRegistryVersion(upgradeFactoryId, { from: zkAssetOwner });
        //     const topic = web3.utils.keccak256('UpgradeNoteRegistry(address,address,address)');

        //     const logs = await new Promise((resolve) => {
        //         web3.eth
        //             .getPastLogs({
        //                 address: ace.address,
        //                 topics: [topic],
        //             })
        //             .then(resolve);
        //     });
        //     expect(logs.length).to.not.equal(0);
        // });
    });
});
