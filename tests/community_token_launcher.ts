import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { BN } from "bn.js";

// Utility function to sleep/wait for a specified time
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("community_token_launcher", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .communityTokenLauncher as Program<CommunityTokenLauncher>;

  // Setup test accounts
  const tokenCreator = Keypair.generate();
  const voter1 = Keypair.generate();
  const voter2 = Keypair.generate();
  const voter3 = Keypair.generate();

  // Test constants
  const TOKEN_NAME = "Community Token";
  const TOKEN_SYMBOL = "CMTY";
  const VOTING_PERIOD = new BN(60); // 60 seconds (1 minute) voting period for testing
  const MIN_VOTE_THRESHOLD = new BN(100); // 100 tokens as threshold
  const PROPOSAL_THRESHOLD = new BN(1000);
  const PROPOSAL_THRESHOLD_PERCENTAGE = 1; // 1%
  const GOVERNANCE_NAME = "Test Governance";

  // Test data
  let tokenMint: PublicKey;
  let tokenRegistryPDA: PublicKey;
  let tokenRegistryBump: number;
  let governancePDA: PublicKey;
  let governanceBump: number;
  let proposalPDA: PublicKey;
  let proposalBump: number;
  let creatorTokenAccount: PublicKey;
  let voter1TokenAccount: PublicKey;
  let voter2TokenAccount: PublicKey;
  let voter3TokenAccount: PublicKey;
  
  // For choice escrow tests
  let choiceEscrowPDA1: PublicKey;
  let choiceEscrowBump1: number;
  let vaultAuthorityPDA1: PublicKey;
  let vaultAuthorityBump1: number;
  let choiceEscrowVaultPDA1: PublicKey;
  let choiceEscrowVaultBump1: number;

  before(async () => {
    // Airdrop SOL to test accounts and await confirmations
    const airdrop1 = await provider.connection.requestAirdrop(
      tokenCreator.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop1, "confirmed");
    
    const airdrop2 = await provider.connection.requestAirdrop(
      voter1.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop2, "confirmed");
    
    const airdrop3 = await provider.connection.requestAirdrop(
      voter2.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop3, "confirmed");
    
    const airdrop4 = await provider.connection.requestAirdrop(
      voter3.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop4, "confirmed");

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      tokenCreator,
      tokenCreator.publicKey,
      null,
      6 // 6 decimals
    );

    // Create token accounts
    creatorTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        tokenCreator,
        tokenMint,
        tokenCreator.publicKey
      )
    ).address;

    voter1TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        tokenCreator,
        tokenMint,
        voter1.publicKey
      )
    ).address;

    voter2TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        tokenCreator,
        tokenMint,
        voter2.publicKey
      )
    ).address;

    voter3TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        tokenCreator,
        tokenMint,
        voter3.publicKey
      )
    ).address;

    // Mint tokens to users
    await mintTo(
      provider.connection,
      tokenCreator,
      tokenMint,
      voter1TokenAccount,
      tokenCreator.publicKey,
      10000 * Math.pow(10, 6) // 10,000 tokens
    );

    await mintTo(
      provider.connection,
      tokenCreator,
      tokenMint,
      voter2TokenAccount,
      tokenCreator.publicKey,
      20000 * Math.pow(10, 6) // 20,000 tokens
    );

    await mintTo(
      provider.connection,
      tokenCreator,
      tokenMint,
      voter3TokenAccount,
      tokenCreator.publicKey,
      30000 * Math.pow(10, 6) // 30,000 tokens
    );

    // Find PDAs
    [tokenRegistryPDA, tokenRegistryBump] = await PublicKey.findProgramAddress(
      [Buffer.from("token_registry"), tokenMint.toBuffer()],
      program.programId
    );

    [governancePDA, governanceBump] = await PublicKey.findProgramAddress(
      [Buffer.from("governance"), tokenMint.toBuffer()],
      program.programId
    );
  });

  describe("Token Registry and Governance Setup", () => {
    it("Should setup token registry", async () => {
      await program.methods
        .initializeTokenRegistry(TOKEN_NAME, TOKEN_SYMBOL)
        .accounts({
          authority: tokenCreator.publicKey,
          tokenMint: tokenMint,
          tokenRegistry: tokenRegistryPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([tokenCreator])
        .rpc();
        
      // Fetch token registry to verify
      const tokenRegistryAccount = await program.account.tokenRegistry.fetch(tokenRegistryPDA);
      expect(tokenRegistryAccount.authority.toString()).to.equal(tokenCreator.publicKey.toString());
      expect(tokenRegistryAccount.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(tokenRegistryAccount.tokenName).to.equal(TOKEN_NAME);
      expect(tokenRegistryAccount.tokenSymbol).to.equal(TOKEN_SYMBOL);
      expect(tokenRegistryAccount.isInitialized).to.be.true;
      expect(tokenRegistryAccount.governanceEnabled).to.be.false;
    });

    it("Should setup governance", async () => {
      await program.methods
        .initializeGovernance(
          VOTING_PERIOD,
          MIN_VOTE_THRESHOLD,
          PROPOSAL_THRESHOLD,
          PROPOSAL_THRESHOLD_PERCENTAGE,
          GOVERNANCE_NAME
        )
        .accounts({
          authority: tokenCreator.publicKey,
          tokenMint: tokenMint,
          tokenRegistry: tokenRegistryPDA,
          governance: governancePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([tokenCreator])
        .rpc();
        
      // Fetch governance to verify
      const governanceAccount = await program.account.governance.fetch(governancePDA);
      expect(governanceAccount.authority.toString()).to.equal(tokenCreator.publicKey.toString());
      expect(governanceAccount.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(governanceAccount.tokenRegistry.toString()).to.equal(tokenRegistryPDA.toString());
      expect(governanceAccount.votingPeriod.toString()).to.equal(VOTING_PERIOD.toString());
      expect(governanceAccount.minVoteThreshold.toNumber()).to.equal(MIN_VOTE_THRESHOLD.toNumber());
      expect(governanceAccount.proposalThreshold.toNumber()).to.equal(PROPOSAL_THRESHOLD.toNumber());
      expect(governanceAccount.proposalThresholdPercentage).to.equal(PROPOSAL_THRESHOLD_PERCENTAGE);
      expect(governanceAccount.name).to.equal(GOVERNANCE_NAME);
      expect(governanceAccount.isActive).to.be.true;
      expect(governanceAccount.proposalCount.toNumber()).to.equal(0);
      
      // Verify that token registry was updated
      const tokenRegistryAccount = await program.account.tokenRegistry.fetch(tokenRegistryPDA);
      expect(tokenRegistryAccount.governanceEnabled).to.be.true;
    });
  });

  describe("Proposals and Voting", () => {
    const proposalTitle = "Test Proposal";
    const proposalDescription = "This is a test proposal description";
    const proposalChoices = ["Option A", "Option B", "Option C"];
    let proposalId = 0; // We'll increment this for each test that creates a new proposal
    let votingProposalId = 0; // The proposal ID specifically for the voting tests
    let votingProposalPDA: PublicKey; // Store the PDA for the proposal we'll use for voting

    beforeEach(async () => {
      // Find proposal PDA before each test
      [proposalPDA, proposalBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("proposal"),
          governancePDA.toBuffer(),
          new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
    });

    it("Should create a multi-choice proposal with default duration", async () => {
      try {
        await program.methods
          .createMultiChoiceProposal(
            proposalTitle,
            proposalDescription,
            proposalChoices,
            null // null for default duration
          )
          .accounts({
            proposer: voter1.publicKey,
            governance: governancePDA,
            tokenRegistry: tokenRegistryPDA,
            tokenMint: tokenMint,
            proposal: proposalPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([voter1])
          .rpc();

        // Fetch the proposal account to verify
        const proposalAccount = await program.account.multiChoiceProposal.fetch(
          proposalPDA
        );

        // Get governance to check default duration
        const governanceAccount = await program.account.governance.fetch(governancePDA);

        expect(proposalAccount.id.toNumber()).to.equal(proposalId);
        expect(proposalAccount.title).to.equal(proposalTitle);
        expect(proposalAccount.description).to.equal(proposalDescription);
        expect(proposalAccount.choices).to.deep.equal(proposalChoices);
        expect(proposalAccount.status.active).to.exist;
        expect(proposalAccount.choiceVoteCounts.length).to.equal(proposalChoices.length);
        expect(proposalAccount.winningChoice).to.be.null;
        
        // Verify that the ends_at is set to created_at + governance voting period
        expect(proposalAccount.endsAt.toString()).to.equal(
          proposalAccount.createdAt.add(governanceAccount.votingPeriod).toString()
        );
        
        // Store this proposal for later voting tests
        votingProposalId = proposalId;
        votingProposalPDA = proposalPDA;
        
        // Increment proposal ID for next test
        proposalId++;
      } catch (error) {
        console.error("Error creating proposal:", error);
        throw error;
      }
    });
    
    it("Should create a multi-choice proposal with custom duration", async () => {
      // No need to increment proposalId as it was already incremented in the previous test
      
      // Find new proposal PDA
      const [customDurationProposalPDA, customDurationProposalBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("proposal"),
          governancePDA.toBuffer(),
          new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      // Custom duration: 2 minutes (120 seconds)
      const customDuration = new BN(120);
      
      try {
        await program.methods
          .createMultiChoiceProposal(
            "Custom Duration Proposal",
            "This proposal has a custom voting period",
            proposalChoices,
            customDuration
          )
          .accounts({
            proposer: voter1.publicKey,
            governance: governancePDA,
            tokenRegistry: tokenRegistryPDA,
            tokenMint: tokenMint,
            proposal: customDurationProposalPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([voter1])
          .rpc();

        // Fetch the proposal account to verify
        const proposalAccount = await program.account.multiChoiceProposal.fetch(
          customDurationProposalPDA
        );

        expect(proposalAccount.id.toNumber()).to.equal(proposalId);
        expect(proposalAccount.status.active).to.exist;
        
        // Verify that the ends_at is set to created_at + custom duration
        expect(proposalAccount.endsAt.toString()).to.equal(
          proposalAccount.createdAt.add(customDuration).toString()
        );
        
        // Increment proposal ID for next test
        proposalId++;
      } catch (error) {
        console.error("Error creating proposal with custom duration:", error);
        throw error;
      }
    });
    
    it("Should reject a multi-choice proposal with too short duration", async () => {
      // No need to increment proposalId as it was already done in previous tests
      
      // Find new proposal PDA
      const [invalidDurationProposalPDA, invalidDurationProposalBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("proposal"),
          governancePDA.toBuffer(),
          new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      // Invalid duration: 30 seconds (less than minimum 60 seconds)
      const invalidDuration = new BN(30);
      
      try {
        await program.methods
          .createMultiChoiceProposal(
            "Invalid Duration Proposal",
            "This proposal has a duration that's too short",
            proposalChoices,
            invalidDuration
          )
          .accounts({
            proposer: voter1.publicKey,
            governance: governancePDA,
            tokenRegistry: tokenRegistryPDA,
            tokenMint: tokenMint,
            proposal: invalidDurationProposalPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([voter1])
          .rpc();
        
        // If we reach here, the test should fail
        expect.fail("Should have rejected proposal with too short duration");
      } catch (error) {
        // Expect the error code to match our custom error
        expect(error.error.errorCode.code).to.equal("VotingDurationTooShort");
      }
    });

    it("Should lock tokens for a choice", async () => {
      const choiceId = 0; // Option A
      const voteAmount = new BN(1000 * Math.pow(10, 6)); // 1000 tokens

      // Find PDAs for choice escrow using the stored voting proposal PDA
      [choiceEscrowPDA1, choiceEscrowBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId]),
          voter1.publicKey.toBuffer(),
        ],
        program.programId
      );

      [vaultAuthorityPDA1, vaultAuthorityBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault_authority"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId]),
          voter1.publicKey.toBuffer(),
        ],
        program.programId
      );

      [choiceEscrowVaultPDA1, choiceEscrowVaultBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow_vault"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId]),
          voter1.publicKey.toBuffer(),
        ],
        program.programId
      );

      try {
        // Get voter1 token balance before voting
        const beforeBalance = await provider.connection.getTokenAccountBalance(
          voter1TokenAccount
        );

        await program.methods
          .lockTokensForChoice(voteAmount, choiceId)
          .accounts({
            voter: voter1.publicKey,
            governance: governancePDA,
            proposal: votingProposalPDA,
            choiceEscrow: choiceEscrowPDA1,
            voterTokenAccount: voter1TokenAccount,
            tokenMint: tokenMint,
            vaultAuthority: vaultAuthorityPDA1,
            choiceEscrowVault: choiceEscrowVaultPDA1,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([voter1])
          .rpc();

        // Get voter1 token balance after voting
        const afterBalance = await provider.connection.getTokenAccountBalance(
          voter1TokenAccount
        );

        // Verify token deduction
        expect(
          parseInt(beforeBalance.value.amount) - parseInt(afterBalance.value.amount)
        ).to.equal(voteAmount.toNumber());

        // Fetch escrow vault balance
        const vaultBalance = await provider.connection.getTokenAccountBalance(
          choiceEscrowVaultPDA1
        );
        expect(parseInt(vaultBalance.value.amount)).to.equal(voteAmount.toNumber());

        // Fetch the proposal to verify vote count update
        const updatedProposal = await program.account.multiChoiceProposal.fetch(
          votingProposalPDA
        );
        expect(updatedProposal.choiceVoteCounts[choiceId].toNumber()).to.equal(
          voteAmount.toNumber()
        );

        // Fetch the choice escrow to verify data
        const escrowAccount = await program.account.choiceEscrow.fetch(
          choiceEscrowPDA1
        );
        expect(escrowAccount.voter.toString()).to.equal(
          voter1.publicKey.toString()
        );
        expect(escrowAccount.proposal.toString()).to.equal(votingProposalPDA.toString());
        expect(escrowAccount.choiceId).to.equal(choiceId);
        expect(escrowAccount.lockedAmount.toNumber()).to.equal(
          voteAmount.toNumber()
        );
      } catch (error) {
        console.error("Error locking tokens:", error);
        throw error;
      }
    });

    it("Should allow multiple voters to vote on different choices", async () => {
      // Voter 2 votes for option B
      const choiceId2 = 1;
      const voteAmount2 = new BN(2000 * Math.pow(10, 6)); // 2000 tokens

      const [choiceEscrowPDA2, choiceEscrowBump2] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId2]),
          voter2.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [vaultAuthorityPDA2, vaultAuthorityBump2] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault_authority"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId2]),
          voter2.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [choiceEscrowVaultPDA2, choiceEscrowVaultBump2] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow_vault"),
          votingProposalPDA.toBuffer(),
          Buffer.from([choiceId2]),
          voter2.publicKey.toBuffer(),
        ],
        program.programId
      );

      try {
        await program.methods
          .lockTokensForChoice(voteAmount2, choiceId2)
          .accounts({
            voter: voter2.publicKey,
            governance: governancePDA,
            proposal: votingProposalPDA,
            choiceEscrow: choiceEscrowPDA2,
            voterTokenAccount: voter2TokenAccount,
            tokenMint: tokenMint,
            vaultAuthority: vaultAuthorityPDA2,
            choiceEscrowVault: choiceEscrowVaultPDA2,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([voter2])
          .rpc();

        // Voter 3 votes for option C
        const choiceId3 = 2;
        const voteAmount3 = new BN(3000 * Math.pow(10, 6)); // 3000 tokens

        const [choiceEscrowPDA3, choiceEscrowBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow"),
            votingProposalPDA.toBuffer(),
            Buffer.from([choiceId3]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [vaultAuthorityPDA3, vaultAuthorityBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("vault_authority"),
            votingProposalPDA.toBuffer(),
            Buffer.from([choiceId3]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [choiceEscrowVaultPDA3, choiceEscrowVaultBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow_vault"),
            votingProposalPDA.toBuffer(),
            Buffer.from([choiceId3]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        await program.methods
          .lockTokensForChoice(voteAmount3, choiceId3)
          .accounts({
            voter: voter3.publicKey,
            governance: governancePDA,
            proposal: votingProposalPDA,
            choiceEscrow: choiceEscrowPDA3,
            voterTokenAccount: voter3TokenAccount,
            tokenMint: tokenMint,
            vaultAuthority: vaultAuthorityPDA3,
            choiceEscrowVault: choiceEscrowVaultPDA3,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([voter3])
          .rpc();

        // Fetch the proposal to verify vote counts
        const updatedProposal = await program.account.multiChoiceProposal.fetch(
          votingProposalPDA
        );
        
        expect(updatedProposal.choiceVoteCounts[0].toNumber()).to.equal(
          1000 * Math.pow(10, 6)
        );
        expect(updatedProposal.choiceVoteCounts[1].toNumber()).to.equal(
          2000 * Math.pow(10, 6)
        );
        expect(updatedProposal.choiceVoteCounts[2].toNumber()).to.equal(
          3000 * Math.pow(10, 6)
        );
      } catch (error) {
        console.error("Error with multiple voters:", error);
        throw error;
      }
    });

    it("Should execute proposal after voting period", async () => {
      try {
        console.log("Waiting for the 1-minute voting period to end...");
        // Wait for the voting period (60 seconds) plus a small buffer
        await sleep(65 * 1000);
        console.log("Voting period should have ended. Executing proposal...");
        
        await program.methods
          .executeProposal()
          .accounts({
            executor: tokenCreator.publicKey,
            tokenRegistry: tokenRegistryPDA,
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .signers([tokenCreator])
          .rpc();

        // Use the getter function to fetch the proposal and verify execution
        await program.methods
          .getProposal(votingProposalId)
          .accounts({
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .rpc();
          
        // Now fetch the proposal data to verify execution
        const executedProposal = await program.account.multiChoiceProposal.fetch(
          votingProposalPDA
        );
        
        expect(executedProposal.status.executed).to.exist;
        expect(executedProposal.winningChoice).to.not.be.null;
        
        // Option C (index 2) should be the winner with 3000 tokens
        expect(executedProposal.winningChoice).to.equal(2);
        
        // Get winning choice using the getter function
        const winningChoiceId = 2;
        await program.methods
          .getChoice(votingProposalId, winningChoiceId)
          .accounts({
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .rpc();
        
        // Verify the choice text
        expect(executedProposal.choices[winningChoiceId]).to.equal("Option C");
        
        console.log("Proposal successfully executed");
          
      } catch (error) {
        console.error("Error executing proposal:", error);
        throw error;
      }
    });
    
    it("Should get proposal data using new getter function", async () => {
      try {
        // Call the new getter function
        const proposalData = await program.methods
          .getProposalData(votingProposalId)
          .accounts({
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .view();
        
        // Verify proposal data
        expect(proposalData.id.toNumber()).to.equal(votingProposalId);
        expect(proposalData.title).to.equal("Test Proposal");
        expect(proposalData.description).to.equal("This is a test proposal description");
        expect(proposalData.choices).to.deep.equal(["Option A", "Option B", "Option C"]);
        expect(proposalData.status.executed).to.exist;
        expect(proposalData.winningChoice).to.equal(2);
        
        // Verify vote counts
        expect(proposalData.choiceVoteCounts[0].toNumber()).to.equal(1000 * Math.pow(10, 6));
        expect(proposalData.choiceVoteCounts[1].toNumber()).to.equal(2000 * Math.pow(10, 6));
        expect(proposalData.choiceVoteCounts[2].toNumber()).to.equal(3000 * Math.pow(10, 6));
        
      } catch (error) {
        console.error("Error getting proposal data:", error);
        throw error;
      }
    });
    
    it("Should get choice data using new getter function", async () => {
      try {
        // Call the new getter function for the winning choice
        const winningChoiceId = 2;
        const winningChoiceData = await program.methods
          .getChoiceData(votingProposalId, winningChoiceId)
          .accounts({
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .view();
        
        // Verify choice data
        expect(winningChoiceData.id).to.equal(winningChoiceId);
        expect(winningChoiceData.name).to.equal("Option C");
        expect(winningChoiceData.voteCount.toNumber()).to.equal(3000 * Math.pow(10, 6));
        expect(winningChoiceData.isWinning).to.be.true;
        
        // Now get a losing choice
        const losingChoiceId = 0;
        const losingChoiceData = await program.methods
          .getChoiceData(votingProposalId, losingChoiceId)
          .accounts({
            governance: governancePDA,
            proposal: votingProposalPDA,
          })
          .view();
          
        // Verify losing choice data
        expect(losingChoiceData.id).to.equal(losingChoiceId);
        expect(losingChoiceData.name).to.equal("Option A");
        expect(losingChoiceData.voteCount.toNumber()).to.equal(1000 * Math.pow(10, 6));
        expect(losingChoiceData.isWinning).to.be.false;
        
      } catch (error) {
        console.error("Error getting choice data:", error);
        throw error;
      }
    });

    it("Should distribute winning escrow to token creator", async () => {
      try {
        // Get token creator balance before distribution
        const beforeBalance = await provider.connection.getTokenAccountBalance(
          creatorTokenAccount
        );

        // Distribute winning escrow (Option C, voter3)
        const winningChoiceId = 2;
        
        const [choiceEscrowPDA3, choiceEscrowBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow"),
            votingProposalPDA.toBuffer(),
            Buffer.from([winningChoiceId]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [vaultAuthorityPDA3, vaultAuthorityBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("vault_authority"),
            votingProposalPDA.toBuffer(),
            Buffer.from([winningChoiceId]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [choiceEscrowVaultPDA3, choiceEscrowVaultBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow_vault"),
            votingProposalPDA.toBuffer(),
            Buffer.from([winningChoiceId]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        await program.methods
          .distributeWinningEscrow()
          .accounts({
            executor: tokenCreator.publicKey,
            governance: governancePDA,
            proposal: votingProposalPDA,
            choiceEscrow: choiceEscrowPDA3,
            vaultAuthority: vaultAuthorityPDA3,
            escrowVault: choiceEscrowVaultPDA3,
            creatorTokenAccount: creatorTokenAccount,
            tokenMint: tokenMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([tokenCreator])
          .rpc();

        // Get token creator balance after distribution
        const afterBalance = await provider.connection.getTokenAccountBalance(
          creatorTokenAccount
        );

        // Verify tokens were distributed (3000 tokens)
        expect(
          parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount)
        ).to.equal(3000 * Math.pow(10, 6));

        // Verify escrow vault is empty
        const vaultBalance = await provider.connection.getTokenAccountBalance(
          choiceEscrowVaultPDA3
        );
        expect(parseInt(vaultBalance.value.amount)).to.equal(0);
      } catch (error) {
        console.error("Error distributing winning escrow:", error);
        throw error;
      }
    });

    it("Should refund losing escrow to voters", async () => {
      try {
        // Get voter1 balance before refund
        const beforeBalance1 = await provider.connection.getTokenAccountBalance(
          voter1TokenAccount
        );

        // Refund losing escrow (Option A, voter1)
        const losingChoiceId1 = 0;
        
        await program.methods
          .refundLosingEscrow()
          .accounts({
            executor: tokenCreator.publicKey,
            governance: governancePDA,
            proposal: votingProposalPDA,
            choiceEscrow: choiceEscrowPDA1,
            vaultAuthority: vaultAuthorityPDA1,
            escrowVault: choiceEscrowVaultPDA1,
            voterTokenAccount: voter1TokenAccount,
            tokenMint: tokenMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([tokenCreator])
          .rpc();

        // Get voter1 balance after refund
        const afterBalance1 = await provider.connection.getTokenAccountBalance(
          voter1TokenAccount
        );

        // Verify tokens were refunded (1000 tokens)
        expect(
          parseInt(afterBalance1.value.amount) - parseInt(beforeBalance1.value.amount)
        ).to.equal(1000 * Math.pow(10, 6));

        // Verify escrow vault is empty
        const vaultBalance1 = await provider.connection.getTokenAccountBalance(
          choiceEscrowVaultPDA1
        );
        expect(parseInt(vaultBalance1.value.amount)).to.equal(0);

        // We could do the same for voter2, but skipping for brevity
      } catch (error) {
        console.error("Error refunding losing escrow:", error);
        throw error;
      }
    });
  });
});