import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

// Constants for the fee calculation
const FEE_PERCENTAGE = 1;
const FEE_BASIS_POINTS = 100;
const PROTOCOL_FEE_PERCENTAGE = 70;
const STAKING_REWARDS_PERCENTAGE = 30;

// Helper function to calculate fee
const calculateFee = (amount: number): number => {
  return Math.floor(amount * FEE_PERCENTAGE / FEE_BASIS_POINTS);
};

// Helper function to calculate protocol fee (70% of fee)
const calculateProtocolFee = (feeAmount: number): number => {
  return Math.floor(feeAmount * PROTOCOL_FEE_PERCENTAGE / 100);
};

// Helper function to calculate staking reward (30% of fee)
const calculateStakingReward = (feeAmount: number): number => {
  return Math.floor(feeAmount * STAKING_REWARDS_PERCENTAGE / 100);
};

describe("losing_votes_staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  let mint: PublicKey;
  let authorityTokenAccount: PublicKey;
  let voter1TokenAccount: PublicKey;
  let voter2TokenAccount: PublicKey;
  let proposerTokenAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let proposal: PublicKey;
  
  // PDAs for voters
  let voter1ChoiceEscrow: PublicKey;
  let voter1ChoiceEscrowVault: PublicKey;
  let voter1VaultAuthority: PublicKey;
  
  let voter2ChoiceEscrow: PublicKey;
  let voter2ChoiceEscrowVault: PublicKey;
  let voter2VaultAuthority: PublicKey;
  
  // Staking related PDAs
  let stakingPool: PublicKey;
  let stakingVault: PublicKey;
  let stakingVaultAuthority: PublicKey;
  let stakingRewardsVault: PublicKey;
  let stakingRewardsVaultAuthority: PublicKey;
  
  // Key pairs
  const authority = Keypair.generate();
  const voter1 = Keypair.generate();
  const voter2 = Keypair.generate();
  const proposer = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [authority, voter1, voter2, proposer, feeCollector]) {
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
    authorityTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      authority.publicKey
    );
    console.log("Authority token account:", authorityTokenAccount.toBase58());

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
      authorityTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      voter1TokenAccount,
      wallet.payer,
      100 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      voter2TokenAccount,
      wallet.payer,
      100 * 10 ** decimals
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

  it("Sets up token registry, governance, and staking pool", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    await program.methods
      .registerCommunityToken(
        "Test Token",
        "TST",
        launchTimestamp,
        "pump_fun_id_123",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: authority.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();

    console.log("Token registered successfully!");

    console.log("Initializing staking pool...");
    const distributionInterval = 604800; // 1 week in seconds

    await program.methods
      .initializeStakingPool(
        new anchor.BN(distributionInterval)
      )
      .accounts({
        authority: authority.publicKey,
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
      .signers([authority])
      .rpc();

    console.log("Staking pool initialized successfully!");

    console.log("Initializing governance...");
    const governanceFee = 20 * 10 ** decimals;
    const proposalThresholdPercentage = 5;

    await program.methods
      .initializeGovernance(
        new anchor.BN(1), // 1 day voting period for testing
        new anchor.BN(50 * 10 ** decimals), // min vote threshold
        new anchor.BN(100 * 10 ** decimals), // proposal threshold
        proposalThresholdPercentage,
        "Test Governance",
        new anchor.BN(governanceFee)
      )
      .accounts({
        authority: authority.publicKey,
        tokenRegistry,
        governance,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log("Governance initialized successfully!");
  });

  it("Creates a proposal and adds votes from two different voters", async () => {
    console.log("Creating proposal...");

    // Get the proposal PDA
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

    // Define proposal fee
    const proposalFee = 5 * 10 ** decimals;

    const choices = ["Option A", "Option B"];
    await program.methods
      .createMultiChoiceProposal(
        "Losing Votes Test Proposal",
        "Testing the redirection of losing votes to staking pool",
        choices,
        { updateSettings: {} },
        Buffer.from([]),
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
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();

    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposal);
    assert.equal(proposalAccount.title, "Losing Votes Test Proposal");
    assert.equal(proposalAccount.choices.length, 2);
    assert.isDefined(proposalAccount.status.active, "Proposal status should be Active");

    console.log("Proposal created successfully!");

    // Voter 1 votes for option A (will be the winning option)
    console.log("Voter 1 voting for option A...");
    const voter1ChoiceId = 0;

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

    // Get balance before voting
    const voter1BalanceBefore = await getAccount(connection, voter1TokenAccount);
    console.log("Voter 1 balance before voting:", Number(voter1BalanceBefore.amount));

    // Vote with 30 tokens
    const voter1VoteAmount = 30 * 10 ** decimals;
    const voter1FeeAmount = calculateFee(voter1VoteAmount);
    const voter1AmountAfterFee = voter1VoteAmount - voter1FeeAmount;

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

    // Verify vote was registered
    const voter1EscrowAccount = await program.account.choiceEscrow.fetch(voter1ChoiceEscrow);
    assert.equal(Number(voter1EscrowAccount.lockedAmount), voter1AmountAfterFee);
    console.log("Voter 1 locked amount:", Number(voter1EscrowAccount.lockedAmount));

    // Voter 2 votes for option B (will be the losing option)
    console.log("Voter 2 voting for option B...");
    const voter2ChoiceId = 1;

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

    // Get balance before voting
    const voter2BalanceBefore = await getAccount(connection, voter2TokenAccount);
    console.log("Voter 2 balance before voting:", Number(voter2BalanceBefore.amount));

    // Vote with 20 tokens
    const voter2VoteAmount = 20 * 10 ** decimals;
    const voter2FeeAmount = calculateFee(voter2VoteAmount);
    const voter2AmountAfterFee = voter2VoteAmount - voter2FeeAmount;

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

    // Verify vote was registered
    const voter2EscrowAccount = await program.account.choiceEscrow.fetch(voter2ChoiceEscrow);
    assert.equal(Number(voter2EscrowAccount.lockedAmount), voter2AmountAfterFee);
    console.log("Voter 2 locked amount:", Number(voter2EscrowAccount.lockedAmount));
  });

  it("Executes proposal to determine winners and losers", async () => {
    console.log("Waiting for voting period to end...");
    // Wait for voting period to end
    await new Promise((resolve) => setTimeout(resolve, 62000));

    console.log("Executing proposal...");
    await program.methods
      .executeProposal()
      .accounts({
        executor: authority.publicKey,
        governance,
        tokenRegistry,
        proposal,
      })
      .signers([authority])
      .rpc();

    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposal);
    assert.isDefined(proposalAccount.status.executed, "Proposal status should be Executed");
    assert.equal(proposalAccount.winningChoice, 0); // Option A should be the winner
    console.log("Proposal executed successfully. Winning choice:", proposalAccount.winningChoice);
  });

  it("Distributes winning escrow to token creator", async () => {
    console.log("Distributing winning escrow tokens...");

    const authorityTokenBalanceBefore = await getAccount(connection, authorityTokenAccount);
    console.log("Authority token balance before distribution:", Number(authorityTokenBalanceBefore.amount));

    await program.methods
      .distributeWinningEscrow()
      .accounts({
        executor: authority.publicKey,
        proposal,
        choiceEscrow: voter1ChoiceEscrow,
        vaultAuthority: voter1VaultAuthority,
        escrowVault: voter1ChoiceEscrowVault,
        creatorTokenAccount: authorityTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const authorityTokenBalanceAfter = await getAccount(connection, authorityTokenAccount);
    console.log("Authority token balance after distribution:", Number(authorityTokenBalanceAfter.amount));
    
    // Verify token creator received the tokens
    assert.isTrue(
      Number(authorityTokenBalanceAfter.amount) > Number(authorityTokenBalanceBefore.amount),
      "Token creator should receive tokens from winning escrow"
    );
  });

  it("Refunds losing escrow to staking pool (new behavior)", async () => {
    console.log("Checking staking pool balance before refund...");
    
    // Get staking vault balance before refund
    const stakingVaultBefore = await getAccount(connection, stakingVault);
    console.log("Staking vault balance before refund:", Number(stakingVaultBefore.amount));
    
    // Get staking pool data before refund
    const stakingPoolBefore = await program.account.stakingPool.fetch(stakingPool);
    console.log("Staking pool total staked amount before refund:", Number(stakingPoolBefore.totalStakedAmount));
    
    // Get voter 2's token balance before refund
    const voter2BalanceBefore = await getAccount(connection, voter2TokenAccount);
    console.log("Voter 2 balance before refund:", Number(voter2BalanceBefore.amount));
    
    // Check escrow amount from the losing vote
    const voter2EscrowAccount = await program.account.choiceEscrow.fetch(voter2ChoiceEscrow);
    const losingEscrowAmount = Number(voter2EscrowAccount.lockedAmount);
    console.log("Losing escrow amount:", losingEscrowAmount);
    
    console.log("Refunding losing escrow to staking pool...");
    await program.methods
      .refundLosingEscrow()
      .accounts({
        executor: authority.publicKey,
        proposal,
        choiceEscrow: voter2ChoiceEscrow,
        vaultAuthority: voter2VaultAuthority,
        escrowVault: voter2ChoiceEscrowVault,
        voterTokenAccount: voter2TokenAccount,
        tokenMint: mint,
        stakingPool,
        stakingVault,
        stakingVaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();
    
    console.log("Checking balances after refund...");
    
    // Get staking vault balance after refund
    const stakingVaultAfter = await getAccount(connection, stakingVault);
    console.log("Staking vault balance after refund:", Number(stakingVaultAfter.amount));
    
    // Get staking pool data after refund
    const stakingPoolAfter = await program.account.stakingPool.fetch(stakingPool);
    console.log("Staking pool total staked amount after refund:", Number(stakingPoolAfter.totalStakedAmount));
    
    // Get voter 2's token balance after refund
    const voter2BalanceAfter = await getAccount(connection, voter2TokenAccount);
    console.log("Voter 2 balance after refund:", Number(voter2BalanceAfter.amount));
    
    // Verify tokens went to staking pool instead of back to voter
    assert.equal(
      Number(voter2BalanceAfter.amount),
      Number(voter2BalanceBefore.amount),
      "Voter's token balance should not change"
    );
    
    assert.equal(
      Number(stakingVaultAfter.amount),
      Number(stakingVaultBefore.amount) + losingEscrowAmount,
      "Staking vault should receive tokens from losing escrow"
    );
    
    assert.equal(
      Number(stakingPoolAfter.totalStakedAmount),
      Number(stakingPoolBefore.totalStakedAmount) + losingEscrowAmount,
      "Staking pool total should be updated with tokens from losing escrow"
    );
    
    console.log("Losing escrow tokens successfully transferred to staking pool!");
  });
});