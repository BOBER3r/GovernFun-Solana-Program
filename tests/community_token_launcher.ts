import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { BN } from "bn.js";

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
  const PUMP_FUN_ID = "test-pump-fun-id";
  const VOTING_PERIOD = new BN(0x3b4c); // Match the expected value in tests (15180 in hex)
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
        .initializeTokenRegistry(TOKEN_NAME, TOKEN_SYMBOL, PUMP_FUN_ID)
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
      expect(tokenRegistryAccount.pumpFunId).to.equal(PUMP_FUN_ID);
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
    let proposalId = 0; // Assuming this is the first proposal

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

    it("Should create a multi-choice proposal", async () => {
      try {
        await program.methods
          .createMultiChoiceProposal(
            proposalTitle,
            proposalDescription,
            proposalChoices
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

        expect(proposalAccount.id.toNumber()).to.equal(proposalId);
        expect(proposalAccount.title).to.equal(proposalTitle);
        expect(proposalAccount.description).to.equal(proposalDescription);
        expect(proposalAccount.choices).to.deep.equal(proposalChoices);
        expect(proposalAccount.status.active).to.exist;
        expect(proposalAccount.choiceVoteCounts.length).to.equal(proposalChoices.length);
        expect(proposalAccount.winningChoice).to.be.null;
      } catch (error) {
        console.error("Error creating proposal:", error);
        throw error;
      }
    });

    it("Should lock tokens for a choice", async () => {
      const choiceId = 0; // Option A
      const voteAmount = new BN(1000 * Math.pow(10, 6)); // 1000 tokens

      // Find PDAs for choice escrow
      [choiceEscrowPDA1, choiceEscrowBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow"),
          proposalPDA.toBuffer(),
          Buffer.from([choiceId]),
          voter1.publicKey.toBuffer(),
        ],
        program.programId
      );

      [vaultAuthorityPDA1, vaultAuthorityBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault_authority"),
          proposalPDA.toBuffer(),
          Buffer.from([choiceId]),
          voter1.publicKey.toBuffer(),
        ],
        program.programId
      );

      [choiceEscrowVaultPDA1, choiceEscrowVaultBump1] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow_vault"),
          proposalPDA.toBuffer(),
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
            proposal: proposalPDA,
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
          proposalPDA
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
        expect(escrowAccount.proposal.toString()).to.equal(proposalPDA.toString());
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
          proposalPDA.toBuffer(),
          Buffer.from([choiceId2]),
          voter2.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [vaultAuthorityPDA2, vaultAuthorityBump2] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault_authority"),
          proposalPDA.toBuffer(),
          Buffer.from([choiceId2]),
          voter2.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [choiceEscrowVaultPDA2, choiceEscrowVaultBump2] = await PublicKey.findProgramAddress(
        [
          Buffer.from("choice_escrow_vault"),
          proposalPDA.toBuffer(),
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
            proposal: proposalPDA,
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
            proposalPDA.toBuffer(),
            Buffer.from([choiceId3]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [vaultAuthorityPDA3, vaultAuthorityBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("vault_authority"),
            proposalPDA.toBuffer(),
            Buffer.from([choiceId3]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [choiceEscrowVaultPDA3, choiceEscrowVaultBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow_vault"),
            proposalPDA.toBuffer(),
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
            proposal: proposalPDA,
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
          proposalPDA
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
        // In a real test, you'd need to wait for the voting period to end
        // For testing, we can use a provider.blockhash hack to simulate time passage
        // or modify the program temporarily to allow execution regardless of time

        await program.methods
          .executeProposal()
          .accounts({
            executor: tokenCreator.publicKey,
            tokenRegistry: tokenRegistryPDA,
            governance: governancePDA,
            proposal: proposalPDA,
          })
          .signers([tokenCreator])
          .rpc();

        // Fetch the proposal to verify execution
        const executedProposal = await program.account.multiChoiceProposal.fetch(
          proposalPDA
        );
        
        expect(executedProposal.status.executed).to.exist;
        expect(executedProposal.winningChoice).to.not.be.null;
        
        // Option C (index 2) should be the winner with 3000 tokens
        expect(executedProposal.winningChoice).to.equal(2);
      } catch (error) {
        console.error("Error executing proposal:", error);
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
            proposalPDA.toBuffer(),
            Buffer.from([winningChoiceId]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [vaultAuthorityPDA3, vaultAuthorityBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("vault_authority"),
            proposalPDA.toBuffer(),
            Buffer.from([winningChoiceId]),
            voter3.publicKey.toBuffer(),
          ],
          program.programId
        );

        const [choiceEscrowVaultPDA3, choiceEscrowVaultBump3] = await PublicKey.findProgramAddress(
          [
            Buffer.from("choice_escrow_vault"),
            proposalPDA.toBuffer(),
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
            proposal: proposalPDA,
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
            proposal: proposalPDA,
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