/* eslint-disable prefer-destructuring */
/* global artifacts, expect, contract, beforeEach, it, web3:true */
const { encoder, JoinSplitProof, note } = require('aztec.js');
const { constants, proofs } = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');
const BN = require('bn.js');
const truffleAssert = require('truffle-assertions');

const ACE = artifacts.require('./ACE');
const ERC20BrokenTransferTest = artifacts.require('./ERC20BrokenTransferTest');
const ERC20BrokenTransferFromTest = artifacts.require('./ERC20BrokenTransferFromTest');
const ERC20Mintable = artifacts.require('./ERC20Mintable');
const JoinSplit = artifacts.require('./JoinSplit');

let ace;
const aztecAccount = secp256k1.generateAccount();
const { BOGUS_PROOF, JOIN_SPLIT_PROOF } = proofs;
const canAdjustSupply = false;
const canConvert = true;
let erc20;
let joinSplitValidator;
const scalingFactor = new BN(10);
const tokensTransferred = new BN(100000);

const getNotes = async (inputNoteValues = [], outputNoteValues = []) => {
    const inputNotes = await Promise.all(
        inputNoteValues.map((inputNoteValue) => note.create(aztecAccount.publicKey, inputNoteValue)),
    );
    const outputNotes = await Promise.all(
        outputNoteValues.map((outputNoteValue) => note.create(aztecAccount.publicKey, outputNoteValue)),
    );
    return { inputNotes, outputNotes };
};

contract('NoteRegistry', (accounts) => {
    let confidentialProof;
    let depositProof;
    const depositNoteValues = [20, 20];
    const depositPublicValue = -40;
    const publicOwner = accounts[0];
    const sender = accounts[0];
    let withdrawProof;
    const withdrawNoteValues = [10, 30];
    const withdrawPublicValue = 40;

    beforeEach(async () => {
        ace = await ACE.new({ from: sender });
        await ace.setCommonReferenceString(constants.CRS);
        joinSplitValidator = await JoinSplit.new();
        await ace.setProof(JOIN_SPLIT_PROOF, joinSplitValidator.address);

        erc20 = await ERC20Mintable.new();
        await ace.createNoteRegistry(erc20.address, scalingFactor, canAdjustSupply, canConvert);
        await erc20.mint(sender, scalingFactor.mul(tokensTransferred));
        await erc20.approve(ace.address, scalingFactor.mul(tokensTransferred));

        const { outputNotes: depositOutputNotes } = await getNotes([], depositNoteValues);
        depositProof = new JoinSplitProof([], depositOutputNotes, sender, depositPublicValue, publicOwner);
        const { outputNotes: confidentialOutputNotes } = await getNotes([], withdrawNoteValues);
        confidentialProof = new JoinSplitProof(depositOutputNotes, confidentialOutputNotes, sender, 0, publicOwner);
        withdrawProof = new JoinSplitProof(depositOutputNotes, [], sender, withdrawPublicValue, publicOwner);
    });

    describe('Success States', async () => {
        it('should be able to create a new note registry', async () => {
            const opts = { from: accounts[1] };
            const { receipt } = await ace.createNoteRegistry(erc20.address, scalingFactor, canAdjustSupply, canConvert, opts);
            expect(receipt.status).to.equal(true);
        });

        it('should be able to read a registry from storage', async () => {
            const registry = await ace.getRegistry(sender);
            expect(registry.canAdjustSupply).to.equal(false);
            expect(registry.canConvert).to.equal(true);
            expect(registry.confidentialTotalBurned).to.equal(constants.ZERO_VALUE_NOTE_HASH);
            expect(registry.confidentialTotalMinted).to.equal(constants.ZERO_VALUE_NOTE_HASH);
            expect(registry.linkedToken).to.equal(erc20.address);
            expect(registry.scalingFactor.toString()).to.equal(scalingFactor.toString());
            expect(registry.totalSupply.toString()).to.equal('0');
        });

        it('should be able to read a note from storage', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const result = await ace.getNote(sender, depositProof.outputNotes[0].noteHash);
            const block = await web3.eth.getBlock('latest');
            expect(result.status.toNumber()).to.equal(1);
            expect(result.createdOn.toString()).to.equal(block.timestamp.toString());
            expect(result.destroyedOn.toString()).to.equal('0');
            expect(result.noteOwner).to.equal(depositProof.outputNotes[0].owner);
        });

        it('should put output notes in the registry', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const firstNote = await ace.getNote(sender, depositProof.outputNotes[0].noteHash);
            expect(firstNote.status.toNumber()).to.equal(constants.statuses.NOTE_UNSPENT);
            const secondNote = await ace.getNote(sender, depositProof.outputNotes[1].noteHash);
            expect(secondNote.status.toNumber()).to.equal(constants.statuses.NOTE_UNSPENT);
        });

        it('should deposit from the public erc20 contract ', async () => {
            const previousTokenBalance = await erc20.balanceOf(publicOwner);
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const tokenBalance = await erc20.balanceOf(publicOwner);
            const newBalance = previousTokenBalance.sub(new BN(withdrawPublicValue).mul(scalingFactor));
            expect(tokenBalance.toString()).to.equal(newBalance.toString());
        });

        it('should withdraw to the public erc20 contract ', async () => {
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const previousTokenBalance = await erc20.balanceOf(publicOwner);

            const withdrawProofData = withdrawProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, withdrawProof.hash, withdrawPublicValue, { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, withdrawProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, withdrawProof.eth.output, sender);

            const tokenBalance = await erc20.balanceOf(publicOwner);
            const withdrawnAmount = new BN(withdrawPublicValue);
            const newBalance = previousTokenBalance.add(withdrawnAmount.mul(scalingFactor));
            expect(tokenBalance.toString()).to.equal(newBalance.toString());
        });

        it('should clear input notes from the registry', async () => {
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const firstNote = await ace.getNote(sender, depositProof.outputNotes[0].noteHash);
            expect(firstNote.status.toNumber()).to.equal(constants.statuses.NOTE_UNSPENT);
            const secondNote = await ace.getNote(sender, depositProof.outputNotes[1].noteHash);
            expect(secondNote.status.toNumber()).to.equal(constants.statuses.NOTE_UNSPENT);
        });

        it('should update a note registry by consuming input notes, with negative public value', async () => {
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const confidentialProofData = confidentialProof.encodeABI(joinSplitValidator.address);
            const { receipt: aceReceipt } = await ace.validateProof(JOIN_SPLIT_PROOF, sender, confidentialProofData);
            const { receipt: regReceipt } = await ace.updateNoteRegistry(
                JOIN_SPLIT_PROOF,
                confidentialProof.eth.output,
                sender,
            );

            expect(aceReceipt.status).to.equal(true);
            expect(regReceipt.status).to.equal(true);
        });

        it('should update a note registry by consuming input notes, with positive public value', async () => {
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const confidentialProofData = confidentialProof.encodeABI(joinSplitValidator.address);
            const { receipt: aceReceipt } = await ace.validateProof(JOIN_SPLIT_PROOF, sender, confidentialProofData);
            const { receipt: regReceipt } = await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, confidentialProof.eth.output, sender);

            expect(aceReceipt.status).to.equal(true);
            expect(regReceipt.status).to.equal(true);
        });
    });

    describe('Failure States', async () => {
        it('should fail to read a non-existent note', async () => {
            await truffleAssert.reverts(ace.getNote(accounts[1], depositProof.outputNotes[0].noteHash), 'expected note to exist');
        });

        it('should fail to read a non-existent registry', async () => {
            await truffleAssert.reverts(ace.getRegistry(accounts[1]), 'expected registry to be created');
        });

        it('should fail to create a note registry if sender already owns one', async () => {
            await truffleAssert.reverts(
                ace.createNoteRegistry(erc20.address, scalingFactor, canAdjustSupply, canConvert),
                'address already has a linked note registry',
            );
        });

        it('should fail to create a note registry if linked token address is 0x0', async () => {
            const opts = { from: accounts[1] };
            await truffleAssert.reverts(
                ace.createNoteRegistry(constants.addresses.ZERO_ADDRESS, scalingFactor, canAdjustSupply, canConvert, opts),
                'expected the linked token address to exist',
            );
        });

        it('should fail to public approve tokens if no registry exists for the given address', async () => {
            await truffleAssert.reverts(
                ace.publicApprove(accounts[1], depositProof.hash, Math.abs(depositPublicValue)),
                'note registry does not exist',
            );
        });

        it('should fail to update a note registry if no registry exists for the given address', async () => {
            const opts = { from: accounts[1] };
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender, opts),
                'note registry does not exist for the given address',
            );
        });

        it('should fail to update a note registry if proof output is malformed', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            const malformedProofOutput = `0x${depositProof.eth.output.slice(0x05)}`;
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, malformedProofOutput, sender),
                'ACE has not validated a matching proof',
            );
        });

        it('should fail to update a note registry if proof is not valid', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(BOGUS_PROOF, depositProof.eth.output, sender),
                'ACE has not validated a matching proof',
            );
        });

        it('should fail to update a note registry if proof sender is different', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, accounts[1]),
                'ACE has not validated a matching proof',
            );
        });

        it('should fail to update a note registry is public value is non-zero and conversion is deactivated', async () => {
            const canConvertFlag = false;
            const data = depositProof.encodeABI(joinSplitValidator.address);
            const opts = { from: accounts[1] };
            await ace.createNoteRegistry(erc20.address, scalingFactor, canAdjustSupply, canConvertFlag, opts);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender, opts),
                'asset cannot be converted into public tokens',
            );
        });

        it('should fail to update a note registry if public approval value is insufficient', async () => {
            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(publicOwner, depositProof.hash, Math.abs(depositPublicValue), { from: publicOwner });
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
            await ace.publicApprove(
                sender,
                depositProof.hash,
                35, // approval should be 40
            );
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender),
                'public owner has not validated a transfer of tokens',
            );
        });

        it('should fail to update a note registry if the erc20 transferFrom fails', async () => {
            const opts = { from: accounts[1] };
            const erc20BrokenTransferFromTest = await ERC20BrokenTransferFromTest.new();
            await erc20BrokenTransferFromTest.mint(sender, scalingFactor.mul(tokensTransferred));
            await erc20BrokenTransferFromTest.approve(ace.address, scalingFactor.mul(tokensTransferred));
            await ace.createNoteRegistry(erc20BrokenTransferFromTest.address, scalingFactor, canAdjustSupply, canConvert, opts);

            const data = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(accounts[1], depositProof.hash, Math.abs(depositPublicValue));
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, data, opts);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, accounts[1], opts),
                'you shall not pass',
            );
        });

        it('should fail to update a note registry if the erc20 transfer fails', async () => {
            const opts = { from: accounts[1] };
            const erc20BrokenTransferTest = await ERC20BrokenTransferTest.new();
            await erc20BrokenTransferTest.mint(sender, scalingFactor.mul(tokensTransferred));
            await erc20BrokenTransferTest.mint(accounts[1], scalingFactor.mul(tokensTransferred), opts);
            await erc20BrokenTransferTest.approve(ace.address, scalingFactor.mul(tokensTransferred));
            await erc20BrokenTransferTest.approve(ace.address, scalingFactor.mul(tokensTransferred), opts);
            await ace.createNoteRegistry(erc20BrokenTransferTest.address, scalingFactor, canAdjustSupply, canConvert, opts);

            const testDepositProof = new JoinSplitProof(
                [],
                depositProof.outputNotes,
                accounts[1],
                depositPublicValue,
                accounts[1],
            );
            const testWithdrawProof = new JoinSplitProof(
                withdrawProof.inputNotes,
                [],
                accounts[1],
                withdrawPublicValue,
                accounts[1],
            );

            const depositProofData = testDepositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(accounts[1], testDepositProof.hash, Math.abs(depositPublicValue), opts);
            await ace.validateProof(JOIN_SPLIT_PROOF, accounts[1], depositProofData, opts);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, testDepositProof.eth.output, accounts[1], opts);

            const withdrawProofData = testWithdrawProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(accounts[1], testWithdrawProof.hash, withdrawPublicValue, opts);
            await ace.validateProof(JOIN_SPLIT_PROOF, accounts[1], withdrawProofData, opts);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, testWithdrawProof.eth.output, accounts[1], opts),
                'you shall not pass',
            );
        });

        it('should fail to update a note registry if input notes do not exist in the registry', async () => {
            const confidentialProofData = confidentialProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(sender, confidentialProof.hash, Math.abs(depositPublicValue));
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, confidentialProofData);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, confidentialProof.eth.output, sender),
                'input note status is not UNSPENT',
            );
        });

        it('should fail to update a note registry if output notes already exist in the registry', async () => {
            const depositProofData = depositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(sender, depositProof.hash, Math.abs(depositPublicValue));
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, depositProofData);
            await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, depositProof.eth.output, sender);

            const testDepositProof = new JoinSplitProof([], depositProof.outputNotes, sender, depositPublicValue, sender);
            const testDepositProofData = testDepositProof.encodeABI(joinSplitValidator.address);
            await ace.publicApprove(sender, testDepositProof.hash, Math.abs(depositPublicValue));
            await ace.validateProof(JOIN_SPLIT_PROOF, sender, testDepositProofData);
            await truffleAssert.reverts(
                ace.updateNoteRegistry(JOIN_SPLIT_PROOF, testDepositProof.eth.output, sender),
                'output note exists',
            );
        });
    });
});
