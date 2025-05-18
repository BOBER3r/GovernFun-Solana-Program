import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import * as borsh from "borsh";

// Constants
const FEE_PERCENTAGE = 1;
const FEE_BASIS_POINTS = 100;
const PROTOCOL_FEE_PERCENTAGE = 70;
const STAKING_REWARDS_PERCENTAGE = 30;

// Helper function to calculate fee
const calculateFee = (amount: number): number => {
  return Math.floor(amount * FEE_PERCENTAGE / FEE_BASIS_POINTS);
};

// Schema for the UpdateSettingsPayload
class UpdateSettingsPayload {
  voting_period_days: anchor.BN;
  min_vote_threshold: anchor.BN;
  proposal_threshold: anchor.BN;
  proposal_threshold_percentage: number;

  constructor(fields: {
    voting_period_days: anchor.BN;
    min_vote_threshold: anchor.BN;
    proposal_threshold: anchor.BN;
    proposal_threshold_percentage: number;
  }) {
    this.voting_period_days = fields.voting_period_days;
    this.min_vote_threshold = fields.min_vote_threshold;
    this.proposal_threshold = fields.proposal_threshold;
    this.proposal_threshold_percentage = fields.proposal_threshold_percentage;
  }
}

// Define the schema for Borsh serialization
const UpdateSettingsPayloadSchema = new Map([
  [
    UpdateSettingsPayload,
    {
      kind: "struct",
      fields: [
        ["voting_period_days", "u64"],
        ["min_vote_threshold", "u64"],
        ["proposal_threshold", "u64"],
        ["proposal_threshold_percentage", "u8"],
      ],
    },
  ],
]);

describe("governance_settings_update", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const tokenCreator = Keypair.generate();
  const voter1 = Keypair.generate();
  const voter2 = Keypair.generate();
  const proposer = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  // PDAs
  let mint: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let stakingPool: PublicKey;
  let stakingVault: PublicKey;
  let stakingVaultAuthority: PublicKey;
  let stakingRewardsVault: PublicKey;
  let stakingRewardsVaultAuthority: PublicKey;
  let proposal: PublicKey;
  let programConfig: PublicKey;

  // Token accounts
  let tokenCreatorTokenAccount: PublicKey;
  let voter1TokenAccount: PublicKey;
  let voter2TokenAccount: PublicKey;
  let proposerTokenAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;

  // Choice escrow accounts
  let voter1ChoiceEscrow: PublicKey;
  let voter1ChoiceEscrowVault: PublicKey;
  let voter1VaultAuthority: PublicKey;
  let voter2ChoiceEscrow: PublicKey;
  let voter2ChoiceEscrowVault: PublicKey;
  let voter2VaultAuthority: PublicKey;

  // Settings
  const initialVotingPeriodDays = 1; // 1 day for testing
  const initialMinVoteThreshold = 50 * 10 ** decimals;
  const initialProposalThreshold = 100 * 10 ** decimals;
  const initialProposalThresholdPercentage = 5;
  const initialGovernanceFee = 20 * 10 ** decimals;

  // New settings for the update
  const newVotingPeriodDays = 3; // 3 days
  const newMinVoteThreshold = 75 * 10 ** decimals;
  const newProposalThreshold = 150 * 10 ** decimals;
  const newProposalThresholdPercentage = 10;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [tokenCreator, voter1, voter2, proposer, feeCollector]) {
      await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create token mint
    mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      decimals
    );
    console.log("Token mint created:", mint.toBase58());

    // Create token accounts
    tokenCreatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      tokenCreator.publicKey
    );
    console.log("Token creator token account:", tokenCreatorTokenAccount.toBase58());

    voter1TokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      voter1.publicKey
    );
    console.log("Voter 1 token account:", voter1TokenAccount.toBase58());

    voter2TokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      voter2.publicKey
    );
    console.log("Voter 2 token account:", voter2TokenAccount.toBase58());

    proposerTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      proposer.publicKey
    );
    console.log("Proposer token account:", proposerTokenAccount.toBase58());

    feeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      feeCollector.publicKey
    );
    console.log("Fee collector token account:", feeCollectorTokenAccount.toBase58());

    // Mint tokens to accounts
    await mintTo(
      connection,
      wallet.payer,
      mint,
      tokenCreatorTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      voter1TokenAccount,
      wallet.payer,
      200 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      voter2TokenAccount,
      wallet.payer,
      200 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      proposerTokenAccount,
      wallet.payer,
      200 * 10 ** decimals
    );

    // Find PDAs
    const programConfigResult = await getPda(
      [Buffer.from("program_config")],
      program.programId
    );
    programConfig = programConfigResult.pda;
    console.log("Program Config PDA:", programConfig.toBase58());

    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    tokenRegistry = tokenRegistryResult.pda;
    console.log("Token registry PDA:", tokenRegistry.toBase58());

    const governanceResult = await getPda(
      [Buffer.from("governance"), mint.toBuffer()],
      program.programId
    );
    governance = governanceResult.pda;
    console.log("Governance PDA:", governance.toBase58());

    // Initialize staking-related PDAs
    const stakingPoolResult = await getPda(
      [Buffer.from("staking_pool"), mint.toBuffer()],
      program.programId
    );
    stakingPool = stakingPoolResult.pda;
    console.log("Staking Pool PDA:", stakingPool.toBase58());

    const stakingVaultAuthorityResult = await getPda(
      [Buffer.from("staking_vault_authority"), mint.toBuffer()],
      program.programId
    );
    stakingVaultAuthority = stakingVaultAuthorityResult.pda;
    console.log("Staking Vault Authority PDA:", stakingVaultAuthority.toBase58());

    const stakingVaultResult = await getPda(
      [Buffer.from("staking_vault"), mint.toBuffer()],
      program.programId
    );
    stakingVault = stakingVaultResult.pda;
    console.log("Staking Vault PDA:", stakingVault.toBase58());

    const stakingRewardsVaultAuthorityResult = await getPda(
      [Buffer.from("staking_rewards_vault_authority"), mint.toBuffer()],
      program.programId
    );
    stakingRewardsVaultAuthority = stakingRewardsVaultAuthorityResult.pda;
    console.log("Staking Rewards Vault Authority PDA:", stakingRewardsVaultAuthority.toBase58());

    const stakingRewardsVaultResult = await getPda(
      [Buffer.from("staking_rewards_vault"), mint.toBuffer()],
      program.programId
    );
    stakingRewardsVault = stakingRewardsVaultResult.pda;
    console.log("Staking Rewards Vault PDA:", stakingRewardsVault.toBase58());
  });

  it("Initializes program config", async () => {
    console.log("Initializing program config...");

    await program.methods
      .initializeProgramConfig(feeCollector.publicKey)
      .accounts({
        admin: wallet.publicKey,
        programConfig,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Program config initialized successfully!");
  });

  it("Sets up token registry, governance, and staking pool", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    await program.methods
      .registerCommunityToken(
        "Governance Test Token",
        "GTT",
        launchTimestamp,
        "governance_test_id",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount,
        programConfig,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    console.log("Token registered successfully!");

    console.log("Initializing staking pool...");
    const distributionInterval = 604800; // 1 week in seconds

    await program.methods
      .initializeStakingPool(
        new anchor.BN(distributionInterval)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        stakingPool,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    console.log("Staking pool initialized successfully!");

    console.log("Initializing governance...");

    await program.methods
      .initializeGovernance(
        new anchor.BN(initialVotingPeriodDays),
        new anchor.BN(initialMinVoteThreshold),
        new anchor.BN(initialProposalThreshold),
        initialProposalThresholdPercentage,
        "Test Governance",
        new anchor.BN(initialGovernanceFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        governance,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        programConfig,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify initial governance settings
    const governanceAccount = await program.account.governance.fetch(governance);
    assert.equal(Number(governanceAccount.votingPeriod), initialVotingPeriodDays * 86400);
    assert.equal(Number(governanceAccount.minVoteThreshold), initialMinVoteThreshold);
    assert.equal(Number(governanceAccount.proposalThreshold), initialProposalThreshold);
    assert.equal(governanceAccount.proposalThresholdPercentage, initialProposalThresholdPercentage);

    console.log("Governance initialized successfully with initial settings!");
    console.log("Voting period:", Number(governanceAccount.votingPeriod), "seconds");
    console.log("Min vote threshold:", Number(governanceAccount.minVoteThreshold));
    console.log("Proposal threshold:", Number(governanceAccount.proposalThreshold));
    console.log("Proposal threshold percentage:", governanceAccount.proposalThresholdPercentage, "%");
  });

  it("Creates a proposal to update governance settings", async () => {
    console.log("Creating proposal to update governance settings...");

    // Calculate next proposal ID (0 for first proposal)
    const proposalResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(0).toBuffer("le", 8),
      ],
      program.programId
    );
    proposal = proposalResult.pda;
    console.log("Proposal PDA:", proposal.toBase58());

    // Create the settings payload with new values
    const updateSettingsPayload = new UpdateSettingsPayload({
      voting_period_days: new anchor.BN(newVotingPeriodDays),
      min_vote_threshold: new anchor.BN(newMinVoteThreshold),
      proposal_threshold: new anchor.BN(newProposalThreshold),
      proposal_threshold_percentage: newProposalThresholdPercentage
    });

    // Serialize the payload
    const serializedPayload = borsh.serialize(
      UpdateSettingsPayloadSchema,
      updateSettingsPayload
    );

    // Proposal fee
    const proposalFee = 5 * 10 ** decimals;

    // Create proposal
    await program.methods
      .createMultiChoiceProposal(
        "Update Governance Settings",
        "Proposal to update governance voting period, thresholds, and percentages",
        ["Approve", "Reject"],
        { UpdateSettings: {} }, // Using the UpdateSettings execution type
        serializedPayload,
        new anchor.BN(proposalFee)
      )
      .accounts({
        proposer: proposer.publicKey,
        governance,
        tokenRegistry,
        tokenMint: mint,
        proposerTokenAccount,
        proposal,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        programConfig,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();

    // Verify proposal created
    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposal);
    assert.equal(proposalAccount.title, "Update Governance Settings");
    assert.equal(proposalAccount.choices.length, 2);
    assert.isDefined(proposalAccount.status.active, "Proposal status should be Active");
    assert.deepEqual(proposalAccount.executionType, { UpdateSettings: {} });

    console.log("Settings update proposal created successfully!");
  });

  it("Votes on the settings update proposal", async () => {
    console.log("Voting on the settings update proposal...");

    // Setup for voter 1 (votes to approve)
    const voter1ChoiceId = 0; // Approve option
    const voter1ChoiceEscrowResult = await getPda(
      [
        Buffer.from("choice_escrow"),
        proposal.toBuffer(),
        Buffer.from([voter1ChoiceId]),
        voter1.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter1ChoiceEscrow = voter1ChoiceEscrowResult.pda;
    
    const voter1VaultAuthorityResult = await getPda(
      [
        Buffer.from("vault_authority"),
        proposal.toBuffer(),
        Buffer.from([voter1ChoiceId]),
        voter1.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter1VaultAuthority = voter1VaultAuthorityResult.pda;
    
    const voter1ChoiceEscrowVaultResult = await getPda(
      [
        Buffer.from("choice_escrow_vault"),
        proposal.toBuffer(),
        Buffer.from([voter1ChoiceId]),
        voter1.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter1ChoiceEscrowVault = voter1ChoiceEscrowVaultResult.pda;

    // Setup for voter 2 (votes to reject)
    const voter2ChoiceId = 1; // Reject option
    const voter2ChoiceEscrowResult = await getPda(
      [
        Buffer.from("choice_escrow"),
        proposal.toBuffer(),
        Buffer.from([voter2ChoiceId]),
        voter2.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter2ChoiceEscrow = voter2ChoiceEscrowResult.pda;
    
    const voter2VaultAuthorityResult = await getPda(
      [
        Buffer.from("vault_authority"),
        proposal.toBuffer(),
        Buffer.from([voter2ChoiceId]),
        voter2.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter2VaultAuthority = voter2VaultAuthorityResult.pda;
    
    const voter2ChoiceEscrowVaultResult = await getPda(
      [
        Buffer.from("choice_escrow_vault"),
        proposal.toBuffer(),
        Buffer.from([voter2ChoiceId]),
        voter2.publicKey.toBuffer(),
      ],
      program.programId
    );
    voter2ChoiceEscrowVault = voter2ChoiceEscrowVaultResult.pda;

    // Voter 1 votes to approve (with 80 tokens)
    const voter1VoteAmount = 80 * 10 ** decimals;
    
    await program.methods
      .lockTokensForChoice(new anchor.BN(voter1VoteAmount), voter1ChoiceId)
      .accounts({
        voter: voter1.publicKey,
        proposal,
        choiceEscrow: voter1ChoiceEscrow,
        voterTokenAccount: voter1TokenAccount,
        tokenMint: mint,
        vaultAuthority: voter1VaultAuthority,
        choiceEscrowVault: voter1ChoiceEscrowVault,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([voter1])
      .rpc();

    console.log("Voter 1 voted to approve the settings update");

    // Voter 2 votes to reject (with 50 tokens)
    const voter2VoteAmount = 50 * 10 ** decimals;
    
    await program.methods
      .lockTokensForChoice(new anchor.BN(voter2VoteAmount), voter2ChoiceId)
      .accounts({
        voter: voter2.publicKey,
        proposal,
        choiceEscrow: voter2ChoiceEscrow,
        voterTokenAccount: voter2TokenAccount,
        tokenMint: mint,
        vaultAuthority: voter2VaultAuthority,
        choiceEscrowVault: voter2ChoiceEscrowVault,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([voter2])
      .rpc();

    console.log("Voter 2 voted to reject the settings update");

    // Verify votes were recorded correctly
    const proposalAfterVoting = await program.account.multiChoiceProposal.fetch(proposal);
    
    // Calculate expected vote counts (minus fees)
    const voter1FeeAmount = calculateFee(voter1VoteAmount);
    const voter1AmountAfterFee = voter1VoteAmount - voter1FeeAmount;
    
    const voter2FeeAmount = calculateFee(voter2VoteAmount);
    const voter2AmountAfterFee = voter2VoteAmount - voter2FeeAmount;
    
    assert.equal(Number(proposalAfterVoting.choiceVoteCounts[0]), voter1AmountAfterFee);
    assert.equal(Number(proposalAfterVoting.choiceVoteCounts[1]), voter2AmountAfterFee);
    
    console.log("Approve votes:", Number(proposalAfterVoting.choiceVoteCounts[0]));
    console.log("Reject votes:", Number(proposalAfterVoting.choiceVoteCounts[1]));
  });

  it("Executes the proposal to update governance settings", async () => {
    console.log("Waiting for voting period to end...");
    // Wait for voting period to end (60 seconds for test purposes)
    await new Promise((resolve) => setTimeout(resolve, 62000));

    console.log("Executing proposal to update governance settings...");
    
    await program.methods
      .executeProposal()
      .accounts({
        executor: tokenCreator.publicKey,
        governance,
        tokenRegistry,
        proposal,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify proposal was executed
    const proposalAfterExecution = await program.account.multiChoiceProposal.fetch(proposal);
    assert.isDefined(proposalAfterExecution.status.executed, "Proposal status should be Executed");
    assert.equal(proposalAfterExecution.winningChoice, 0); // Approve option should be the winner
    
    // Verify governance settings were updated
    const governanceAfterUpdate = await program.account.governance.fetch(governance);
    
    // Verify new values
    assert.equal(Number(governanceAfterUpdate.votingPeriod), newVotingPeriodDays * 86400);
    assert.equal(Number(governanceAfterUpdate.minVoteThreshold), newMinVoteThreshold);
    assert.equal(Number(governanceAfterUpdate.proposalThreshold), newProposalThreshold);
    assert.equal(governanceAfterUpdate.proposalThresholdPercentage, newProposalThresholdPercentage);
    
    console.log("Governance settings updated successfully!");
    console.log("New voting period:", Number(governanceAfterUpdate.votingPeriod), "seconds");
    console.log("New min vote threshold:", Number(governanceAfterUpdate.minVoteThreshold));
    console.log("New proposal threshold:", Number(governanceAfterUpdate.proposalThreshold));
    console.log("New proposal threshold percentage:", governanceAfterUpdate.proposalThresholdPercentage, "%");
  });

  it("Distributes tokens from winning and losing escrows", async () => {
    console.log("Distributing winning escrow tokens...");
    
    const tokenCreatorBalanceBefore = await getAccount(connection, tokenCreatorTokenAccount);
    console.log("Token creator balance before distribution:", Number(tokenCreatorBalanceBefore.amount));
    
    await program.methods
      .distributeWinningEscrow()
      .accounts({
        executor: tokenCreator.publicKey,
        proposal,
        choiceEscrow: voter1ChoiceEscrow,
        vaultAuthority: voter1VaultAuthority,
        escrowVault: voter1ChoiceEscrowVault,
        creatorTokenAccount: tokenCreatorTokenAccount,
        tokenMint: mint,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([tokenCreator])
      .rpc();
    
    const tokenCreatorBalanceAfter = await getAccount(connection, tokenCreatorTokenAccount);
    console.log("Token creator balance after distribution:", Number(tokenCreatorBalanceAfter.amount));
    
    // Verify token creator received tokens
    assert.isTrue(
      Number(tokenCreatorBalanceAfter.amount) > Number(tokenCreatorBalanceBefore.amount),
      "Token creator should receive tokens from winning escrow"
    );
    
    console.log("Refunding losing escrow to staking pool...");
    const stakingVaultBefore = await getAccount(connection, stakingVault);
    console.log("Staking vault balance before refund:", Number(stakingVaultBefore.amount));
    
    await program.methods
      .refundLosingEscrow()
      .accounts({
        executor: tokenCreator.publicKey,
        proposal,
        choiceEscrow: voter2ChoiceEscrow,
        vaultAuthority: voter2VaultAuthority,
        escrowVault: voter2ChoiceEscrowVault,
        voterTokenAccount: voter2TokenAccount,
        tokenMint: mint,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingVaultAuthority,
        stakingVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([tokenCreator])
      .rpc();
    
    const stakingVaultAfter = await getAccount(connection, stakingVault);
    console.log("Staking vault balance after refund:", Number(stakingVaultAfter.amount));
    
    // Verify staking vault received tokens
    assert.isTrue(
      Number(stakingVaultAfter.amount) > Number(stakingVaultBefore.amount),
      "Staking vault should receive tokens from losing escrow"
    );
    
    console.log("Successfully distributed tokens from both escrows!");
  });
});